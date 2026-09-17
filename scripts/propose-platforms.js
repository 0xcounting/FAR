// Proposes data/platforms.json entries for CoinGecko platforms that are not yet
// mapped. OUTPUT IS A PROPOSAL, NOT TRUTH: every entry it emits lands at
// confidence "low" and must be reviewed by a human before merge. The committed
// data/platforms.json is the only thing the build reads.
//
//   node scripts/propose-platforms.js            # print proposals
//   node scripts/propose-platforms.js --json     # emit mergeable JSON
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const rd = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const evmChains = rd('data/sources/evm-chains.json.gz');
const cgPlatforms = rd('data/sources/coingecko-platforms.json.gz');
const mapped = JSON.parse(readFileSync('data/platforms.json', 'utf8'));

const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const byName = new Map();
for (const c of evmChains) {
  for (const k of [norm(c.name), norm(c.name).replace(/mainnet$/, ''), norm(c.shortName)]) {
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(c);
  }
}

const counts = new Map();
const shapes = new Map();
for (const { platform, identity } of cgPlatforms) {
  counts.set(platform, (counts.get(platform) ?? 0) + 1);
  const s = /^0x[0-9a-fA-F]{40}$/.test(identity ?? '') ? 'evm' : 'other';
  if (!shapes.has(platform)) shapes.set(platform, new Set());
  shapes.get(platform).add(s);
}

const proposals = {};
const unresolved = [];
for (const [platform, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  if (mapped.platforms[platform] || mapped.unmapped[platform]) continue;
  const evmOnly = shapes.get(platform).size === 1 && shapes.get(platform).has('evm');
  const hits = byName.get(norm(platform)) ?? [];
  const ids = [...new Set(hits.map((c) => c.chainId))];
  if (evmOnly && ids.length === 1) {
    proposals[platform] = {
      caip2: `eip155:${ids[0]}`,
      assetNamespace: 'erc20',
      nativeAsset: null,
      addressFormat: 'evm-lowercase',
      confidence: 'low',
      evidence: [`ethereum-lists/chains name match: ${hits[0].name}`],
      note: 'AUTO-PROPOSED by scripts/propose-platforms.js — name match only, unverified.',
    };
  } else {
    unresolved.push({ platform, tokens: n, evmShaped: evmOnly, candidates: ids.slice(0, 4) });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(proposals, null, 2));
} else {
  console.log(`proposed: ${Object.keys(proposals).length}   unresolved: ${unresolved.length}`);
  for (const [p, v] of Object.entries(proposals)) console.log(`  + ${p} -> ${v.caip2}  (${v.evidence[0]})`);
  console.log('\nunresolved (need a human):');
  for (const u of unresolved.slice(0, 40)) {
    console.log(`  ? ${u.platform.padEnd(26)} ${String(u.tokens).padStart(4)} tokens  evm=${u.evmShaped}  candidates=[${u.candidates}]`);
  }
}
