#!/usr/bin/env node
// Absorbs model-generated proposals into the curated tables.
//
// Everything this writes lands at the LOWEST trust tier — platform entries at
// confidence "proposed", links at status "inferred" — and carries the asserting
// model plus whatever uncertainty the model reported. Nothing here is ever
// written as "accepted" or above; promoting a proposal is a human act, done by
// pull request, and that boundary is the whole point of the tier.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const SP = process.env.FAR_AGENT_DIR;
if (!SP) { console.error('set FAR_AGENT_DIR to the directory holding caip2/ links/ ledgers/'); process.exit(2); }
const ASSERTED_BY = process.env.FAR_ASSERTED_BY ?? 'claude-opus-5 (far agent run)';

const readResults = (sub) => {
  const dir = `${SP}/${sub}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^result-\d+\.json$/.test(f))
    .sort()
    .flatMap((f) => {
      try { return JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); }
      catch (e) { console.error(`  ! ${sub}/${f}: ${e.message}`); return []; }
    });
};

// ---------------------------------------------------------------- platforms --
const platformResults = readResults('caip2');
if (platformResults.length) {
  const table = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
  let added = 0, declined = 0;
  for (const r of platformResults) {
    if (!r.platform) continue;
    if (!r.caip2) {
      // The model looked and concluded there is no chain identifier. That is a
      // finding, so record it on the backlog entry rather than discarding it.
      if (table.unmapped[r.platform]) {
        table.unmapped[r.platform].investigated = { assertedBy: ASSERTED_BY, note: r.note ?? null, uncertainty: r.uncertainty ?? null };
      }
      declined++;
      continue;
    }
    if (table.platforms[r.platform]) continue; // never overwrite a reviewed entry
    table.platforms[r.platform] = {
      caip2: r.caip2,
      assetNamespace: r.assetNamespace ?? null,
      nativeAsset: r.nativeAsset ?? null,
      addressFormat: r.addressFormat ?? null,
      confidence: 'proposed',
      assertedBy: ASSERTED_BY,
      namespaceRatified: r.namespaceRatified ?? null,
      assetNamespaceRatified: r.assetNamespaceRatified ?? null,
      evidence: r.evidence?.length ? r.evidence : ['model assertion, no external source cited'],
      note: r.note ?? null,
      uncertainty: r.uncertainty ?? null,
    };
    delete table.unmapped[r.platform];
    added++;
  }
  writeFileSync('data/platforms.json', JSON.stringify(table, null, 2) + '\n');
  console.log(`platforms: +${added} proposed, ${declined} investigated-and-declined`);
}

// -------------------------------------------------------------------- links --
const linkResults = readResults('links');
if (linkResults.length) {
  const links = [];
  const counts = { link: 0, 'no-link': 0, unsure: 0 };
  for (const r of linkResults) {
    counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    if (r.verdict !== 'link' || !r.coingeckoId) continue;
    links.push({
      dti: r.dti, coingeckoId: r.coingeckoId,
      modelConfidence: r.confidence ?? null,
      reasoning: r.reasoning ?? null,
      assertedBy: ASSERTED_BY,
    });
  }
  writeFileSync('data/links-inferred.json', JSON.stringify({
    $schema: './../schema/links-inferred.schema.json',
    _readme: 'Links asserted by a language model from names and tickers alone, because the DTI snapshot redacts the contract address. Published at status "inferred" — BELOW the deterministic "proposed" tier and far below human-reviewed "accepted". Each carries the model\'s own confidence and its reasoning, which is what a disputer argues with. Promoting one to accepted means moving it into data/links.json by pull request with checkable evidence.',
    assertedBy: ASSERTED_BY,
    verdictCounts: counts,
    links,
  }, null, 2) + '\n');
  console.log(`links: ${counts.link} link / ${counts['no-link']} no-link / ${counts.unsure} unsure -> ${links.length} inferred`);
}

// ------------------------------------------------------------------ ledgers --
const ledgerResults = readResults('ledgers');
const deterministic = existsSync('/tmp/dli-resolved.json')
  ? JSON.parse(readFileSync('/tmp/dli-resolved.json', 'utf8')) : {};
if (ledgerResults.length || Object.keys(deterministic).length) {
  const ledgers = {};
  for (const [dli, v] of Object.entries(deterministic)) {
    ledgers[dli] = { caip2: v.caip2, longName: v.longName, kind: 'public',
      confidence: 'low', evidence: [v.basis], note: null, uncertainty: null };
  }
  let proposed = 0, permissioned = 0;
  for (const r of ledgerResults) {
    if (!r.dli || ledgers[r.dli]) continue;
    ledgers[r.dli] = {
      caip2: r.caip2 ?? null, longName: r.longName ?? null,
      kind: r.kind ?? 'unknown', confidence: 'proposed', assertedBy: ASSERTED_BY,
      evidence: r.evidence?.length ? r.evidence : ['model assertion, no external source cited'],
      note: r.note ?? null, uncertainty: r.uncertainty ?? null,
    };
    if (r.caip2) proposed++; else permissioned++;
  }
  writeFileSync('data/ledgers.json', JSON.stringify({
    $schema: './../schema/ledgers.schema.json',
    _readme: 'DTI ledger records (DLIs) mapped to CAIP-2. This is DTIF\'s own chain vocabulary expressed in CAIP terms. Note what it does NOT give you: the snapshot redacts which ledger each TOKEN record sits on, so this table names the chains DTIF knows about without saying which token is on which. Entries with caip2 null and kind "permissioned" are bank or CSD ledgers that have no public chain identifier and never will.',
    ledgers,
  }, null, 2) + '\n');
  console.log(`ledgers: ${Object.keys(ledgers).length} total (${Object.keys(deterministic).length} deterministic, ${proposed} proposed, ${permissioned} no-caip2)`);
}
