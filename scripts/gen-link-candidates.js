#!/usr/bin/env node
// Generates a bounded candidate set for each DTI record that the deterministic
// rules in src/lib/link.js could not link.
//
// This does NOT decide anything. Its only job is to turn "which of 18,090 coins
// is this?" into "is it one of these 8, or none of them?" — a question a
// reviewer (human or model) can actually answer, and one whose wrong answers are
// visible because the candidate set is published alongside the verdict.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { slug } from '../src/lib/slug.js';
import { normalizeDtiRecords, matchableName } from '../src/lib/dti.js';

const rd = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const coins = rd('data/sources/coingecko-coins.json.gz');
const { tokens } = normalizeDtiRecords(rd('data/sources/dti-registry.json.gz').records);
const unlinked = new Set(JSON.parse(readFileSync('dist/_unlinked.json', 'utf8')).unlinked.map((u) => u.dti));

const trigrams = (s) => {
  const p = `  ${s} `;
  const out = new Set();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
};
const jaccard = (a, b) => {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};
// "Wrapped Ether" -> "we"; catches DTI long names against CoinGecko tickers.
const acronym = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]).join('').toLowerCase();

const coinIndex = coins.map((c) => ({
  id: c.id, name: c.name, symbol: (c.symbol ?? '').toUpperCase(),
  nameKey: slug(c.name), symKey: slug(c.symbol), tri: trigrams(slug(c.name)),
}));
const bySym = new Map();
const byName = new Map();
for (const c of coinIndex) {
  if (!bySym.has(c.symKey)) bySym.set(c.symKey, []);
  bySym.get(c.symKey).push(c);
  if (!byName.has(c.nameKey)) byName.set(c.nameKey, []);
  byName.get(c.nameKey).push(c);
}

const out = [];
let noCandidate = 0;
for (const t of tokens) {
  if (!unlinked.has(t.dti)) continue;
  const nameKey = matchableName(t.longName);
  const symKeys = [...new Set(t.shortNames.map(slug).filter(Boolean))];
  const tri = trigrams(nameKey);
  const acr = acronym(t.longName ?? '');

  const scored = new Map();
  const bump = (c, points, why) => {
    const e = scored.get(c.id) ?? { coin: c, score: 0, why: [] };
    e.score += points; e.why.push(why); scored.set(c.id, e);
  };

  for (const c of byName.get(nameKey) ?? []) bump(c, 4, 'name-exact');
  for (const k of symKeys) for (const c of bySym.get(k) ?? []) bump(c, 3, `symbol-exact:${k}`);
  // Acronym of the DTI long name equals a CoinGecko ticker ("Wrapped Ether"→WE).
  if (acr.length >= 2) for (const c of bySym.get(acr) ?? []) bump(c, 2, 'acronym-matches-symbol');
  // Fuzzy name similarity, capped so it can suggest but never dominate.
  for (const c of coinIndex) {
    if (Math.abs(c.nameKey.length - nameKey.length) > 12) continue;
    const j = jaccard(tri, c.tri);
    if (j >= 0.55) bump(c, Math.min(2, j * 2), `name-similarity:${j.toFixed(2)}`);
  }

  const candidates = [...scored.values()]
    .sort((a, b) => b.score - a.score || (a.coin.id < b.coin.id ? -1 : 1))
    .slice(0, 8)
    .map((e) => ({ coingeckoId: e.coin.id, name: e.coin.name, symbol: e.coin.symbol, score: Number(e.score.toFixed(2)), why: e.why }));

  if (candidates.length === 0) { noCandidate++; continue; }
  out.push({
    dti: t.dti, longName: t.longName, shortNames: t.shortNames,
    type: t.type, typeLabel: t.typeLabel, isin: t.isin,
    equivalentGroup: t.equivalentGroup, candidates,
  });
}

writeFileSync('/tmp/link-candidates.json', JSON.stringify(out, null, 2));
console.log(`unlinked DTI records: ${unlinked.size}`);
console.log(`  with at least one candidate: ${out.length}`);
console.log(`  with NO candidate at all:    ${noCandidate}  (nothing to adjudicate — not on CoinGecko)`);
const strong = out.filter((o) => o.candidates[0].score >= 3).length;
console.log(`  top candidate scoring >= 3:  ${strong}`);
