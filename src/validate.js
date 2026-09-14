#!/usr/bin/env node
// Gate for every pull request. Exits non-zero on any violation.
//
// This is the mechanical half of the governance model: the rules below are the
// promises the registry makes to consumers, and they are enforced by CI rather
// than by a reviewer remembering them.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isValidCaip2, isValidCaip19 } from './lib/caip.js';
import { slug, caipPath, unCaipPath } from './lib/slug.js';

const problems = [];
const fail = (rule, detail) => problems.push({ rule, detail });

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
  if (p.confidence === 'high' && !p.evidence.some((e) => /production|CASA|ChainAgnostic/i.test(e))) {
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
  };
  console.log('validate: OK', JSON.stringify(counts));
  process.exit(0);
}
console.error(`validate: ${problems.length} problem(s)\n`);
for (const p of problems) console.error(`  [${p.rule}] ${p.detail}`);
process.exit(1);
