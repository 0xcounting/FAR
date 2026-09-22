#!/usr/bin/env node
// Gate for every pull request. Exits non-zero on any violation.
//
// This is the mechanical half of the governance model: the rules below are the
// promises the registry makes to consumers, and they are enforced by CI rather
// than by a reviewer remembering them.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isValidCaip2, isValidCaip19, cosmosCaip2 } from './lib/caip.js';
import { slug, caipPath, unCaipPath } from './lib/slug.js';

const problems = [];
const fail = (rule, detail) => problems.push({ rule, detail });
const readOptional = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

const platformTable = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
const natives = JSON.parse(readFileSync('data/natives.json', 'utf8')).natives;
const links = JSON.parse(readFileSync('data/links.json', 'utf8'));
const coins = JSON.parse(gunzipSync(readFileSync('data/sources/coingecko-coins.json.gz')));
const coinIds = new Set(coins.map((c) => c.id));

// --- platforms -------------------------------------------------------------
// Four tiers, in descending order of how much a consumer should trust them.
// "proposed" is the new floor: a language model asserted it and no human has
// checked. It is published because a proposal that can be disputed is more
// useful than a blank, but it must never be mistaken for a reviewed claim.
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low', 'proposed']);
for (const [name, p] of Object.entries(platformTable.platforms)) {
  if (!isValidCaip2(p.caip2)) fail('platform.caip2-invalid', `${name}: ${p.caip2}`);
  if (!VALID_CONFIDENCE.has(p.confidence)) fail('platform.confidence-invalid', `${name}: ${p.confidence}`);
  // Evidence is not decoration. A mapping nobody can check is a mapping nobody
  // can dispute, which is the failure mode this whole repo exists to avoid.
  if (!Array.isArray(p.evidence) || p.evidence.length === 0) fail('platform.no-evidence', name);
  // A model-generated entry must carry its own uncertainty statement, so the
  // thing a reviewer should check first travels with the claim.
  if (p.confidence === 'proposed' && p.assertedBy == null) fail('platform.proposed-needs-assertedBy', name);
  // "high" needs evidence that does not rest on our own inference. Three kinds
  // qualify: a CASA specification, a mapping exercised in a production ingest,
  // or THE ECOSYSTEM'S OWN ratified standard registering the identifier.
  //
  // That third kind was added after Kadena: KIP-0017 is Status Final, it
  // registers `kadena:mainnet01` as a CAIP-2 identifier itself, and it is
  // deployed in wallets via WalletConnect. Refusing to call that "high" because
  // the document happens to live in the ecosystem's own KIP repo rather than
  // CASA's would rank a second-hand reading above the primary source.
  const STRONG = /production|CASA|ChainAgnostic|\b(KIP|CIP|EIP|SIP|NEP|SEP|TIP|BIP|SLIP)-?\s?\d+\b/i;
  if (p.confidence === 'high' && !p.evidence.some((e) => STRONG.test(e))) {
    fail('platform.high-confidence-needs-strong-evidence', name);
  }
  if (p.assetNamespace !== null && !/^[-a-z0-9]{3,8}$/.test(p.assetNamespace)) {
    fail('platform.asset-namespace-invalid', `${name}: ${p.assetNamespace}`);
  }
  if (platformTable.unmapped[name]) fail('platform.both-mapped-and-unmapped', name);
}

// eip155 chain IDs must be unique per platform only where the platform is the
// chain's canonical CoinGecko slug; duplicates are legal (Robinhood Chain and
// an L2 can share nothing) but a duplicate CAIP-2 with different namespaces is
// a contradiction.
const byCaip2 = new Map();
for (const [name, p] of Object.entries(platformTable.platforms)) {
  // One chain legitimately hosts several asset standards — Zilliqa carries both
  // Scilla ZRC-2 and EVM ERC-20 contracts on chain 32769, in separate address
  // spaces. That is only a contradiction if the two entries ALSO claim the same
  // address format, which would mean one identifier space with two names.
  const seen = byCaip2.get(p.caip2);
  if (seen && seen.assetNamespace !== p.assetNamespace && seen.addressFormat === p.addressFormat) {
    fail('platform.conflicting-namespace-for-chain', `${p.caip2}: ${seen.name}=${seen.assetNamespace} vs ${name}=${p.assetNamespace} (same addressFormat ${p.addressFormat})`);
  }
  if (!seen) byCaip2.set(p.caip2, { name, assetNamespace: p.assetNamespace, addressFormat: p.addressFormat });
}

