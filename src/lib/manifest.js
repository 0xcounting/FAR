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
