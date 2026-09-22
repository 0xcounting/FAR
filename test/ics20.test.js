import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ics20Hash, verifyIcs20Trace, placeIcs20Vouchers, caip19Of } from '../src/lib/ics20.js';
import { isValidCaip19 } from '../src/lib/caip.js';

// The canonical example: ATOM on Osmosis over channel-0. Anyone can recompute it.
const ATOM_ON_OSMOSIS = {
  chainId: 'osmosis-1',
  denom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
  path: 'transfer/channel-0',
  baseDenom: 'uatom',
  originChainId: 'cosmoshub-4',
};

test('the ICS-20 hash reproduces a well-known voucher and rejects a tampered one', () => {
  assert.equal(ics20Hash('transfer/channel-0', 'uatom'), '27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2');
  assert.ok(verifyIcs20Trace(ATOM_ON_OSMOSIS));
  assert.ok(!verifyIcs20Trace({ ...ATOM_ON_OSMOSIS, baseDenom: 'uosmo' }), 'wrong base denom');
  assert.ok(!verifyIcs20Trace({ ...ATOM_ON_OSMOSIS, path: 'transfer/channel-1' }), 'wrong channel');
  assert.ok(!verifyIcs20Trace({ ...ATOM_ON_OSMOSIS, denom: ATOM_ON_OSMOSIS.denom.toLowerCase() }), 'denoms are upper-case hex on chain');
  assert.ok(!verifyIcs20Trace({ ...ATOM_ON_OSMOSIS, path: '' }), 'no path, nothing to verify');
});

test('every vendored trace verifies -- the source cannot carry a false mapping', () => {
  const traces = JSON.parse(gunzipSync(readFileSync('data/sources/ibc-denom-traces.json.gz')));
  const bad = traces.filter((t) => !verifyIcs20Trace(t));
  assert.equal(bad.length, 0, `${bad.length} rows do not reproduce their hash, e.g. ${JSON.stringify(bad[0])}`);
  // Sorted (chainId, denom) so the snapshot diffs cleanly and the build is deterministic.
  for (let i = 1; i < traces.length; i++) {
    const a = traces[i - 1], b = traces[i];
    assert.ok(a.chainId < b.chainId || (a.chainId === b.chainId && a.denom < b.denom), `not sorted at ${i}`);
  }
});

