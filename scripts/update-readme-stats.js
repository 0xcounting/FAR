#!/usr/bin/env node
// Rewrites the stats table in README.md from the last build, so the headline
// numbers cannot drift away from what the registry actually contains.
// Run after `node src/build.js`. CI checks that it is a no-op on main.
import { readFileSync, writeFileSync } from 'node:fs';

const { counts } = JSON.parse(readFileSync('dist/index.json', 'utf8'));
const n = (x) => x.toLocaleString('en-US');
// Floor rather than round: a coverage figure that rounds 99.96 up to "100"
// reads as complete when it is not, which is the exact failure this registry's
// confidence model exists to prevent.
const pct = (a, b) => `${(Math.floor((10000 * a) / b) / 100).toFixed(1)}%`;

const rows = [
  ['CoinGecko coins', n(counts.coins)],
  ['— resolvable to at least one CAIP-19', `${n(counts.coinsResolvable)} (${pct(counts.coinsResolvable, counts.coins)})`],
  ['CAIP-19 identities', `${n(counts.deployments)} across ${n(counts.platformsMapped)} chains`],
  ['Native units of account', `${n(counts.nativeIdentities)} chain identities`],
  ['DTI token records', n(counts.dtiTokens)],
  ['— with a proposed CoinGecko match', `${n(counts.dtiLinked)} (${pct(counts.dtiLinked, counts.dtiTokens)})`],
  ['— verified against public evidence', `${n(counts.dtiAccepted)}`],
  ['\u2003\u2003rule-proposed / model-inferred / human-accepted', `${n(counts.dtiProposed)} / ${n(counts.dtiInferred)} / ${n(counts.dtiAccepted)}`],
  ['— chain inferred from the proposed match', `${n(counts.dtiChainRecovered)} (${pct(counts.dtiChainRecovered, counts.dtiTokens)})`],
  ['DTI ledger records', `${n(counts.dtiLedgers)}, ${n(counts.dtiLedgersWithCaip2)} with a CAIP-2`],
  ['CoinGecko platforms mapped to CAIP-2', n(counts.platformsMapped)],
  ['— still unmapped', n(counts.platformsUnmapped)],
  ['Published files', n(counts.files)],
];
const table = ['| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');

const readme = readFileSync('README.md', 'utf8');
const next = readme.replace(
  /<!-- BUILD-STATS:START -->[\s\S]*?<!-- BUILD-STATS:END -->/,
  `<!-- BUILD-STATS:START -->\n${table}\n<!-- BUILD-STATS:END -->`,
);
writeFileSync('README.md', next);
console.log(next === readme ? 'README stats already current' : 'README stats updated');
