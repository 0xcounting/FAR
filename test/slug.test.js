import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug, caipPath, unCaipPath, isDegenerateSlug } from '../src/lib/slug.js';

test('slug is lowercase, hyphen-separated and idempotent', () => {
  assert.equal(slug('USD Coin'), 'usd-coin');
  assert.equal(slug('  Wrapped   Ether!! '), 'wrapped-ether');
  assert.equal(slug(slug('Aave (Wormhole)')), slug('Aave (Wormhole)'));
});

test('a name with no usable characters slugs to the degenerate marker', () => {
  assert.ok(isDegenerateSlug(slug('🚀🚀')));
  assert.ok(isDegenerateSlug(slug('...')));
  assert.ok(!isDegenerateSlug(slug('a')));
});

test('directory-style routing is reversible, including the cases that broke "_" mapping', () => {
  for (const id of [
    'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7',
    'starknet:SN_MAIN/erc20:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    'sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7%3A%3Ausdc%3A%3AUSDC',
    'cosmos:osmosis-1/ics20:27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
    'polkadot:91b171bb158e2d3848fa23a9f1c25182/slip44:354',
  ]) {
    const p = caipPath(id);
    assert.ok(!p.includes(':'), `path must not contain ":" (${p})`);
    assert.ok(!p.includes('%'), `path must not contain "%" (${p})`);
    assert.equal(unCaipPath(p), id);
  }
});
