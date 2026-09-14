#!/usr/bin/env node
// Builds the published dump from the vendored snapshots plus the curated
// tables in data/. Deterministic: same inputs -> byte-identical output, which
// is what makes the Merkle root in the manifest meaningful.
import { mkdirSync, writeFileSync, rmSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { loadSources } from './lib/sources.js';
import { slug, caipPath, isDegenerateSlug } from './lib/slug.js';
import { buildCaip19 } from './lib/caip.js';
import { normalizeDtiRecords, matchableName } from './lib/dti.js';
import { proposeLinks } from './lib/link.js';
import { inferChainAndAddress } from './lib/dtiChain.js';
import { sha256, merkleRoot } from './lib/manifest.js';

const OUT = process.env.FAR_OUT ?? 'dist';
const t0 = Date.now();

// The build timestamp is derived from the INPUTS, not from the clock.
//
// `generated` is embedded in far.json and index.json, both of which are hashed
// into the manifest and therefore into the Merkle root. Taking it from
// Date.now() made two builds of an identical tree produce different roots,
// which would have quietly destroyed the one property the root exists to
// provide. This is the reproducible-builds convention: honour SOURCE_DATE_EPOCH
// if the caller sets one, otherwise use the newest input file's mtime.
function buildEpochMs() {
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH) * 1000;
  const inputs = [
    ...readdirSync('data/sources').map((f) => `data/sources/${f}`),
    'data/platforms.json', 'data/natives.json', 'data/links.json',
  ];
  return Math.max(...inputs.map((f) => statSync(f).mtimeMs));
}
const BUILD_EPOCH_MS = buildEpochMs();
const GENERATED = new Date(BUILD_EPOCH_MS).toISOString();
const REGISTRY_VERSION = GENERATED.slice(0, 10);

const src = loadSources();
const platformTable = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
const curatedLinks = JSON.parse(readFileSync('data/links.json', 'utf8'));
const nativeTable = JSON.parse(readFileSync('data/natives.json', 'utf8')).natives;
const readOptional = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
// Model-asserted links and the DTI ledger vocabulary. Both are optional so a
// clone without an agent run still builds.
const inferredLinks = readOptional('data/links-inferred.json', { links: [] }).links;
// Links derived from the contract address in the DTIF registry record. These
// are not guesses about which asset a name refers to — they are the identifier
// the registry itself holds, so they outrank every name-based tier and SUPPRESS
// a name-based link that disagrees.
const exactLinks = readOptional('data/links-exact.json', { links: [] }).links;
const ledgerTable = readOptional('data/ledgers.json', { ledgers: {} }).ledgers;
const chainNames = new Map(src.evmChains.map((c) => [`eip155:${c.chainId}`, c.name]));

// ---------------------------------------------------------------- assemble --
const coinsById = new Map();
for (const c of src.coingeckoCoins) {
  coinsById.set(c.id, {
    coingeckoId: c.id,
    name: c.name,
    symbol: (c.symbol ?? '').toUpperCase(),
    deployments: [],
    dti: [],
  });
}

const stats = { platformMissing: new Map(), addressRejected: new Map(), deployments: 0 };
for (const row of src.coingeckoPlatforms) {
  const coin = coinsById.get(row.coinId);
  if (!coin) continue;
  const p = platformTable.platforms[row.platform];
  if (!p) { bump(stats.platformMissing, row.platform); continue; }
  const built = buildCaip19(p, row.identity);
  if (!built) { bump(stats.addressRejected, row.platform); continue; }
  coin.deployments.push({
    caip19: built.caip19,
    caip2: p.caip2,
    chainName: chainNames.get(p.caip2) ?? null,
    coingeckoPlatform: row.platform,
    assetNamespace: p.assetNamespace,
    address: built.address,
    confidence: p.confidence,
  });
  stats.deployments++;
}
// Native units of account have no contract address and so never appear in the
// platform list. Without this pass "bitcoin" and "ethereum" — the two most
// likely queries this registry will ever receive — resolve to nothing.
let nativeCount = 0;
for (const [coingeckoId, entries] of Object.entries(nativeTable)) {
  const coin = coinsById.get(coingeckoId);
  if (!coin) continue;
  for (const e of entries) {
    coin.deployments.push({
      caip19: e.caip19,
      caip2: e.caip2,
      chainName: e.chainName ?? chainNames.get(e.caip2) ?? null,
      coingeckoPlatform: null,
      assetNamespace: 'slip44',
      address: null,
      native: true,
      confidence: e.confidence,
    });
    nativeCount++;
  }
}
stats.natives = nativeCount;
for (const coin of coinsById.values()) {
  coin.deployments.sort((a, b) => (a.caip19 < b.caip19 ? -1 : 1));
}

