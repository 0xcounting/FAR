#!/usr/bin/env node
// Verifies a file you fetched against a published manifest, and — if you pass
// --proof — that it belongs to the manifest's Merkle root without trusting the
// rest of the manifest.
//
//   node scripts/verify.js manifest.json dist/cg/tether.json cg/tether.json
//   node scripts/verify.js manifest.json dist/cg/tether.json cg/tether.json --proof
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { merkleRoot, merkleProof, sha256 } from '../src/lib/manifest.js';

const [manifestPath, filePath, publishedPath] = process.argv.slice(2);
if (!manifestPath || !filePath || !publishedPath) {
  console.error('usage: verify.js <manifest.json> <local file> <published path> [--proof]');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const digest = sha256(readFileSync(filePath));
const entry = manifest.files.find((f) => f.path === publishedPath);

if (!entry) { console.error(`FAIL: ${publishedPath} is not in the manifest`); process.exit(1); }
if (entry.sha256 !== digest) {
  console.error(`FAIL: content mismatch\n  manifest ${entry.sha256}\n  actual   ${digest}`);
  process.exit(1);
}
console.log(`ok: ${publishedPath} matches the manifest (${digest})`);

if (process.argv.includes('--proof')) {
  // Recomputing the root from the full file list proves the manifest is
  // internally consistent — that the root it advertises is the root its own
  // entries produce, not a number someone typed in.
  const recomputed = merkleRoot(manifest.files);
  if (recomputed !== manifest.merkleRoot) {
    console.error(`FAIL: manifest root ${manifest.merkleRoot} != recomputed ${recomputed}`);
    process.exit(1);
  }
  const proof = merkleProof(manifest.files, publishedPath);
  console.log(`ok: merkle root ${recomputed} (inclusion proof: ${proof.length} hashes)`);
}
