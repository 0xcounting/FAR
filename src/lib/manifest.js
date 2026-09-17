import { createHash } from 'node:crypto';

// Integrity for a static dump.
//
// Per-file sha256 lets a consumer verify the one file they fetched. The Merkle
// root lets them verify that the file belongs to a specific published release
// WITHOUT downloading the whole manifest: given the file, its path, and an
// inclusion proof (log2(n) ≈ 17 hashes for ~83k files), the root either
// reproduces or it does not.
//
// Leaf and node prefixes differ so a leaf hash can never be replayed as an
// interior node — the standard second-preimage defence from RFC 6962.

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const leafHash = (path, digest) =>
  createHash('sha256').update('\x00').update(path).update('\x00').update(digest).digest();

const nodeHash = (l, r) => createHash('sha256').update('\x01').update(l).update(r).digest();

// Entries MUST be sorted by path before hashing, or the root depends on
// filesystem enumeration order and stops being reproducible.
export function merkleRoot(entries) {
  if (entries.length === 0) return null;
  let level = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => leafHash(e.path, e.sha256));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      // An odd node is promoted unchanged rather than duplicated: duplicating
      // it is the CVE-2012-2459 malleability bug, where two different trees
      // yield the same root.
      next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0].toString('hex');
}

export function merkleProof(entries, targetPath) {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let index = sorted.findIndex((e) => e.path === targetPath);
  if (index < 0) return null;
  let level = sorted.map((e) => leafHash(e.path, e.sha256));
  const proof = [];
  while (level.length > 1) {
    const sibling = index ^ 1;
    if (sibling < level.length) {
      proof.push({ side: index % 2 === 0 ? 'right' : 'left', hash: level[sibling].toString('hex') });
    }
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
    }
    level = next;
    index = Math.floor(index / 2);
  }
  return proof;
}

// Every inclusion proof at once, from one pass over the tree. `merkleProof`
// above rebuilds the tree per call, which is fine for a consumer checking one
// file and hopeless for a build emitting eighty thousand.
export function merkleProofs(entries) {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const proofs = sorted.map(() => []);
  let level = sorted.map((e) => leafHash(e.path, e.sha256));
  let owners = sorted.map((_, i) => [i]);   // which leaves each node's hash covers
  while (level.length > 1) {
    const next = [], nextOwners = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        for (const leaf of owners[i]) proofs[leaf].push({ side: 'right', hash: level[i + 1].toString('hex') });
        for (const leaf of owners[i + 1]) proofs[leaf].push({ side: 'left', hash: level[i].toString('hex') });
        next.push(nodeHash(level[i], level[i + 1]));
        nextOwners.push(owners[i].concat(owners[i + 1]));
      } else {
        next.push(level[i]);                  // promoted, no sibling, no proof step
        nextOwners.push(owners[i]);
      }
    }
    level = next; owners = nextOwners;
  }
  const out = new Map();
  sorted.forEach((e, i) => out.set(e.path, proofs[i]));
  return out;
}

// Recompute the root from one leaf and its proof. This is the whole point of
// the tree: a consumer holding a file, its path, ~17 hashes and the published
// root can decide whether the file is in the release without the manifest.
export function verifyProof(path, digest, proof, root) {
  let h = leafHash(path, digest);
  for (const step of proof) {
    const s = Buffer.from(step.hash, 'hex');
    h = step.side === 'right' ? nodeHash(h, s) : nodeHash(s, h);
  }
  return h.toString('hex') === root;
}
