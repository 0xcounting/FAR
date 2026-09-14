#!/usr/bin/env node
// Fills in CAIP-2 for DTI ledger records that still have none, reusing
// identifiers this repository has ALREADY verified rather than researching them
// again.
//
// Two deterministic sources, strongest first:
//   1. data/platforms.json — 290 chains already mapped, most at medium/high
//      confidence with cited evidence. If a DTI ledger's name matches one of
//      those, we already know the answer.
//   2. ethereum-lists/chains — a unique name match gives an EIP-155 id.
//
// Anything left over is reported, not guessed. A wrong chain identifier is
// worse than a missing one: it silently relocates an asset.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const rd = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const table = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
const ledgerFile = JSON.parse(readFileSync('data/ledgers.json', 'utf8'));
const ledgers = ledgerFile.ledgers;
const evm = rd('data/sources/evm-chains.json.gz');
const identities = JSON.parse(readFileSync('data/dti-identities.json', 'utf8')).identities;

const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Strip words that describe the network rather than name it.
const core = (s) => norm(s).replace(/(mainnet|network|chain|protocol|platform|ledger|blockchain)$/g, '');

// 1. Platforms this repo already verified, indexed by every name they are known by.
const fromPlatforms = new Map();
for (const [slug, p] of Object.entries(table.platforms)) {
  if (!p.caip2) continue;
  for (const k of [norm(slug), core(slug)]) {
    if (k && !fromPlatforms.has(k)) fromPlatforms.set(k, { caip2: p.caip2, why: `data/platforms.json slug "${slug}" (confidence ${p.confidence})` });
  }
}
// 2. ethereum-lists, by unique name.
const fromEvm = new Map();
for (const c of evm) {
  for (const k of [norm(c.name), core(c.name), norm(c.shortName)]) {
    if (!k) continue;
    if (!fromEvm.has(k)) fromEvm.set(k, []);
    fromEvm.get(k).push(c);
  }
}

const blocked = new Map();
for (const i of identities) if (i.basis === 'ledger-has-no-caip2') blocked.set(i.ledgerDli, (blocked.get(i.ledgerDli) ?? 0) + 1);

const resolved = [], unresolved = [];
for (const [dli, tokenCount] of [...blocked].sort((a, b) => b[1] - a[1])) {
  const l = ledgers[dli];
  if (!l) { unresolved.push({ dli, tokenCount, longName: null, reason: 'ledger record missing' }); continue; }
  // A permissioned ledger having no CAIP-2 is the correct answer, not a gap.
  if (l.kind === 'permissioned') continue;

  const keys = [norm(l.longName), core(l.longName)].filter(Boolean);
  let hit = null;
  for (const k of keys) if (fromPlatforms.has(k)) { hit = fromPlatforms.get(k); break; }
  if (!hit) {
    for (const k of keys) {
      const ids = [...new Set((fromEvm.get(k) ?? []).map((c) => c.chainId))];
      if (ids.length === 1) { hit = { caip2: `eip155:${ids[0]}`, why: `ethereum-lists unique name match for "${l.longName}"` }; break; }
    }
  }
  if (hit) {
    ledgers[dli] = { ...l, caip2: hit.caip2, kind: 'public', confidence: 'medium',
      evidence: [...(l.evidence ?? []), hit.why], assertedBy: null };
    resolved.push({ dli, longName: l.longName, caip2: hit.caip2, tokenCount, why: hit.why });
  } else {
    unresolved.push({ dli, tokenCount, longName: l.longName, algo: l.anchorBlockHashAlgorithm ?? null, hash: l.anchorBlockHash ?? null });
  }
}

writeFileSync('data/ledgers.json', JSON.stringify({ ...ledgerFile, ledgers }, null, 2) + '\n');
writeFileSync('/tmp/ledgers-unresolved.json', JSON.stringify(unresolved, null, 2));
console.log(`resolved ${resolved.length} ledgers (${resolved.reduce((a, r) => a + r.tokenCount, 0)} tokens unblocked):`);
for (const r of resolved) console.log(`  ${String(r.tokenCount).padStart(3)}  ${r.longName.padEnd(24)} -> ${r.caip2}`);
console.log(`\nstill unresolved: ${unresolved.length} ledgers / ${unresolved.reduce((a, r) => a + r.tokenCount, 0)} tokens`);