// --------------------------------------------------------------------- DTI --
const { tokens: dtiTokens, ledgers: dtiLedgers } = normalizeDtiRecords(src.dtiRegistry);
const dtiById = new Map(dtiTokens.map((t) => [t.dti, t]));
const { links, unlinked } = proposeLinks(dtiTokens, src.coingeckoCoins, curatedLinks);

// Address-derived links are applied FIRST, so everything downstream sees those
// DTIs as already decided. Measured against this truth, the name-based tiers
// run 83-89% correct, and their errors are overwhelmingly one kind: linking a
// bridged or pegged deployment to the canonical asset it wraps. That is exactly
// the error this override removes.
const exactByDti = new Map();
for (const l of exactLinks) {
  if (!coinsById.has(l.coingeckoId) || !dtiById.has(l.dti)) continue;
  if (exactByDti.has(l.dti)) continue;
  exactByDti.set(l.dti, l);
}
let suppressed = 0;
for (let i = links.length - 1; i >= 0; i--) {
  const l = links[i];
  if (l.status === 'accepted') continue;         // a human decision still wins
  const e = exactByDti.get(l.dti);
  if (e && e.coingeckoId !== l.coingeckoId) { links.splice(i, 1); suppressed++; }
  else if (e) links.splice(i, 1);                // same answer; the exact one replaces it
}
for (const [dti, e] of exactByDti) {
  if (links.some((l) => l.dti === dti && l.status === 'accepted')) continue;
  links.push({ dti, coingeckoId: e.coingeckoId, basis: e.basis, status: 'exact',
               caip19: e.caip19 ?? null });
}
// Model-asserted links fill in where the deterministic rules found nothing.
// They never override a deterministic or curated link for the same DTI: a
// weaker method must not quietly replace a stronger one.
const decided = new Set(links.map((l) => l.dti));
let inferredUsed = 0;
for (const l of inferredLinks) {
  if (decided.has(l.dti)) continue;
  if (!coinsById.has(l.coingeckoId) || !dtiById.has(l.dti)) continue;
  links.push({ dti: l.dti, coingeckoId: l.coingeckoId, basis: 'llm-adjudicated', status: 'inferred',
               modelConfidence: l.modelConfidence, reasoning: l.reasoning, assertedBy: l.assertedBy });
  decided.add(l.dti);
  inferredUsed++;
}

for (const l of links) {
  const coin = coinsById.get(l.coingeckoId);
  const rec = dtiById.get(l.dti);
  if (!coin || !rec) continue;
  coin.dti.push({
    dti: rec.dti,
    longName: rec.longName,
    type: rec.type,
    typeLabel: rec.typeLabel,
    isin: rec.isin,
    equivalentGroup: rec.equivalentGroup,
    basis: l.basis,
    status: l.status,
    caip19: l.caip19 ?? null,
    modelConfidence: l.modelConfidence ?? null,
    reasoning: l.reasoning ?? null,
    assertedBy: l.assertedBy ?? null,
  });
}

// ---------------------------------------------------------------- relations --
// "Relational assets": the other entries a caller almost always wants next.
const byName = groupBy(coinsById.values(), (c) => slug(c.name));
const bySymbol = groupBy(coinsById.values(), (c) => slug(c.symbol));
const byDtiGroup = new Map();
for (const coin of coinsById.values()) {
  for (const d of coin.dti) {
    if (!d.equivalentGroup) continue;
    if (!byDtiGroup.has(d.equivalentGroup)) byDtiGroup.set(d.equivalentGroup, new Set());
    byDtiGroup.get(d.equivalentGroup).add(coin.coingeckoId);
  }
}
for (const coin of coinsById.values()) {
  const nameKey = slug(coin.name);
  const symKey = slug(coin.symbol);
  const group = new Set();
  for (const d of coin.dti) for (const id of byDtiGroup.get(d.equivalentGroup) ?? []) group.add(id);
  group.delete(coin.coingeckoId);
  coin.related = {
    sameName: others(byName, nameKey, coin.coingeckoId),
    sameSymbol: others(bySymbol, symKey, coin.coingeckoId),
    // Assets the DTI registry itself declares functionally fungible with this
    // one — the cross-chain "same economic asset" relation, asserted by a
    // standards body rather than inferred by us.
    dtiEquivalent: [...group].sort(),
  };
}