// --- chain table -----------------------------------------------------------
// A chain is an identity in its own right (data/chains.json), independent of
// whether CoinGecko files tokens under it. The rules: the key is a valid CAIP-2
// and is exactly what the chain's own id derives to under the cosmos profile
// (so a consumer hashing "shentu-2.2" lands on our row); one registry name maps
// to one chain; evidence is mandatory like everywhere else; and every Cosmos
// platform in platforms.json points at a chain this table knows, so the two
// tables cannot disagree about which chain a platform is.
const chainTable = readOptional('data/chains.json', { chains: {} }).chains;
const seenRegistryName = new Map();
// Aliases: the raw `cosmos:<chain_id>` spelling of a hashed key. Both spellings
// resolve; the hashed one is canonical. An alias that could be mistaken for a
// conformant reference is a WRONG ASSET, not a missed lookup, so the rules are
// strict: exactly `cosmos:<this row's chainId>`, only on a hashed key, never
// itself hashed-shaped, and unique across every key and every alias.
const aliasOwner = new Map();
for (const [caip2, c] of Object.entries(chainTable)) {
  for (const alias of c.aliases ?? []) {
    if (!caip2.startsWith('cosmos:hashed-')) fail('chain.alias-on-direct-reference', `${caip2}: a direct reference needs no alias (${alias})`);
    if (alias !== `cosmos:${c.chainId}`) fail('chain.alias-not-raw-chain-id', `${caip2}: alias ${alias} is not cosmos:${c.chainId}`);
    if (alias.startsWith('cosmos:hashed-')) fail('chain.alias-looks-hashed', `${caip2}: alias ${alias} could be mistaken for a hashed reference`);
    if (chainTable[alias]) fail('chain.alias-collides-with-key', `${caip2}: alias ${alias} is another chain's canonical key`);
    if (aliasOwner.has(alias)) fail('chain.alias-duplicate', `${alias}: ${aliasOwner.get(alias)} and ${caip2}`);
    aliasOwner.set(alias, caip2);
  }
  if (caip2.startsWith('cosmos:hashed-') && !(c.aliases ?? []).length) fail('chain.hashed-without-alias', `${caip2}: a hashed key must publish its raw spelling cosmos:${c.chainId} as an alias`);
}
for (const [caip2, c] of Object.entries(chainTable)) {
  if (!isValidCaip2(caip2)) fail('chain.caip2-invalid', caip2);
  if (c.namespace === 'cosmos' && cosmosCaip2(c.chainId) !== caip2) fail('chain.caip2-not-derived-from-chain-id', `${caip2}: chainId "${c.chainId}" derives to ${cosmosCaip2(c.chainId)}`);
  if (!VALID_CONFIDENCE.has(c.confidence)) fail('chain.confidence-invalid', `${caip2}: ${c.confidence}`);
  if (!Array.isArray(c.evidence) || c.evidence.length === 0) fail('chain.no-evidence', caip2);
  if (c.confidence === 'proposed' && c.assertedBy == null) fail('chain.proposed-needs-assertedBy', caip2);
  if (c.registryName) {
    if (seenRegistryName.has(c.registryName)) fail('chain.duplicate-registry-name', `${c.registryName}: ${seenRegistryName.get(c.registryName)} and ${caip2}`);
    seenRegistryName.set(c.registryName, caip2);
  }
  const platformCaip2 = platformTable.platforms[c.coingeckoPlatform]?.caip2;
  if (c.coingeckoPlatform && platformCaip2 !== caip2) {
    fail('chain.platform-disagrees', `${caip2}: coingeckoPlatform ${c.coingeckoPlatform} maps to ${platformCaip2}`);
  }
}
for (const [name, p] of Object.entries(platformTable.platforms)) {
  if (!p.caip2.startsWith('cosmos:')) continue;
  if (chainTable[p.caip2]) continue;
  // Records carry the canonical key; the alias resolves on read. A platform
  // written in the alias dialect is a mistake the author can fix mechanically.
  if (aliasOwner.has(p.caip2)) fail('platform.cosmos-caip2-is-alias', `${name}: ${p.caip2} is an alias; use the canonical key ${aliasOwner.get(p.caip2)}`);
  else fail('platform.cosmos-chain-unknown', `${name}: ${p.caip2} has no entry in data/chains.json`);
}

