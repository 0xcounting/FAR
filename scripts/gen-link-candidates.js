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
// DTI short names are frequently chain-decorated: "1AXS" (Harmony), "AXSet"
// and "WETHe" (Avalanche), "wXLM" (wrapped). Stripping the decoration recovers
// the underlying ticker.
//
// The rules below are deliberately NARROW. A broader version that also stripped
// leading so/j/m/x/a/e/b/p prefixes destroyed the entire AFREUM family — "AISK"
// (Afreum Icelandic krona) became "isk", "AAMD" became "amd" — inventing
// confident-looking matches out of currency codes. Precision beats recall here,
// because every bad candidate competes for one of 12 slots.
function tickerVariants(sym) {
  const out = new Set();
  const s = (sym ?? '').trim();
  if (s.length < 3) return [];
  if (/^[0-9]+[A-Za-z]{2,}$/.test(s)) out.add(s.replace(/^[0-9]+/, ''));   // 1AXS -> AXS
  if (/^[A-Z0-9]{3,}[a-z]{1,2}$/.test(s)) out.add(s.replace(/[a-z]+$/, '')); // AXSet -> AXS
  if (/^w[A-Z]{3,}$/.test(s)) out.add(s.slice(1));                          // wXLM -> XLM
  // "BNB-bsc", "USDC.e" — a chain tag appended with a separator. Require the
  // stem to be >= 3 chars so currency-code families are not mangled.
  const sep = s.match(/^([A-Za-z0-9]{3,})[.\-][A-Za-z0-9]{1,6}$/);
  if (sep) out.add(sep[1]);
  out.delete(s);
  return [...out];
}

// "Wrapped Ether" -> "we"; catches DTI long names against CoinGecko tickers.
const acronym = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]).join('').toLowerCase();

// Canonicality prior. When dozens of coins share a ticker, the one a DTI record
// most likely means is the original, not a bridged deployment of it. Without
// this, ties broke alphabetically and `usd-coin` was pushed out of the top 8 by
// `anubis-bridged-usdc-anubis` — the adjudicating model then correctly refused
// to link, because the right answer was never shown to it.
const DERIVATIVE = /(bridged|wrapped|peg|pegged|-on-|portal|wormhole|synthetic|staked|receipt|\bold\b|\bv[0-9]\b)/i;

// Deployment count is the one signal here that is DATA rather than string shape.
// An asset deployed on many chains is overwhelmingly likely to be the original
// rather than something that merely took its ticker. This was added after the
// string-only version ranked `woo` — a memecoin with a short id — above
// `woo-network` for four "Wootrade Network" records: brevity is a weak proxy
// for canonicality and a memecoin can always claim a shorter name.
const deploymentCount = new Map();
for (const row of rd('data/sources/coingecko-platforms.json.gz')) {
  deploymentCount.set(row.coinId, (deploymentCount.get(row.coinId) ?? 0) + 1);
}

const canonicality = (c) => {
  let s = 0;
  if (!DERIVATIVE.test(c.id) && !DERIVATIVE.test(c.name)) s += 2;
  if (!/-\d+$/.test(c.id)) s += 1;           // `meow-5` is a collision survivor
  s += Math.max(0, 1 - c.id.split('-').length * 0.15);
  const n = deploymentCount.get(c.id) ?? 0;
  s += Math.min(3, Math.log2(n + 1));        // 1 chain ~ +1, 7 chains ~ +3
  return s;
};

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
  // Scored below an exact ticker: the decoration was stripped by rule, and the
  // rule can be wrong.
  for (const raw of t.shortNames) {
    for (const v of tickerVariants(raw)) {
      for (const c of bySym.get(slug(v)) ?? []) bump(c, 2.5, `symbol-variant:${raw}->${v}`);
    }
  }
  // Acronym of the DTI long name equals a CoinGecko ticker ("Wrapped Ether"→WE).
  if (acr.length >= 2) for (const c of bySym.get(acr) ?? []) bump(c, 2, 'acronym-matches-symbol');
  // Fuzzy name similarity, capped so it can suggest but never dominate.
  for (const c of coinIndex) {
    if (Math.abs(c.nameKey.length - nameKey.length) > 12) continue;
    const j = jaccard(tri, c.tri);
    if (j >= 0.55) bump(c, Math.min(2, j * 2), `name-similarity:${j.toFixed(2)}`);
  }

  const candidates = [...scored.values()]
    .sort((a, b) =>
      b.score - a.score ||
      canonicality(b.coin) - canonicality(a.coin) ||
      (a.coin.id < b.coin.id ? -1 : 1))
    .slice(0, 12)
    .map((e) => ({ coingeckoId: e.coin.id, name: e.coin.name, symbol: e.coin.symbol,
                   score: Number(e.score.toFixed(2)),
                   canonicality: Number(canonicality(e.coin).toFixed(2)), why: e.why }));

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
