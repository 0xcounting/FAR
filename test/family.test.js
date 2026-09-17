import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationIndex, classify, isDerivative } from '../src/lib/family.js';

const asset = (coingeckoId, symbol, extra = {}) =>
  ({ coingeckoId, name: coingeckoId, symbol, dti: [], deployments: [], ...extra });

test('an id that is an ordinary word is not a family head just because other ids contain it', () => {
  const assets = [
    asset('token', 'TOKEN'),
    asset('some-token', 'SMT'), asset('other-token', 'OTK'), asset('token-dao', 'TDAO'),
    asset('bitcoin', 'BTC'),
    asset('wrapped-bitcoin', 'WBTC'), asset('bitcoin-bep2', 'BTCB'),
  ];
  const idx = citationIndex(assets);
  assert.equal(idx.get('token').citedBy, 3);
  assert.equal(idx.get('token').corroborated, 0, 'none of them carry the TOKEN ticker');
  assert.equal(idx.get('bitcoin').corroborated, 1, 'wrapped-bitcoin declares itself a wrapper and carries BTC; bitcoin-bep2 does neither');
  assert.equal(classify(assets[0], idx).family, 'standalone');
  assert.equal(classify(assets[4], idx).family, 'canonical');
});

test('sharing a word and a substring of the ticker is not corroboration', () => {
  const assets = [asset('baby', 'BABY'), asset('baby-doge-coin', 'BABYDOGE'), asset('baby-pepe', 'BPEPE'), asset('bridged-baby', 'BABY')];
  const idx = citationIndex(assets);
  assert.equal(idx.get('baby').citedBy, 3);
  assert.equal(idx.get('baby').corroborated, 1, 'only the bridged copy with the identical ticker counts');
});

test('a self-declared wrapper is a derivative even when it is itself widely cited', () => {
  const assets = [asset('bridged-usdc', 'USDC'), asset('celer-bridged-usdc-astar', 'USDC'), asset('usd-coin', 'USDC')];
  const idx = citationIndex(assets);
  assert.ok(isDerivative('bridged-usdc', 'Bridged USDC'));
  assert.equal(classify(assets[0], idx).family, 'derivative');
});

test('a second registry attesting the asset makes it a head without any citation', () => {
  const a = asset('lonely', 'LNLY', { deployments: [{ assetNamespace: 'slip44' }] });
  assert.equal(classify(a, citationIndex([a])).family, 'canonical');
  assert.equal(classify(a, citationIndex([a])).attested, true);
});
