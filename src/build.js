#!/usr/bin/env node
// Builds the published dump from the vendored snapshots plus the curated
// tables in data/. Deterministic: same inputs -> byte-identical output, which
// is what makes the Merkle root in the manifest meaningful.
import { mkdirSync, writeFileSync, rmSync, readFileSync, statSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { loadSources } from './lib/sources.js';
import { slug, caipPath, isDegenerateSlug } from './lib/slug.js';
import { buildCaip19 } from './lib/caip.js';
import { placeIcs20Vouchers } from './lib/ics20.js';
import { citationIndex, classify, FAMILY_ORDER } from './lib/family.js';
import { sha256, merkleRoot, merkleProofs } from './lib/manifest.js';
import { openapiDoc, apiCatalog, llmsFull } from './lib/agentDocs.js';

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
    'data/platforms.json', 'data/natives.json', 'data/chains.json',
  ];
  return Math.max(...inputs.map((f) => statSync(f).mtimeMs));
}
const BUILD_EPOCH_MS = buildEpochMs();
const GENERATED = new Date(BUILD_EPOCH_MS).toISOString();
const REGISTRY_VERSION = GENERATED.slice(0, 10);

const src = loadSources();
const platformTable = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
const nativeTable = JSON.parse(readFileSync('data/natives.json', 'utf8')).natives;
// The chain table: CAIP-2 -> chain identity, independent of CoinGecko's platform
// list (data/chains.json, generated from the cosmos chain-registry snapshot).
const chainTable = JSON.parse(readFileSync('data/chains.json', 'utf8')).chains;
const readOptional = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
const chainNames = new Map(src.evmChains.map((c) => [`eip155:${c.chainId}`, c.name]));
// Cosmos deployments used to carry chainName: null because only ethereum-lists
// named chains. The chain table names the rest.
for (const [caip2, c] of Object.entries(chainTable)) if (!chainNames.has(caip2)) chainNames.set(caip2, c.name);
// Alias -> canonical CAIP-2 (data/chains.json `aliases`): the raw chain-id
// spelling of a hashed reference. Every path served under an alias resolves to
// the canonical record, so a consumer may ask in either dialect.
const chainAliases = new Map();
for (const [caip2, c] of Object.entries(chainTable)) for (const alias of c.aliases ?? []) chainAliases.set(alias, caip2);
const aliasesOf = new Map();
for (const [alias, caip2] of chainAliases) { if (!aliasesOf.has(caip2)) aliasesOf.set(caip2, []); aliasesOf.get(caip2).push(alias); }

