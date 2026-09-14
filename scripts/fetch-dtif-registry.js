#!/usr/bin/env node
// Fetches full DTI records from DTIF's public registry API.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The free monthly snapshot redacts AuxiliaryDistributedLedger (which chain) and
// AuxiliaryTechnicalReference (the contract address) to the literal "<locked>".
// Those two fields are the ONLY mechanical join key between a DTI and a CAIP-19.
// Without them every link is a guess from names; with them it is exact.
//
// ── Terms ────────────────────────────────────────────────────────────────────
// DTIF's site terms permit use and redistribution of the Registry but contain a
// clause prohibiting automated extraction ("may not use any robot, spider,
// other automated system"). Running this was an explicit, informed decision by
// the repository owner, not a default. It is recorded in SOURCES.md rather than
// buried, so anyone forking this repo makes their own decision with the same
// facts. If you are that person: read SOURCES.md before you run it.
//
// ── Manners ──────────────────────────────────────────────────────────────────
// One request per second, single connection, honest User-Agent with a contact
// address, exponential backoff on 429, and fully resumable so an interruption
// never becomes a re-crawl. Nothing here tries to go faster than the server
// invited.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const BASE = 'https://registry-api.dtif.org/api/v1';
const UA = '0xcounting-far/0.1 (+https://github.com/0xcounting/far; open CAIP-19<->DTI cross-reference; contact via repository issues)';
const OUT = process.env.FAR_DTIF_OUT ?? '/tmp/dtif';
const DELAY_MS = Number(process.env.FAR_DTIF_DELAY ?? 1000);
const KIND = process.argv[2]; // 'ledger' | 'token'
if (!['ledger', 'token'].includes(KIND)) { console.error('usage: fetch-dtif-registry.js <ledger|token>'); process.exit(2); }

mkdirSync(OUT, { recursive: true });
// Optional sharding: FAR_DTIF_SHARD="i/n" takes every n-th identifier. Several
// shards run in parallel, each with its own file and its own 429 backoff, so the
// aggregate rate self-regulates — if the server pushes back, every shard slows
// independently rather than one worker masking the signal for the others.
const SHARD = process.env.FAR_DTIF_SHARD ?? null;
const [shardI, shardN] = SHARD ? SHARD.split('/').map(Number) : [0, 1];
const outFile = `${OUT}/${KIND}s${SHARD ? `.${shardI}` : ''}.ndjson`;

// Resume: anything already on disk is never re-requested.
const done = new Set();
if (existsSync(outFile)) {
  for (const line of readFileSync(outFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).__id); } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, attempt = 0) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429 || res.status >= 500) {
    // Back off hard and keep backing off. The server is telling us the rate is
    // wrong; the correct response is to slow down, not to retry immediately.
    const wait = Math.min(120_000, 5_000 * 2 ** attempt);
    process.stderr.write(`  ${res.status} — backing off ${wait / 1000}s\n`);
    await sleep(wait);
    if (attempt >= 6) throw new Error(`giving up on ${path} after ${attempt} retries`);
    return get(path, attempt + 1);
  }
  if (!res.ok) return { __error: res.status };
  return res.json();
}

// Identifiers come from the snapshot we already hold, so the listing endpoints
// are not walked at all — one fewer thing to ask the server for.
function idsFromSnapshot() {
  const recs = JSON.parse(gunzipSync(readFileSync('data/sources/dti-registry.json.gz'))).records;
  const key = KIND === 'token' ? 'DTI' : 'DLI';
  return [...new Set(recs.map((r) => r.Header?.[key]).filter(Boolean))];
}

// Shards are assigned by index so the split is deterministic and a resumed run
// always gets the same slice.
const all = idsFromSnapshot().filter((_, i) => i % shardN === shardI);
// Records already fetched by ANY shard are skipped, so re-sharding a partial
// crawl never re-requests what is already on disk.
const everywhere = new Set();
for (const f of readdirSync(OUT).filter((f) => f.startsWith(`${KIND}s`) && f.endsWith('.ndjson'))) {
  for (const line of readFileSync(`${OUT}/${f}`, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { everywhere.add(JSON.parse(line).__id); } catch {}
  }
}
const ids = all.filter((id) => !everywhere.has(id));
console.error(`${KIND}s: ${ids.length} to fetch (${done.size} already on disk), ~${Math.round((ids.length * DELAY_MS) / 60000)} min at ${DELAY_MS}ms`);

let ok = 0, err = 0;
for (const [i, id] of ids.entries()) {
  try {
    const rec = await get(`/${KIND}/${encodeURIComponent(id)}`);
    appendFileSync(outFile, JSON.stringify({ __id: id, ...rec }) + '\n');
    rec.__error ? err++ : ok++;
  } catch (e) {
    process.stderr.write(`  ! ${id}: ${e.message}\n`);
    err++;
  }
  if ((i + 1) % 250 === 0) process.stderr.write(`  ${i + 1}/${ids.length}  ok=${ok} err=${err}\n`);
  await sleep(DELAY_MS);
}
console.error(`done: ${ok} ok, ${err} errors -> ${outFile}`);
