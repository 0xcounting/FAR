import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { cosmosCaip2, isValidCaip2 } from '../src/lib/caip.js';

test('cosmosCaip2 follows the cosmos profile, including its own test vectors', () => {
  // Direct references: the chain_id verbatim.
  assert.equal(cosmosCaip2('cosmoshub-4'), 'cosmos:cosmoshub-4');
  assert.equal(cosmosCaip2('Binance-Chain-Tigris'), 'cosmos:Binance-Chain-Tigris');
  assert.equal(cosmosCaip2('x'), 'cosmos:x');
  assert.equal(cosmosCaip2('hashed'), 'cosmos:hashed', '"hashed" without the dash is a direct reference');
  // Test vectors from ChainAgnostic/namespaces cosmos/caip2.md.
  assert.equal(cosmosCaip2('hashed-123'), 'cosmos:hashed-99df5cd68192b33e');
  assert.equal(cosmosCaip2('123456789012345678901234567890123456789012345678'), 'cosmos:hashed-0204c92a0388779d');
  assert.equal(cosmosCaip2(' '), 'cosmos:hashed-36a9e7f1c95b82ff');
  // The profile's direct grammar is [-a-zA-Z0-9]{1,32}: no dot, no underscore.
  // Both shapes exist in the wild and both must hash, or a consumer following
  // the spec will never find our row.
  assert.equal(cosmosCaip2('shentu-2.2'), 'cosmos:hashed-51f160d71ca1f6d9');
  assert.match(cosmosCaip2('kava_2222-10'), /^cosmos:hashed-[0-9a-f]{16}$/);
  assert.equal(cosmosCaip2(''), null);
  for (const id of ['osmosis-1', 'shentu-2.2', 'kava_2222-10']) assert.ok(isValidCaip2(cosmosCaip2(id)));
});

test('every chain-registry row lands in chains.json under the CAIP-2 its id derives to', () => {
  const registry = JSON.parse(gunzipSync(readFileSync('data/sources/cosmos-chain-registry.json.gz')));
  const chains = JSON.parse(readFileSync('data/chains.json', 'utf8')).chains;
  for (const c of registry) {
    const caip2 = cosmosCaip2(c.chainId);
    assert.ok(chains[caip2], `${c.chainName} (${c.chainId}) -> ${caip2} missing from chains.json`);
    assert.equal(chains[caip2].chainId, c.chainId);
    assert.equal(chains[caip2].registryName, c.chainName);
  }
  // Keys are sorted, so the generator is deterministic and diffs are readable.
  const keys = Object.keys(chains);
  assert.deepEqual(keys, [...keys].sort());
});

test('platforms.json and chains.json agree on every Cosmos chain', () => {
  const platforms = JSON.parse(readFileSync('data/platforms.json', 'utf8')).platforms;
  const chains = JSON.parse(readFileSync('data/chains.json', 'utf8')).chains;
  const byRawId = new Map(Object.values(chains).map((c) => [`cosmos:${c.chainId}`, c]));
  for (const [slug, p] of Object.entries(platforms)) {
    if (!p.caip2.startsWith('cosmos:')) continue;
    // Legacy unhashed spellings (cosmos:aura_6322-2) are accepted, not rewritten.
    assert.ok(chains[p.caip2] ?? byRawId.get(p.caip2), `platform ${slug} points at ${p.caip2}, unknown to chains.json`);
  }
  for (const [caip2, c] of Object.entries(chains)) {
    if (!c.coingeckoPlatform) continue;
    const got = platforms[c.coingeckoPlatform]?.caip2;
    assert.ok(got === caip2 || got === `cosmos:${c.chainId}`, `${caip2} names platform ${c.coingeckoPlatform} which maps to ${got}`);
  }
});
