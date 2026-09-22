#!/usr/bin/env node
// Regenerates data/chains.json: the CAIP-2 identity of every Cosmos chain the
// registry can name, whether or not CoinGecko has a platform for it.
//
// WHY A SEPARATE TABLE. data/platforms.json is keyed by CoinGecko platform
// slug, so a chain only exists there if CoinGecko files tokens under it. That
// leaves two holes: (1) chains with no CoinGecko platform at all cannot be
// named, so an IBC voucher whose ORIGIN is one of them cannot be resolved back
// to its origin identity; (2) a CoinGecko platform that carries no token
// deployments (Celestia, Stride, Axelar, ...) never enters the platform table
// either, even though its native coin is a CoinGecko asset. A chain is an
// identity in its own right; this table names it once, and platforms.json and
// the ics20 voucher pass both key off it.
//
// SOURCE. data/sources/cosmos-chain-registry.json.gz, a slim snapshot of the
// cosmos/chain-registry (CC-BY-4.0) as aggregated by chains.cosmos.directory:
// chain_name, chain_id, bech32 prefix, slip44, the fee/staking denom and the
// CoinGecko id of the native coin where the registry records one. Mainnets only.
//
// CONFIDENCE. `high` when the chain is exercised in the 0xcounting.com
// production ingest (its native coin id appears on a cosmos-band row of the
// vendored core-chains table) -- the same evidence rule platforms.json uses.
// Otherwise `medium`: read mechanically from the chain's own chain.json in the
// registry (the primary source, keyed by the chain's own id), not matched on a
// name. Nothing here is a model assertion.
//
// Entries flagged `"curated": true` in the existing file are PRESERVED across
// regeneration; everything else is overwritten. Run, then re-run
// `node src/validate.js`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { cosmosCaip2 } from '../src/lib/caip.js';

const rd = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const registry = rd('data/sources/cosmos-chain-registry.json.gz');
const coreChains = rd('data/sources/core-chains.json.gz');
const coins = new Set(rd('data/sources/coingecko-coins.json.gz').map((c) => c.id));
const platforms = JSON.parse(readFileSync('data/platforms.json', 'utf8')).platforms;

// Native coin ids the production ingest exercises on the cosmos band
// (synthetic ids 2.1e9 <= id < 2.14e9 in the upstream table).
const productionNativeCoins = new Set(
  coreChains.filter((c) => c.chainId >= 2_100_000_000 && c.chainId < 2_140_000_000 && c.coingeckoNativeCoinId)
    .map((c) => c.coingeckoNativeCoinId),
);
// A CoinGecko platform whose CAIP-2 is this chain, if any (reverse of platforms.json).
// Keyed by the chain's CAIP-2 AND by its unhashed `cosmos:<chain_id>` spelling:
// platforms.json predates the hashed rule and still serves e.g.
// `cosmos:aura_6322-2`, which the cosmos profile says must be hashed. Changing a
// served identifier is a judgement change (GOVERNANCE.md), so the legacy
// spelling is recognised here rather than rewritten.
const platformByCaip2 = new Map();
for (const [slug, p] of Object.entries(platforms)) if (!platformByCaip2.has(p.caip2)) platformByCaip2.set(p.caip2, slug);
const platformFor = (caip2, chainId) => platformByCaip2.get(caip2) ?? platformByCaip2.get(`cosmos:${chainId}`) ?? null;

const existing = existsSync('data/chains.json') ? JSON.parse(readFileSync('data/chains.json', 'utf8')).chains : {};
const chains = {};
// Curated rows survive; their DERIVED cross-link to platforms.json is refreshed.
for (const [caip2, e] of Object.entries(existing)) if (e.curated) chains[caip2] = { ...e, coingeckoPlatform: platformFor(caip2, e.chainId) };

let high = 0;
for (const c of registry) {
  const caip2 = cosmosCaip2(c.chainId);
  if (!caip2 || chains[caip2]?.curated) continue;
  const hashed = caip2.startsWith('cosmos:hashed-');
  const coingeckoId = c.coingeckoId && coins.has(c.coingeckoId) ? c.coingeckoId : null;
  const production = coingeckoId != null && productionNativeCoins.has(coingeckoId);
  if (production) high++;
  const evidence = [
    `cosmos/chain-registry ${c.chainName}/chain.json: chain_id=${c.chainId}, bech32_prefix=${c.bech32Prefix}, slip44=${c.slip44}, denom ${c.nativeDenom}` +
      (c.coingeckoId ? `, coingecko_id=${c.coingeckoId}` : ''),
    'ChainAgnostic/namespaces cosmos/caip2.md' + (hashed
      ? ` (chain_id "${c.chainId}" fails the direct-reference grammar [-a-zA-Z0-9]{1,32}, so the reference is hashed- + first 16 hex of sha256)`
      : ' (reference = the chain-id verbatim)'),
  ];
  if (production) evidence.unshift('0xcounting.com production ingest (chain table)');
  chains[caip2] = {
    namespace: 'cosmos',
    chainId: c.chainId,
    name: c.prettyName,
    registryName: c.chainName,
    bech32Prefix: c.bech32Prefix,
    slip44: c.slip44,
    nativeDenom: c.nativeDenom,
    nativeSymbol: c.nativeSymbol,
    nativeDecimals: c.nativeDecimals,
    coingeckoNativeCoinId: coingeckoId,
    coingeckoPlatform: platformFor(caip2, c.chainId),
    confidence: production ? 'high' : 'medium',
    evidence,
    note: hashed ? `chain_id "${c.chainId}" is not a legal direct CAIP-2 reference under the cosmos profile; consumers must hash it the same way to match.` : null,
  };
}

const sorted = Object.fromEntries(Object.entries(chains).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const out = {
  $schema: './../schema/chains.schema.json',
  _readme: 'CAIP-2 -> chain identity for Cosmos SDK chains, generated by scripts/gen-chains.js from data/sources/cosmos-chain-registry.json.gz. Independent of CoinGecko: a chain is named here whether or not CoinGecko files tokens under it. `coingeckoPlatform` is the platforms.json slug whose caip2 is this chain, when one exists. Entries flagged `curated: true` survive regeneration. `chainId` is the Tendermint chain_id; the CAIP-2 reference is that id verbatim, or hashed per cosmos/caip2.md when the id fails the direct grammar (see `note`).',
  chains: sorted,
};
writeFileSync('data/chains.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`chains.json: ${Object.keys(sorted).length} chains (${high} high, ${Object.values(sorted).filter((c) => c.curated).length} curated, ${Object.values(sorted).filter((c) => c.coingeckoPlatform).length} with a CoinGecko platform, ${Object.values(sorted).filter((c) => c.note).length} hashed references)`);
