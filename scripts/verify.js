#!/usr/bin/env node
// Verifies a file you fetched against a published release.
//
// Two ways to do it. With the manifest (11 MB, lists every file):
//
//   node scripts/verify.js manifest.json dist/cg/tether.json cg/tether.json
//   node scripts/verify.js manifest.json dist/cg/tether.json cg/tether.json --proof
//
// Or with the file's own proof and the published root, no manifest at all:
//
//   curl -sO https://0xcounting.github.io/FAR/proof/cg/tether.json
//   node scripts/verify.js --proof-file tether.json dist/cg/tether.json <merkleRoot>
//
// The second form is what the Merkle tree is for: ~17 hashes and one 64-char
// root decide whether the file belongs to the release, without trusting or
// downloading the rest of it.
import { readFileSync } from 'node:fs';
import { sha256, merkleRoot, merkleProof, verifyProof } from '../src/lib/manifest.js';

const args = process.argv.slice(2);

if (args[0] === '--proof-file') {
  const [, proofPath, filePath, root] = args;
  if (!proofPath || !filePath) {
    console.error('usage: verify.js --proof-file <proof.json> <local file> [merkleRoot]');
    process.exit(2);
  }
  const p = JSON.parse(readFileSync(proofPath, 'utf8'));
  const digest = sha256(readFileSync(filePath));
  if (p.sha256 !== digest) {
    console.error(`FAIL: content mismatch\n  proof    ${p.sha256}\n  actual   ${digest}`);
    process.exit(1);
  }
  // The root to check against should come from somewhere you trust: the build
  // log, a release note, a value you pinned. Falling back to the one inside the
  // proof file only proves the proof is self-consistent, and says so.
  const expected = root ?? p.merkleRoot;
  if (!verifyProof(p.path, digest, p.proof, expected)) {
    console.error(`FAIL: ${p.path} is not in the release with root ${expected}`);
    process.exit(1);
  }
  console.log(`ok: ${p.path} matches (${digest})`);
  console.log(root
    ? `ok: inclusion proven against the root you supplied (${p.proof.length} hashes)`
    : `ok: inclusion proven against the root in the proof file (${p.proof.length} hashes) — pass the published root as a 4th argument to check against a value you trust`);
  process.exit(0);
}

const [manifestPath, filePath, publishedPath] = args;
if (!manifestPath || !filePath || !publishedPath) {
  console.error('usage: verify.js <manifest.json> <local file> <published path> [--proof]\n       verify.js --proof-file <proof.json> <local file> [merkleRoot]');
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

if (args.includes('--proof')) {
  // Recomputing the root from the full file list proves the manifest is
  // internally consistent — that the root it advertises is the root its own
  // entries produce, not a number someone typed in.
  const recomputed = merkleRoot(manifest.files);
  if (recomputed !== manifest.merkleRoot) {
    console.error(`FAIL: manifest root ${manifest.merkleRoot} != recomputed ${recomputed}`);
    process.exit(1);
  }
  const proof = merkleProof(manifest.files, publishedPath);
  if (!verifyProof(publishedPath, digest, proof, recomputed)) {
    console.error('FAIL: inclusion proof does not reproduce the root');
    process.exit(1);
  }
  console.log(`ok: merkle root ${recomputed} (inclusion proof: ${proof.length} hashes)`);
}