test('placement uses only identities the registry already holds, and says how', () => {
  const chainTable = {
    'cosmos:cosmoshub-4': { namespace: 'cosmos', chainId: 'cosmoshub-4', name: 'Cosmos Hub', nativeDenom: 'uatom', coingeckoNativeCoinId: 'cosmos', confidence: 'high' },
    'cosmos:osmosis-1': { namespace: 'cosmos', chainId: 'osmosis-1', name: 'Osmosis', nativeDenom: 'uosmo', coingeckoNativeCoinId: 'osmosis', confidence: 'high' },
    'cosmos:juno-1': { namespace: 'cosmos', chainId: 'juno-1', name: 'Juno', nativeDenom: 'ujuno', coingeckoNativeCoinId: null, confidence: 'medium' },
  };
  const platformTable = { platforms: { osmosis: { caip2: 'cosmos:osmosis-1' }, cosmos: { caip2: 'cosmos:cosmoshub-4' } } };
  const coinsById = new Map([
    ['cosmos', { coingeckoId: 'cosmos', deployments: [] }],
    ['osmosis', { coingeckoId: 'osmosis', deployments: [] }],
    ['weth', { coingeckoId: 'weth', deployments: [{ caip19: 'eip155:1/erc20:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', caip2: 'eip155:1', assetNamespace: 'erc20', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' }] }],
    ['some-juno-token', { coingeckoId: 'some-juno-token', deployments: [{ caip19: 'cosmos:osmosis-1/ics20:AAAA', caip2: 'cosmos:osmosis-1', assetNamespace: 'ics20', address: 'ibc/AAAA' }] }],
  ]);
  // Rebuild the AAAA voucher honestly so it verifies: a cw20 from juno crossing channel-42.
  const junoCw20 = 'juno1qsrercqegvs4ye0yqg93knv73ye5dc3prqwd6jcdcuj8ggp6w0us66deup';
  const AAAA = ics20Hash('transfer/channel-42', junoCw20);
  coinsById.get('some-juno-token').deployments[0] = { caip19: `cosmos:osmosis-1/ics20:${AAAA}`, caip2: 'cosmos:osmosis-1', assetNamespace: 'ics20', address: `ibc/${AAAA}` };
  const mk = (chainId, path, baseDenom, originChainId) => ({ chainId, denom: `ibc/${ics20Hash(path, baseDenom)}`, path, baseDenom, originChainId, resolvedBy: 'test' });
  const traces = [
    mk('osmosis-1', 'transfer/channel-0', 'uatom', 'cosmoshub-4'),                 // origin-identity via the chain table's native coin
    mk('cosmoshub-4', 'transfer/channel-141', 'uosmo', 'osmosis-1'),               // origin-identity
    mk('osmosis-1', 'transfer/channel-208', 'gravity0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'gravity-bridge-3'), // eth-erc20 (case-folded)
    mk('cosmoshub-4', 'transfer/channel-207', junoCw20, 'juno-1'),                 // ibc-canonical via the listed osmosis voucher
    mk('osmosis-1', 'transfer/channel-42', junoCw20, 'juno-1'),                    // already listed by CoinGecko: gets `verified`, adds nothing
    mk('osmosis-1', 'transfer/channel-9', 'unobtainium', 'nowhere-1'),             // unplaced, origin known
    { ...mk('osmosis-1', 'transfer/channel-9', 'uatom', 'cosmoshub-4'), denom: 'ibc/DEADBEEF' }, // tampered: rejected
    mk('osmosis-1', 'transfer/channel-3', 'ujuno', null),                          // unplaced, origin unknown
  ];
  const { stats, unplaced } = placeIcs20Vouchers(traces, { coinsById, chainTable, platformTable });
  assert.deepEqual({ ...stats, placedVia: undefined }, { verified: 7, rejected: 1, alreadyListed: 1, placed: 4, unplaced: 2, placedVia: undefined });
  assert.deepEqual(stats.placedVia, { 'origin-identity': 2, 'eth-erc20': 1, 'ibc-canonical': 1 });
  const atom = coinsById.get('cosmos').deployments[0];
  assert.equal(atom.caip19, `cosmos:osmosis-1/ics20:${ATOM_ON_OSMOSIS.denom.slice(4)}`);
  assert.equal(atom.coingeckoPlatform, 'osmosis');
  assert.equal(atom.chainName, 'Osmosis');
  assert.equal(atom.confidence, 'high');
  assert.equal(atom.verified.placedVia, 'origin-identity');
  assert.equal(atom.verified.origin, 'cosmos:cosmoshub-4/bank:uatom');
  assert.equal(coinsById.get('weth').deployments[1].verified.placedVia, 'eth-erc20');
  assert.equal(coinsById.get('some-juno-token').deployments.length, 2, 'canonical sibling added on cosmoshub-4');
  assert.ok(coinsById.get('some-juno-token').deployments[0].verified, 'the CoinGecko-listed voucher carries provenance now');
  assert.equal(unplaced.length, 2);
  assert.equal(unplaced.find((u) => u.baseDenom === 'unobtainium').equivalentTo, 'cosmos:nowhere-1/bank:unobtainium');
  assert.equal(unplaced.find((u) => u.baseDenom === 'ujuno').equivalentTo, null, 'no origin, no equivalence claimed');
  for (const coin of coinsById.values()) for (const d of coin.deployments) assert.ok(isValidCaip19(d.caip19), d.caip19);
});

test('origin CAIP-19s are legal for every denom shape the traces carry', () => {
  assert.equal(caip19Of('cosmos:osmosis-1', 'uosmo'), 'cosmos:osmosis-1/bank:uosmo');
  assert.equal(caip19Of('cosmos:neutron-1', 'factory/neutron1abc/TAB'), 'cosmos:neutron-1/factory:neutron1abc%2FTAB');
  assert.equal(caip19Of('cosmos:cosmoshub-4', 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'), 'cosmos:cosmoshub-4/ics20:27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2');
  assert.equal(caip19Of('cosmos:gravity-bridge-3', 'gravity0xb2cABf797bc907B049e4cCB5b84d13be3a8CFC21'), 'cosmos:gravity-bridge-3/bank:gravity0xb2cABf797bc907B049e4cCB5b84d13be3a8CFC21');
});

test('published voucher deployments are valid and carry their verification', { skip: !existsSync('dist/_ics20-unplaced.json') }, () => {
  const far = JSON.parse(gunzipSync(readFileSync('dist/far.json.gz')));
  let verified = 0;
  for (const a of far.assets) for (const d of a.deployments) {
    if (d.assetNamespace !== 'ics20') continue;
    assert.ok(isValidCaip19(d.caip19), d.caip19);
    // CoinGecko lists a few vouchers with a lower-case hash and FAR serves that
    // spelling (see the issue on non-round-tripping CoinGecko spellings); the
    // chain writes upper-case. Compare case-blind, since hex case is not identity.
    if (d.verified) { verified++; assert.equal(`ibc/${ics20Hash(d.verified.path, d.verified.baseDenom)}`, d.address.toUpperCase().replace(/^IBC\//, 'ibc/'), d.caip19); }
  }
  assert.ok(verified > 4000, `expected thousands of verified voucher deployments, got ${verified}`);
  const unplaced = JSON.parse(readFileSync('dist/_ics20-unplaced.json', 'utf8'));
  for (const u of unplaced.vouchers) { assert.ok(isValidCaip19(u.caip19)); if (u.equivalentTo) assert.ok(isValidCaip19(u.equivalentTo), u.equivalentTo); }
});
