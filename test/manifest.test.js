import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, merkleRoot, merkleProof, merkleProofs, verifyProof } from '../src/lib/manifest.js';

const entries = (n) => Array.from({ length: n }, (_, i) => ({ path: `f/${String(i).padStart(3, '0')}.json`, sha256: sha256(Buffer.from(`body-${i}`)) }));

test('root is independent of input order', () => {
  const e = entries(37);
  const shuffled = [...e].sort(() => 0.5 - Math.random());
  assert.equal(merkleRoot(e), merkleRoot(shuffled));
});

test('odd leaves are promoted, not duplicated (CVE-2012-2459)', () => {
  // Duplicating the last leaf would make these two trees collide.
  const a = entries(3);
  const b = [...a, { ...a[2] }];               // same last leaf twice
  assert.notEqual(merkleRoot(a), merkleRoot(b));
});

test('every bulk proof verifies against the root, and matches the single-proof path', () => {
  for (const n of [1, 2, 3, 8, 37, 1000]) {
    const e = entries(n);
    const root = merkleRoot(e);
    const all = merkleProofs(e);
    assert.equal(all.size, n);
    for (const x of e) {
      const proof = all.get(x.path);
      assert.ok(verifyProof(x.path, x.sha256, proof, root), `n=${n} ${x.path}`);
      assert.deepEqual(proof, merkleProof(e, x.path));
      assert.ok(proof.length <= Math.ceil(Math.log2(n)) || n === 1, 'proof is logarithmic');
    }
  }
});

test('a proof does not verify a different file, path or root', () => {
  const e = entries(16);
  const root = merkleRoot(e);
  const proof = merkleProofs(e).get(e[5].path);
  assert.ok(!verifyProof(e[5].path, sha256(Buffer.from('tampered')), proof, root));
  assert.ok(!verifyProof(e[6].path, e[5].sha256, proof, root));
  assert.ok(!verifyProof(e[5].path, e[5].sha256, proof, merkleRoot(entries(17))));
});