// ---------------------------------------------------------------- assemble --
const coinsById = new Map();
for (const c of src.coingeckoCoins) {
  coinsById.set(c.id, {
    coingeckoId: c.id,
    name: c.name,
    symbol: (c.symbol ?? '').toUpperCase(),
    deployments: [],
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
    // From the identifier actually built, not the platform entry: chains that
    // dispatch the namespace per identity (Cosmos bank/cw20/ics20/factory,
    // Bitcoin ord/rune, Aptos coin/aip21) carry null on the platform row.
    assetNamespace: built.assetNamespace,
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
// ICS-20 vouchers, the checkable asset class: every row of the vendored trace
// table must reproduce its own ibc/<HASH> from sha256(path + "/" + baseDenom) or
// it is dropped here. Verified vouchers are placed onto coins through identities
// the registry already holds (the origin chain's denom, an Ethereum ERC-20 root,
// or a CoinGecko-listed sibling voucher); the rest are published as a work list
// with their origin CAIP-19, because "this voucher IS that origin asset" is a
// fact even when no CoinGecko id is known for either.
const ics20 = placeIcs20Vouchers(src.ibcDenomTraces, { coinsById, chainTable, platformTable });
stats.ics20 = ics20.stats;
stats.deployments += ics20.stats.placed;
// Order deployments by how much of the registry lives on each chain, biggest
// first, then alphabetically.
//
// Sorting alphabetically by CAIP-19 instead would bury the deployment a reader
// almost always wants: WETH's canonical Ethereum contract falls behind a Terra
// IBC voucher, and USDC leads with Algorand, purely because "cosmos:" and
// "algorand:" precede "eip155:" in ASCII. A reader who sees that concludes the
// registry only knows about the chain shown first.
//
// The weight is the number of assets this registry holds on that chain, which
// is data rather than a hand-maintained opinion about which chains matter. It
// is computed from the same inputs as everything else, so the build stays
// deterministic and the Merkle root stays meaningful.
const chainWeight = new Map();
for (const coin of coinsById.values()) {
  for (const d of coin.deployments) chainWeight.set(d.caip2, (chainWeight.get(d.caip2) ?? 0) + 1);
}
for (const coin of coinsById.values()) {
  coin.deployments.sort((a, b) =>
    (chainWeight.get(b.caip2) ?? 0) - (chainWeight.get(a.caip2) ?? 0) ||
    (a.caip19 < b.caip19 ? -1 : a.caip19 > b.caip19 ? 1 : 0));
}

// ----------------------------------------------------------------- family --
// Which assets are the head of a naming family, which are wrappers of one, and
// which are neither. Derived entirely from fields already published here, so a
// consumer can recompute it and check — and so it adds no new input that could
// make the build non-deterministic.
const citations = citationIndex([...coinsById.values()]);
const familyCounts = {};
for (const coin of coinsById.values()) {
  coin.family = classify(coin, citations);
  familyCounts[coin.family.family] = (familyCounts[coin.family.family] ?? 0) + 1;
}

// ---------------------------------------------------------------- relations --
// "Relational assets": the other entries a caller almost always wants next.
const byName = groupBy(coinsById.values(), (c) => slug(c.name));
const bySymbol = groupBy(coinsById.values(), (c) => slug(c.symbol));
for (const coin of coinsById.values()) {
  const nameKey = slug(coin.name);
  const symKey = slug(coin.symbol);
  coin.related = {
    sameName: others(byName, nameKey, coin.coingeckoId),
    sameSymbol: others(bySymbol, symKey, coin.coingeckoId),
  };
}

// -------------------------------------------------------------------- emit --
rmSync(OUT, { recursive: true, force: true });
const files = [];
const emitRaw = (path, body) => {
  const full = join(OUT, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  files.push({ path, sha256: sha256(body), bytes: body.length });
};
const emit = (path, value) => emitRaw(path, Buffer.from(JSON.stringify(value)));

const meta = () => ({ registry: 'far', version: REGISTRY_VERSION, docs: 'https://github.com/0xcounting/FAR' });
const compact = (c) => ({
  coingeckoId: c.coingeckoId, name: c.name, symbol: c.symbol,
  deployments: c.deployments,
  related: c.related, family: c.family,
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
    // The same record under every alias spelling of its chain, so
    // /caip/cosmos/kava_2222-10/... answers exactly as /caip/cosmos/hashed-.../...
    // does. The body says which spelling was asked for and which is canonical.
    for (const alias of aliasesOf.get(d.caip2) ?? []) {
      const aliasCaip19 = `${alias}/${d.caip19.slice(d.caip2.length + 1)}`;
      emit(`caip/${caipPath(aliasCaip19)}.json`, {
        ...meta(), query: { by: 'caip19', key: aliasCaip19 },
        alias: { requested: aliasCaip19, canonical: d.caip19, chainAlias: alias, chainCanonical: d.caip2 },
        asset: { ...compact(coin), deployment: d },
      });
      stats.aliasRoutes = (stats.aliasRoutes ?? 0) + 1;
    }
  }
}

// Bulk artefacts. The single big file is the thing the per-key files are
// built from, published so a consumer can hold the whole registry locally.
const everything = {
  ...meta(),
  generated: GENERATED,
  sources: src.provenance,
  assets: [...coinsById.values()].map(compact),
};
const bigJson = Buffer.from(JSON.stringify(everything));
const bigGz = gzipSync(bigJson, { level: 9 });
writeFileSync(join(OUT, 'far.json'), bigJson);
writeFileSync(join(OUT, 'far.json.gz'), bigGz);
files.push({ path: 'far.json', sha256: sha256(bigJson), bytes: bigJson.length });
files.push({ path: 'far.json.gz', sha256: sha256(bigGz), bytes: bigGz.length });

// A compact index the docs page loads once and searches locally. Carrying the
// whole registry in the browser removes the need to guess which route a query
// belongs to — the reader types anything and gets rows — and it is why the page
// needs no server and no query API.
//
// Short keys and no prose: 3.3 MB raw, ~1.1 MB over the wire. The full
// far.json is 14 MB, which would work but is four times the download for data
// the page does not use.
const searchIndex = [...coinsById.values()].map((a) => {
  const r = { i: a.coingeckoId, n: a.name, s: a.symbol, f: a.family.family[0] };
  const d = a.deployments.map((x) => [x.caip19, x.chainName || '']);
  if (d.length) r.d = d;
  return r;
});
emit('search-index.json', searchIndex);

// Outbound links: where a reader goes to see the thing itself. Explorer URLs
// come from ethereum-lists/chains, which already carries them; the docs page
// turns a CAIP-19 into a contract link with them. 2,326 chains, 25 KB gzipped.
//
emit('_explorers.json', {
  ...meta(),
  _readme: 'chainId -> block explorer base URL, from ethereum-lists/chains (MIT). Used by the docs page to link a CAIP-19 to the contract it names.',
  eip155: JSON.parse(gunzipSync(readFileSync('data/sources/evm-explorers.json.gz'))),
  // Namespaces whose explorer needs a different path shape.
  other: {
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'https://solscan.io/token/',
    'tron:728126428': 'https://tronscan.org/#/token20/',
    'aptos:1': 'https://explorer.aptoslabs.com/object/',
    'sui:mainnet': 'https://suivision.xyz/coin/',
    'stellar:pubnet': 'https://stellar.expert/explorer/public/asset/',
    'hedera:mainnet': 'https://hashscan.io/mainnet/token/',
    'starknet:SN_MAIN': 'https://starkscan.co/contract/',
    'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k': 'https://allo.info/asset/',
  },
});

emit('_platforms.json', { ...meta(), ...platformTable });
// Chains as identities in their own right. A Cosmos chain is here whether or not
// CoinGecko has a platform for it, so an IBC voucher's ORIGIN can always be named.
emit('_chains.json', {
  ...meta(),
  _readme: 'CAIP-2 -> chain identity. Keys are canonical (for cosmos: the chain_id verbatim, or hashed- per cosmos/caip2.md when the id fails the direct grammar). `aliases` maps every other published spelling -- the raw cosmos:<chain_id> of a hashed key -- to its canonical key; both spellings resolve on every route. Chain-registry data CC-BY-4.0 (Cosmos chain-registry contributors, via cosmos.directory).',
  count: Object.keys(chainTable).length,
  aliases: Object.fromEntries([...chainAliases].sort()),
  chains: chainTable,
});
// Identifiers this registry had to invent because no CASA spec defines one.
// Publishing the gap makes it actionable — each entry is a concrete proposal
// somebody could take upstream — rather than leaving it implied by a
// confidence label nobody reads.
emit('_namespace-gaps.json', { ...meta(), ...readOptional('data/namespace-gaps.json', {}) });
// Verified vouchers with no CoinGecko id on either end: each row still pins one
// identifier to another (`equivalentTo` is the origin asset's CAIP-19).
emit('_ics20-unplaced.json', {
  ...meta(),
  _readme: 'ICS-20 vouchers whose (path, baseDenom) reproduce their ibc/<HASH> -- so the mapping is verified -- but whose origin asset has no CoinGecko id this registry knows. equivalentTo is the origin CAIP-19; null when the path could not be walked to an origin chain.',
  count: ics20.unplaced.length,
  vouchers: ics20.unplaced,
});

// ---------------------------------------------------------------- manifest --
const counts = {
  coins: coinsById.size,
  deployments: stats.deployments + (stats.natives ?? 0),
  nativeIdentities: stats.natives ?? 0,
  coinsResolvable: [...coinsById.values()].filter((c) => c.deployments.length).length,
  family: familyCounts,
  platformsMapped: Object.keys(platformTable.platforms).length,
  platformsUnmapped: Object.keys(platformTable.unmapped).length,
  chains: Object.keys(chainTable).length,
  chainAliases: chainAliases.size,
  aliasRoutes: stats.aliasRoutes ?? 0,
  ics20Verified: stats.ics20.verified,
  ics20Rejected: stats.ics20.rejected,
  ics20Placed: stats.ics20.placed,
  ics20AlreadyListed: stats.ics20.alreadyListed,
  ics20Unplaced: stats.ics20.unplaced,
  files: files.length,
};
const indexDoc = {
  ...meta(),
  generated: everything.generated,
  sources: src.provenance,
  counts,
  routes: {
    name: '/name/{slug}.json', symbol: '/symbol/{slug}.json', coingeckoId: '/cg/{id}.json',
    caip19: '/caip/{namespace}/{reference}/{assetNamespace}/{assetReference}.json  (e.g. /caip/eip155/1/erc20/0xdac17f958d2ee523a2206206994597c13d831ec7.json; a "%" in the reference becomes "~")',
    bulk: '/far.json.gz', manifest: '/manifest.json', platforms: '/_platforms.json', chains: '/_chains.json',
    ics20Unplaced: '/_ics20-unplaced.json',
    llms: '/llms.txt', llmsFull: '/llms-full.txt', readme: '/README.md', openapi: '/openapi.json', apiCatalog: '/.well-known/api-catalog', robots: '/robots.txt',
    proof: '/proof/{path without .json}.json  (e.g. /proof/cg/tether.json proves cg/tether.json; /proof/index.html.json proves index.html)',
    searchIndex: '/search-index.json',
    namespaceGaps: '/_namespace-gaps.json',
    explorers: '/_explorers.json',
  },
};
// The human-facing docs page. GitHub Pages serves index.html at "/", so the
// site root becomes documentation while /index.json stays the machine route —
// the two do not collide. Hashed into the manifest like every other file, so a
// consumer can verify the page they are reading is the published one.
if (existsSync('site/index.html')) {
  emitRaw('index.html', readFileSync('site/index.html'));
  // /v2.html was the preview URL while this design was being compared against
  // the old one. Kept as a redirect so any link shared in that window still lands.
  emitRaw('v2.html', Buffer.from('<!doctype html><meta charset="utf-8">'
    + '<meta http-equiv="refresh" content="0;url=./"><link rel="canonical" href="./">'
    + '<title>FAR</title><p><a href="./">FAR moved to the site root</a></p>\n'));
}

// ------------------------------------------------------- for agents and tools --
// llms.txt (llmstxt.org), an RFC 9727 API catalog, an OpenAPI description of
// every route, and the Markdown docs as served files. All hashed into the
// manifest like everything else. BASE is the public origin; override it to
// serve the same build from elsewhere.
const BASE = process.env.FAR_BASE ?? 'https://0xcounting.github.io/FAR';
const llms = readFileSync('site/llms.txt', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const contributing = readFileSync('CONTRIBUTING.md', 'utf8');
emitRaw('llms.txt', Buffer.from(llms));
emitRaw('llms-full.txt', Buffer.from(llmsFull(llms, readme, contributing)));
emitRaw('README.md', Buffer.from(readme));
emitRaw('robots.txt', readFileSync('site/robots.txt'));
emit('openapi.json', openapiDoc(BASE, { ...counts, version: REGISTRY_VERSION }));
emit('.well-known/api-catalog', apiCatalog(BASE));

// index.json is the last file in. Its own entry is the +1, so the count it
// publishes equals the manifest's.
counts.files = files.length + 1;
emit('index.json', indexDoc);

const root = merkleRoot(files);
const manifest = { ...meta(), generated: everything.generated, merkleRoot: root, algorithm: 'sha256/rfc6962-style', counts, files };
const manifestBody = Buffer.from(JSON.stringify(manifest));
writeFileSync(join(OUT, 'manifest.json'), manifestBody);
// A single line a consumer can pin in CI, or a human can compare by eye.
writeFileSync(join(OUT, 'manifest.sha256'), `${sha256(manifestBody)}  manifest.json\n${root}  merkleRoot\n`);

// One inclusion proof per published file, so a consumer can check a single
// response against the root with ~17 hashes instead of the 11 MB manifest.
// Proofs are derived FROM the tree, so they cannot be leaves of it: they are
// written directly and deliberately left out of `files`.
let proofCount = 0;
for (const [path, proof] of merkleProofs(files)) {
  const entry = files.find((f) => f.path === path);
  const dest = join(OUT, 'proof', `${path.replace(/\.json$/, '')}.json`);
  mkdirSync(join(dest, '..'), { recursive: true });
  writeFileSync(dest, JSON.stringify({ ...meta(), path, sha256: entry.sha256, merkleRoot: root, proof }));
  proofCount++;
}

// ----------------------------------------------------------------- report ---
const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
console.log(`  proofs               ${proofCount} (not in manifest)`);
console.log(`far build ${REGISTRY_VERSION}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(20)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}
console.log(`  ${'totalBytes'.padEnd(20)} ${(totalBytes / 1e6).toFixed(1)} MB`);
console.log(`  ${'merkleRoot'.padEnd(20)} ${root}`);
console.log('  ics20 placement:     ', JSON.stringify(stats.ics20.placedVia));
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
  // The head of the family first, then everything else by how many other assets
  // are named after it, then alphabetically.
  //
  // Relatedness, not wrapper-ness, orders the tail. Ranking every derivative
  // last would put a memecoin squatting the USDC ticker above Circle's own
  // bridged deployments: the squatter is unrelated to the group while the
  // bridge is the same asset. A wrapper of the head is more relevant to someone
  // asking "which USDC", not less. The `family` field still says which is
  // which.
  for (const g of m.values()) {
    g.sort((a, b) =>
      (a.family.family === 'canonical' ? 0 : 1) - (b.family.family === 'canonical' ? 0 : 1) ||
      b.family.citedBy - a.family.citedBy ||
      (a.coingeckoId < b.coingeckoId ? -1 : a.coingeckoId > b.coingeckoId ? 1 : 0));
  }
  return m;
}
function others(map, key, self) {
  return (map.get(key) ?? []).map((c) => c.coingeckoId).filter((id) => id !== self);
}
function bump(m, k) { m.set(k, (m.get(k) ?? 0) + 1); }
function sum(m) { return [...m.values()].reduce((a, b) => a + b, 0); }