// --- natives ---------------------------------------------------------------
for (const [coingeckoId, entries] of Object.entries(natives)) {
  if (!coinIds.has(coingeckoId)) fail('native.unknown-coingecko-id', coingeckoId);
  const seen = new Set();
  for (const e of entries) {
    if (!isValidCaip19(e.caip19)) fail('native.caip19-invalid', `${coingeckoId}: ${e.caip19}`);
    if (!e.caip19.startsWith(`${e.caip2}/`)) fail('native.caip2-mismatch', `${coingeckoId}: ${e.caip19}`);
    if (!/\/slip44:\d+$/.test(e.caip19)) fail('native.not-slip44', `${coingeckoId}: ${e.caip19}`);
    if (seen.has(e.caip19)) fail('native.duplicate', `${coingeckoId}: ${e.caip19}`);
    seen.add(e.caip19);
  }
}

// --- curated links ---------------------------------------------------------
const DTI_RE = /^[0-9A-Z]{9}$/;
const seenLink = new Set();
for (const kind of ['accepted', 'rejected']) {
  for (const l of links[kind] ?? []) {
    if (!DTI_RE.test(l.dti ?? '')) fail(`link.${kind}.dti-malformed`, JSON.stringify(l));
    if (!coinIds.has(l.coingeckoId)) fail(`link.${kind}.unknown-coingecko-id`, JSON.stringify(l));
    // Every curated decision must say who decided and why. An accepted link
    // with no rationale cannot be re-reviewed when the evidence changes.
    if (!l.rationale) fail(`link.${kind}.no-rationale`, `${l.dti} -> ${l.coingeckoId}`);
    if (!l.decidedIn) fail(`link.${kind}.no-decision-reference`, `${l.dti} -> ${l.coingeckoId}`);
    const key = `${kind}|${l.dti}|${l.coingeckoId}`;
    if (seenLink.has(key)) fail(`link.${kind}.duplicate`, key);
    seenLink.add(key);
  }
}
// The same pair cannot be both accepted and rejected.
for (const a of links.accepted ?? []) {
  if ((links.rejected ?? []).some((r) => r.dti === a.dti && r.coingeckoId === a.coingeckoId)) {
    fail('link.accepted-and-rejected', `${a.dti} -> ${a.coingeckoId}`);
  }
}

