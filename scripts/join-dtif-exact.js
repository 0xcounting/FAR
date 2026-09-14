#!/usr/bin/env node
// Joins DTI records to CoinGecko coins on the CONTRACT ADDRESS, and scores the
// name-based tiers against that truth.
//
// This is the measurement the registry needs to be honest about itself. Until
// now every DTI link was inferred from names and nobody could say how often
// that was right. An address-derived link is ground truth for the records it
// covers, so the rule-proposed and model-inferred tiers can be graded rather
// than asserted.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildCaip19 } from '../src/lib/caip.js';

const rd = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const platformTable = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
const identities = JSON.parse(readFileSync('data/dti-identities.json', 'utf8')).identities;
const inferred = JSON.parse(readFileSync('data/links-inferred.json', 'utf8')).links;
const cgPlatforms = rd('data/sources/coingecko-platforms.json.gz');

// Index CoinGecko deployments by the SAME CAIP-19 the DTI side produces. Both
// sides run through buildCaip19, so normalisation (lowercasing, percent-
// encoding, namespace choice) is identical and the strings are comparable.
const byCaip19 = new Map();
for (const row of cgPlatforms) {
  const p = platformTable.platforms[row.platform];
  if (!p) continue;
  const built = buildCaip19(p, row.identity);
  if (!built) continue;
  if (!byCaip19.has(built.caip19)) byCaip19.set(built.caip19, []);
  byCaip19.get(built.caip19).push(row.coinId);
}

// Address-only index as a fallback: DTIF and CoinGecko sometimes disagree about
// WHICH chain a token is on (or we lack a CAIP-2 for that ledger), while the
// address itself still identifies the asset unambiguously on EVM chains.
const byAddress = new Map();
for (const row of cgPlatforms) {
  const a = (row.identity ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) continue;
  if (!byAddress.has(a)) byAddress.set(a, new Set());
  byAddress.get(a).add(row.coinId);
}

const exact = [];
const stats = { withCaip19: 0, matchedExact: 0, matchedAddressOnly: 0, noMatch: 0 };
for (const id of identities) {
  if (!id.caip19) continue;
  stats.withCaip19++;
  const hit = byCaip19.get(id.caip19);
  if (hit?.length) {
    stats.matchedExact++;
    exact.push({ dti: id.dti, coingeckoId: hit[0], caip19: id.caip19, basis: 'address-exact',
                 allCoinIds: [...new Set(hit)] });
    continue;
  }
  const addr = (id.technicalReference ?? '').toLowerCase();
  const byAddr = byAddress.get(addr);
  if (byAddr?.size === 1) {
    stats.matchedAddressOnly++;
    const only = [...byAddr][0];
    exact.push({ dti: id.dti, coingeckoId: only, caip19: id.caip19, basis: 'address-only-chain-differs',
                 allCoinIds: [only] });
    continue;
  }
  stats.noMatch++;
}

// ───────────────────────────────────────────────────────────────── scoring ──
const truth = new Map();
for (const e of exact) {
  if (!truth.has(e.dti)) truth.set(e.dti, new Set());
  for (const c of e.allCoinIds) truth.get(e.dti).add(c);
}
const grade = (links, label) => {
  let checkable = 0, right = 0, wrong = 0;
  const wrongExamples = [];
  for (const l of links) {
    const t = truth.get(l.dti);
    if (!t) continue;              // no ground truth for this DTI — not gradable
    checkable++;
    if (t.has(l.coingeckoId)) right++;
    else {
      wrong++;
      if (wrongExamples.length < 8) {
        wrongExamples.push({ dti: l.dti, said: l.coingeckoId, actually: [...t], reasoning: (l.reasoning ?? '').slice(0, 110) });
      }
    }
  }
  return { label, checkable, right, wrong, accuracy: checkable ? right / checkable : null, wrongExamples };
};

// Grade the DETERMINISTIC tier too. It would be self-serving to measure only
// the model and report its number as if the rules were beyond question.
const { normalizeDtiRecords } = await import('../src/lib/dti.js');
const { proposeLinks } = await import('../src/lib/link.js');
const curated = JSON.parse(readFileSync('data/links.json', 'utf8'));
const { tokens: dtiTokens } = normalizeDtiRecords(rd('data/sources/dti-registry.json.gz').records);
const coins = rd('data/sources/coingecko-coins.json.gz');
const { links: ruleLinks } = proposeLinks(dtiTokens, coins, curated);

const byBasis = (b) => ruleLinks.filter((l) => l.basis === b);
const modelScore = grade(inferred, 'model-inferred');
const ruleScore = grade(ruleLinks, 'rule-proposed (all)');
const nameSymbolScore = grade(byBasis('name+symbol'), 'rule: name+symbol');
const nameOnlyScore = grade(byBasis('name-only'), 'rule: name-only');
writeFileSync('data/links-exact.json', JSON.stringify({
  $schema: './../schema/links-exact.schema.json',
  _readme: 'DTI <-> CoinGecko links derived from the CONTRACT ADDRESS in the DTIF registry record, not from names. basis "address-exact" means the DTI-derived CAIP-19 matched a CoinGecko deployment exactly. "address-only-chain-differs" means the address matched a unique CoinGecko coin but the two sources disagree about the chain, or we lack a CAIP-2 for that ledger.',
  stats, links: exact,
}, null, 2) + '\n');
writeFileSync('data/link-accuracy.json', JSON.stringify({
  _readme: 'How often the name-based tiers agree with address-derived truth, measured only on the DTI records where truth exists. This is the registry grading itself.',
  measuredAt: new Date().toISOString().slice(0, 10),
  scores: [ruleScore, nameSymbolScore, nameOnlyScore, modelScore],
}, null, 2) + '\n');

const pct = (n, d) => (d ? `${(Math.floor((10000 * n) / d) / 100).toFixed(1)}%` : 'n/a');
const report = (s) => console.log(`  ${s.label.padEnd(22)} gradable ${String(s.checkable).padStart(5)}   right ${String(s.right).padStart(5)} (${pct(s.right, s.checkable).padStart(6)})   wrong ${String(s.wrong).padStart(4)}`);
console.log(`DTI records with a derived CAIP-19 : ${stats.withCaip19}`);
console.log(`  matched a CoinGecko deployment   : ${stats.matchedExact}`);
console.log(`  address matched, chain differs   : ${stats.matchedAddressOnly}`);
console.log(`  no CoinGecko coin at that address: ${stats.noMatch}`);
console.log(`\nEXACT links produced               : ${exact.length}`);
console.log(`\n── every name-based tier, graded against address truth ──`);
for (const s of [ruleScore, nameSymbolScore, nameOnlyScore, modelScore]) report(s);
console.log(`\n  examples of disagreement:`);
for (const w of modelScore.wrongExamples) {
  console.log(`   ${w.dti}  model said "${w.said}"  address says ${JSON.stringify(w.actually)}`);
}
