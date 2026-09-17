#!/usr/bin/env node
// Picks which already-adjudicated records deserve a second pass.
//
// Several adjudication agents returned `no-link` because the correct coin was
// never in the candidate set — a retrieval failure, not a judgement. The
// retrieval has since been fixed three times over. But re-running everything
// would be wasteful and would also re-ask questions that were answered
// correctly the first time.
//
// So: re-run a record only when its verdict was `no-link` or `unsure` AND its
// candidate set has MATERIALLY changed — a different top candidate, or a newly
// present candidate that the model never saw. A record whose candidates are
// unchanged got a real answer and keeps it.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';

const SP = process.env.FAR_AGENT_DIR;
const dir = `${SP}/links`;
const current = new Map(JSON.parse(readFileSync('/tmp/link-candidates.json', 'utf8')).map((r) => [r.dti, r]));

// What each agent was actually shown, recovered from the batch files it read.
const shown = new Map();
for (const f of readdirSync(dir).filter((f) => /^batch-\d+\.json$/.test(f))) {
  for (const r of JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))) {
    shown.set(r.dti, r.candidates.map((c) => c.coingeckoId));
  }
}

const verdicts = [];
for (const f of readdirSync(dir).filter((f) => /^result-\d+\.json$/.test(f))) {
  try { verdicts.push(...JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))); }
  catch (e) { console.error(`  ! ${f}: ${e.message}`); }
}

const rerun = [];
const stats = { total: verdicts.length, link: 0, keptNegative: 0, changed: 0, noCandidates: 0 };
for (const v of verdicts) {
  if (v.verdict === 'link') { stats.link++; continue; }
  const now = current.get(v.dti);
  if (!now) { stats.noCandidates++; continue; }
  const before = shown.get(v.dti) ?? [];
  const nowIds = now.candidates.map((c) => c.coingeckoId);
  const topChanged = nowIds[0] !== before[0];
  const gained = nowIds.filter((id) => !before.includes(id));
  if (!topChanged && gained.length === 0) { stats.keptNegative++; continue; }
  stats.changed++;
  rerun.push({ ...now, previousVerdict: v.verdict, previousReasoning: v.reasoning ?? null, newlyOffered: gained });
}

mkdirSync(`${dir}/rerun`, { recursive: true });
const N = Number(process.env.FAR_RERUN_BATCHES ?? 4);
const per = Math.ceil(rerun.length / N);
for (let i = 0; i < N; i++) {
  const slice = rerun.slice(i * per, (i + 1) * per);
  if (slice.length) writeFileSync(`${dir}/rerun/batch-${i + 1}.json`, JSON.stringify(slice, null, 2));
}
console.log(`verdicts seen:            ${stats.total}`);
console.log(`  already linked:         ${stats.link}`);
console.log(`  negative, candidates unchanged -> KEPT: ${stats.keptNegative}`);
console.log(`  negative, candidates changed  -> RERUN: ${stats.changed}`);
console.log(`  dropped from pool (placeholder etc.):   ${stats.noCandidates}`);
console.log(`wrote ${Math.min(N, Math.ceil(rerun.length / per) || 0)} rerun batches of ~${per}`);
