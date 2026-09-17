import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isValidCaip2, isValidCaip19, percentEncodeRef, percentDecodeRef, buildCaip19 } from '../src/lib/caip.js';
import { caipPath, unCaipPath } from '../src/lib/slug.js';

test('percent-encoding is the CAIP-19-legal escape and round-trips', () => {
  for (const raw of ['0xabc::usdc::USDC', 'ibc/27394FB0', 'factory/inj1x/aus', 'a_b', 'x<y>,z']) {
    const enc = percentEncodeRef(raw);
    assert.match(enc, /^[-.%a-zA-Z0-9]+$/, `encoded form must be CAIP-19 legal: ${enc}`);
    assert.equal(percentDecodeRef(enc), raw);
  }
});

test('CAIP-2 and CAIP-19 validators accept the ratified shapes and reject the rest', () => {
  assert.ok(isValidCaip2('eip155:1'));
  assert.ok(isValidCaip2('tron:728126428'));
  assert.ok(isValidCaip2('starknet:SN_MAIN'));
  assert.ok(!isValidCaip2('eip155:'), 'empty reference');
  assert.ok(!isValidCaip2('EIP155:1'), 'namespace must be lowercase');
  assert.ok(isValidCaip19('eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7'));
  assert.ok(isValidCaip19('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'));
  assert.ok(!isValidCaip19('eip155:1/erc20:0xabc::usdc'), 'colon inside the asset reference is illegal');
  assert.ok(!isValidCaip19('eip155:1/erc20:'), 'empty asset reference');
});

test('buildCaip19 rejects rather than guesses on an unrecognised address shape', () => {
  // The real table entry, so the test breaks if the entry shape changes.
  const platforms = JSON.parse(readFileSync('data/platforms.json', 'utf8')).platforms;
  const eth = platforms.ethereum;
  assert.equal(buildCaip19(eth, 'not-an-address'), null);
  assert.equal(buildCaip19(eth, ''), null);
  const usdt = buildCaip19(eth, '0xDAC17F958D2EE523A2206206994597C13D831EC7');
  assert.equal(usdt.caip19, 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7', 'EVM addresses are lowercased');
  assert.equal(usdt.assetNamespace, 'erc20');
  // Sui coin types carry "::" which is illegal in a CAIP-19 reference and must be percent-encoded.
  const usdc = buildCaip19(platforms.sui, '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC');
  assert.ok(usdc && isValidCaip19(usdc.caip19), `sui: ${JSON.stringify(usdc)}`);
  assert.ok(usdc.caip19.includes('%3A%3A') && !usdc.caip19.includes('::'));
});

test('every published deployment is valid CAIP-19 and its route round-trips', () => {
  const far = JSON.parse(gunzipSync(readFileSync('dist/far.json.gz')));
  const coins = far.coins || far.assets || Object.values(far).find(Array.isArray);
  let n = 0;
  for (const c of coins) for (const d of c.deployments ?? []) {
    assert.ok(isValidCaip19(d.caip19), `${c.coingeckoId}: ${d.caip19}`);
    assert.equal(unCaipPath(caipPath(d.caip19)), d.caip19, `route not reversible: ${d.caip19}`);
    n++;
  }
  assert.ok(n > 20000, `expected the whole registry, saw ${n} deployments`);
});