// --- model-inferred links --------------------------------------------------
// The weakest tier still has to carry its own accountability: who asserted it
// and why. A model link with no reasoning cannot be disputed, and an
// undisputable claim is the thing this registry exists not to publish.
const inferred = readOptional('data/links-inferred.json', { links: [] });
const acceptedPairs = new Set((links.accepted ?? []).map((l) => `${l.dti}|${l.coingeckoId}`));
const rejectedPairs = new Set((links.rejected ?? []).map((l) => `${l.dti}|${l.coingeckoId}`));
for (const l of inferred.links ?? []) {
  if (!DTI_RE.test(l.dti ?? '')) fail('inferred.dti-malformed', JSON.stringify(l));
  if (!coinIds.has(l.coingeckoId)) fail('inferred.unknown-coingecko-id', `${l.dti} -> ${l.coingeckoId}`);
  if (!l.reasoning) fail('inferred.no-reasoning', `${l.dti} -> ${l.coingeckoId}`);
  if (!l.assertedBy) fail('inferred.no-assertedBy', `${l.dti} -> ${l.coingeckoId}`);
  // A human rejection is final. A model must never quietly reinstate a pair a
  // reviewer has already thrown out.
  if (rejectedPairs.has(`${l.dti}|${l.coingeckoId}`)) {
    fail('inferred.contradicts-human-rejection', `${l.dti} -> ${l.coingeckoId}`);
  }
}

// --- ledger table ----------------------------------------------------------
const ledgers = readOptional('data/ledgers.json', { ledgers: {} }).ledgers;
for (const [dli, l] of Object.entries(ledgers)) {
  if (!DTI_RE.test(dli)) fail('ledger.dli-malformed', dli);
  if (l.caip2 != null && !isValidCaip2(l.caip2)) fail('ledger.caip2-invalid', `${dli}: ${l.caip2}`);
  if (!['public', 'permissioned', 'unknown'].includes(l.kind)) fail('ledger.kind-invalid', `${dli}: ${l.kind}`);
  if (!Array.isArray(l.evidence) || l.evidence.length === 0) fail('ledger.no-evidence', dli);
  // A permissioned ledger USUALLY has no CAIP-2, because nobody has published a
  // namespace or a canonical reference for it. That is not the same as saying it
  // CANNOT have one: nothing in CAIP-2 requires a chain to be public, and CASA
  // has already ratified namespaces of exactly this shape (swift, tenzro,
  // haneul, partisia, xync). Rejecting a CAIP-2 on a permissioned ledger
  // outright would block a correct contribution the day SDX or SWIAT registers
  // one, so this rule only asks that the claim be sourced, like every other
  // claim here.
  if (l.kind === 'permissioned' && l.caip2 && !(l.evidence ?? []).some((e) => /namespace|registered|spec|caip/i.test(e))) {
    fail('ledger.permissioned-caip2-needs-namespace-evidence', `${dli}: a CAIP-2 on a permissioned ledger needs evidence that a namespace and reference are actually published`);
  }
}

// --- routing invariants ----------------------------------------------------
// Slugging must round-trip for CAIP IDs, or a published URL cannot be turned
// back into the identifier it names.
for (const [, p] of Object.entries(platformTable.platforms)) {
  for (const ref of ['abc123', '0x2%3A%3Asui%3A%3ASUI', 'factory%2Finj1abc%2Fausd', 'A-B.c']) {
    const sample = `${p.caip2}/${p.assetNamespace ?? 'native'}:${ref}`;
    if (unCaipPath(caipPath(sample)) !== sample) fail('routing.caip-path-not-reversible', sample);
  }
}
if (slug('Tether USD') !== 'tether-usd') fail('routing.slug-drift', 'slug("Tether USD")');
if (slug('') !== '_') fail('routing.slug-empty-handling', 'slug("")');

// --- report ----------------------------------------------------------------
if (problems.length === 0) {
  const counts = {
    platforms: Object.keys(platformTable.platforms).length,
    unmapped: Object.keys(platformTable.unmapped).length,
    natives: Object.keys(natives).length,
    acceptedLinks: (links.accepted ?? []).length,
    rejectedLinks: (links.rejected ?? []).length,
    inferredLinks: (inferred.links ?? []).length,
    ledgers: Object.keys(ledgers).length,
    chains: Object.keys(chainTable).length,
  };
  console.log('validate: OK', JSON.stringify(counts));
  process.exit(0);
}
console.error(`validate: ${problems.length} problem(s)\n`);
for (const p of problems) console.error(`  [${p.rule}] ${p.detail}`);
process.exit(1);
