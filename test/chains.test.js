import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

// ---------------------------------------------------------------- aliases --
// Both spellings must resolve: the spec-conformant hashed key is canonical, the
// raw chain-id is what wallets, explorers and humans write. A consumer asking in
// either dialect lands on the same chain -- and never on a different one.
const table = () => JSON.parse(readFileSync('data/chains.json', 'utf8')).chains;
const aliasIndex = (chains) => {
  const m = new Map();
  for (const [caip2, c] of Object.entries(chains)) for (const a of c.aliases ?? []) m.set(a, caip2);
  return m;
};
const CASES = [
  ['kava_2222-10', 'cosmos:hashed-6d4e837e169119f0', 'kava'],          // underscore
  ['shentu-2.2', 'cosmos:hashed-51f160d71ca1f6d9', 'shentu'],           // dot
  ['aura_6322-2', 'cosmos:hashed-f9718959c90254d1', 'aura'],            // the one platform that was served unhashed
];

test('alias -> canonical: the raw chain-id spelling resolves to the hashed row', () => {
  const chains = table(); const byAlias = aliasIndex(chains);
  for (const [raw, canonical, registryName] of CASES) {
    assert.equal(cosmosCaip2(raw), canonical);
    assert.equal(byAlias.get(`cosmos:${raw}`), canonical, `alias cosmos:${raw}`);
    assert.equal(chains[canonical].chainId, raw);
    assert.equal(chains[canonical].registryName, registryName);
  }
});

test('canonical -> alias: every hashed row publishes exactly its raw spelling, and direct rows publish none', () => {
  const chains = table();
  for (const [caip2, c] of Object.entries(chains)) {
    if (caip2.startsWith('cosmos:hashed-')) assert.deepEqual(c.aliases, [`cosmos:${c.chainId}`], caip2);
    else assert.deepEqual(c.aliases ?? [], [], `${caip2} is a direct reference and needs no alias`);
  }
  for (const [, canonical] of CASES) assert.ok(chains[canonical].aliases.length === 1);
});

test('an alias can never be mistaken for a canonical reference', () => {
  const chains = table(); const byAlias = aliasIndex(chains);
  for (const [alias, owner] of byAlias) {
    assert.ok(!chains[alias], `${alias} is both an alias (of ${owner}) and a canonical key`);
    assert.ok(!alias.startsWith('cosmos:hashed-'), `${alias} looks like a hashed reference`);
    // An alias exists only because the raw id fails the direct grammar, so it
    // structurally cannot equal any other chain's direct reference.
    assert.ok(!/^cosmos:[-a-zA-Z0-9]{1,32}$/.test(alias), `${alias} would be a valid direct reference -- it should not have been hashed`);
  }
  assert.equal(new Set(byAlias.keys()).size, byAlias.size);
});

test('platforms use the canonical key, and the former unhashed aura spelling is now its alias', () => {
  const platforms = JSON.parse(readFileSync('data/platforms.json', 'utf8')).platforms;
  const byAlias = aliasIndex(table());
  for (const [slug, p] of Object.entries(platforms)) {
    if (p.caip2.startsWith('cosmos:')) assert.ok(!byAlias.has(p.caip2), `${slug}: ${p.caip2} is an alias; records carry the canonical key`);
  }
  assert.equal(platforms['aura-network'].caip2, 'cosmos:hashed-f9718959c90254d1');
  assert.equal(byAlias.get('cosmos:aura_6322-2'), 'cosmos:hashed-f9718959c90254d1');
});

test('published routes answer under both spellings and say which is canonical', { skip: !existsSync('dist/_chains.json') }, () => {
  const served = JSON.parse(readFileSync('dist/_chains.json', 'utf8'));
  for (const [raw, canonical] of CASES) assert.equal(served.aliases[`cosmos:${raw}`], canonical);
  // aura's monsterra token: served unhashed before this change, so the old path must keep resolving.
  const oldPath = 'dist/caip/cosmos/aura_6322-2/cw20/aura10jpl6rz59h6chrpx3edahntqthdmaemrc8eewvxge7e2hhxtltjqc2ucrm.json';
  const newPath = 'dist/caip/cosmos/hashed-f9718959c90254d1/cw20/aura10jpl6rz59h6chrpx3edahntqthdmaemrc8eewvxge7e2hhxtltjqc2ucrm.json';
  assert.ok(existsSync(oldPath), 'the previously served aura path must keep resolving');
  assert.ok(existsSync(newPath), 'the canonical aura path must exist');
  const viaAlias = JSON.parse(readFileSync(oldPath, 'utf8'));
  const viaCanonical = JSON.parse(readFileSync(newPath, 'utf8'));
  assert.equal(viaAlias.alias.canonical, viaCanonical.query.key);
  assert.equal(viaAlias.alias.chainAlias, 'cosmos:aura_6322-2');
  assert.equal(viaAlias.alias.chainCanonical, 'cosmos:hashed-f9718959c90254d1');
  assert.deepEqual(viaAlias.asset, viaCanonical.asset, 'both spellings return the same asset');
  assert.equal(viaCanonical.alias, undefined, 'the canonical path carries no alias object');
});