// -------------------------------------------------------------------- emit --
rmSync(OUT, { recursive: true, force: true });
const files = [];
const emit = (path, value) => {
  const body = Buffer.from(JSON.stringify(value));
  const full = join(OUT, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  files.push({ path, sha256: sha256(body), bytes: body.length });
};

const meta = () => ({ registry: 'far', version: REGISTRY_VERSION, docs: 'https://github.com/0xcounting/FAR' });
const compact = (c) => ({
  coingeckoId: c.coingeckoId, name: c.name, symbol: c.symbol,
  deployments: c.deployments, dti: c.dti, related: c.related,
});

for (const coin of coinsById.values()) {
  emit(`cg/${coin.coingeckoId}.json`, { ...meta(), query: { by: 'coingeckoId', key: coin.coingeckoId }, asset: compact(coin) });
}

emitGroups('name', byName);
emitGroups('symbol', bySymbol);

for (const coin of coinsById.values()) {
  for (const d of coin.deployments) {
    emit(`caip/${caipPath(d.caip19)}.json`, {
      ...meta(), query: { by: 'caip19', key: d.caip19 },
      asset: { ...compact(coin), deployment: d },
    });
  }
}

const linksByDti = new Map();
for (const l of links) {
  if (!linksByDti.has(l.dti)) linksByDti.set(l.dti, []);
  linksByDti.get(l.dti).push(l);
}
// A "functionally fungible group" DTI is the registry's own statement that
// several tokens are the same economic asset across ledgers. Indexing the group
// in both directions makes that relation followable from either end.
const groupMembers = new Map();
for (const t of dtiTokens) {
  if (!t.equivalentGroup) continue;
  if (!groupMembers.has(t.equivalentGroup)) groupMembers.set(t.equivalentGroup, []);
  groupMembers.get(t.equivalentGroup).push(t.dti);
}
const chainBasisCounts = {};
for (const rec of dtiTokens) {
  const linked = (linksByDti.get(rec.dti) ?? []).map((l) => coinsById.get(l.coingeckoId)).filter(Boolean);
  emit(`dti/${rec.dti}.json`, {
    ...meta(), query: { by: 'dti', key: rec.dti },
    dti: rec,
    groupMembers: (groupMembers.get(rec.dti) ?? []).filter((d) => d !== rec.dti).sort(),
    // Best-effort recovery of the two fields the free snapshot redacts. Never
    // a read — always an inference, and `basis` says which one.
    inferredChain: (() => {
      const inf = inferChainAndAddress(rec, linked[0], platformTable);
      chainBasisCounts[inf.basis] = (chainBasisCounts[inf.basis] ?? 0) + 1;
      return inf;
    })(),
    // A DTI with no linked asset is the normal case, not an error: the free
    // snapshot has no address to join on and most records never get a proposal.
    assets: linked.map(compact),
    linkStatus: linked.length ? linked.map((c) => c.coingeckoId) : [],
  });
}

// Bulk artefacts. The single big file is the thing the per-key files are
// built from, published so a consumer can hold the whole registry locally.
const everything = {
  ...meta(),
  generated: GENERATED,
  sources: src.provenance,
  assets: [...coinsById.values()].map(compact),
  dtiLedgers,
  dtiUnlinked: unlinked,
};
const bigJson = Buffer.from(JSON.stringify(everything));
const bigGz = gzipSync(bigJson, { level: 9 });
writeFileSync(join(OUT, 'far.json'), bigJson);
writeFileSync(join(OUT, 'far.json.gz'), bigGz);
files.push({ path: 'far.json', sha256: sha256(bigJson), bytes: bigJson.length });
files.push({ path: 'far.json.gz', sha256: sha256(bigGz), bytes: bigGz.length });

emit('_platforms.json', { ...meta(), ...platformTable });
emit('_ledgers.json', { ...meta(), count: Object.keys(ledgerTable).length, ledgers: ledgerTable });
// Identifiers this registry had to invent because no CASA spec defines one.
// Publishing the gap makes it actionable — each entry is a concrete proposal
// somebody could take upstream — rather than leaving it implied by a
// confidence label nobody reads.
emit('_namespace-gaps.json', { ...meta(), ...readOptional('data/namespace-gaps.json', {}) });
for (const [dli, l] of Object.entries(ledgerTable)) {
  emit(`ledger/${dli}.json`, { ...meta(), query: { by: 'dli', key: dli }, ledger: l });
}
emit('_unlinked.json', { ...meta(), count: unlinked.length, unlinked });

// ---------------------------------------------------------------- manifest --
const counts = {
  coins: coinsById.size,
  deployments: stats.deployments + (stats.natives ?? 0),
  nativeIdentities: stats.natives ?? 0,
  dtiTokens: dtiTokens.length,
  dtiLedgers: dtiLedgers.length,
  dtiLinked: new Set(links.map((l) => l.dti)).size,
  dtiAccepted: links.filter((l) => l.status === 'accepted').length,
  dtiProposed: links.filter((l) => l.status === 'proposed').length,
  dtiInferred: links.filter((l) => l.status === 'inferred').length,
  dtiExact: links.filter((l) => l.status === 'exact').length,
  dtiNameLinksSuppressedByAddress: suppressed,
  dtiChainRecovered: (chainBasisCounts['name-hint'] ?? 0) + (chainBasisCounts['sole-deployment'] ?? 0),
  dtiLedgersWithCaip2: Object.values(ledgerTable).filter((l) => l.caip2).length,
  dtiUnlinked: unlinked.length,
  coinsResolvable: [...coinsById.values()].filter((c) => c.deployments.length).length,
  platformsMapped: Object.keys(platformTable.platforms).length,
  platformsUnmapped: Object.keys(platformTable.unmapped).length,
  files: files.length,
};
const indexDoc = {
  ...meta(),
  generated: everything.generated,
  sources: src.provenance,
  counts,
  routes: {
    name: '/name/{slug}.json', symbol: '/symbol/{slug}.json', coingeckoId: '/cg/{id}.json',
    caip19: '/caip/{namespace}/{reference}/{assetNamespace}/{assetReference}.json  (e.g. /caip/eip155/1/erc20/0xdac17f958d2ee523a2206206994597c13d831ec7.json; a "%" in the reference becomes "~")', dti: '/dti/{DTI}.json',
    bulk: '/far.json.gz', manifest: '/manifest.json', platforms: '/_platforms.json',
    unlinked: '/_unlinked.json',
    ledger: '/ledger/{DLI}.json',
    ledgers: '/_ledgers.json',
    namespaceGaps: '/_namespace-gaps.json',
  },
};
emit('index.json', indexDoc);

const root = merkleRoot(files);
const manifest = { ...meta(), generated: everything.generated, merkleRoot: root, algorithm: 'sha256/rfc6962-style', counts, files };
const manifestBody = Buffer.from(JSON.stringify(manifest));
writeFileSync(join(OUT, 'manifest.json'), manifestBody);
// A single line a consumer can pin in CI, or a human can compare by eye.
writeFileSync(join(OUT, 'manifest.sha256'), `${sha256(manifestBody)}  manifest.json\n${root}  merkleRoot\n`);

// ----------------------------------------------------------------- report ---
const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
console.log(`far build ${REGISTRY_VERSION}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`  ${'totalBytes'.padEnd(20)} ${(totalBytes / 1e6).toFixed(1)} MB`);
console.log(`  ${'merkleRoot'.padEnd(20)} ${root}`);
console.log('  DTI chain inference:', JSON.stringify(chainBasisCounts));
if (stats.platformMissing.size) {
  const top = [...stats.platformMissing].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  unmapped platform rows: ${sum(stats.platformMissing)} (top: ${top.map(([k, v]) => `${k}=${v}`).join(', ')})`);
}
if (stats.addressRejected.size) {
  const top = [...stats.addressRejected].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  rejected addresses:     ${sum(stats.addressRejected)} (top: ${top.map(([k, v]) => `${k}=${v}`).join(', ')})`);
}

function emitGroups(kind, map) {
  for (const [key, group] of map) {
    if (isDegenerateSlug(key)) continue; // see slug.js — not a meaningful key
    emit(`${kind}/${key}.json`, {
      ...meta(), query: { by: kind, key },
      count: group.length,
      // A group is the whole point of routing by name: "tether" is not one
      // asset, and collapsing it to one would be the lie this registry exists
      // to avoid.
      assets: group.map(compact),
    });
  }
}
function groupBy(iter, keyFn) {
  const m = new Map();
  for (const v of iter) {
    const k = keyFn(v);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  }
  for (const g of m.values()) g.sort((a, b) => (a.coingeckoId < b.coingeckoId ? -1 : 1));
  return m;
}
function others(map, key, self) {
  return (map.get(key) ?? []).map((c) => c.coingeckoId).filter((id) => id !== self);
}
function bump(m, k) { m.set(k, (m.get(k) ?? 0) + 1); }
function sum(m) { return [...m.values()].reduce((a, b) => a + b, 0); }
