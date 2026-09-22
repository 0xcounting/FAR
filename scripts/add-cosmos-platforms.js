#!/usr/bin/env node
// ADDITIVE: adds platform entries for CoinGecko asset-platforms that are Cosmos
// chains in data/chains.json but have no entry in data/platforms.json.
//
// WHY. platforms.json was generated from the coin->platform map
// (coins/list?include_platform=true), so a platform under which CoinGecko files
// NO token deployments never appeared -- even though CoinGecko's asset_platforms
// endpoint lists it and its native coin is a CoinGecko asset. Celestia, Stride,
// Axelar, Stargaze, Sei and Sommelier were all missing for exactly this reason.
// A consumer resolving "which chain is CoinGecko platform X" got nothing.
//
// THE JOIN IS MECHANICAL, NOT A NAME MATCH: asset_platforms.native_coin_id must
// equal the chain's coingecko_id in the chain-registry, and the pairing must be
// unique in both directions. Noble (native_coin_id "cosmos", it has no coin of
// its own) therefore does NOT join to the Cosmos Hub -- the hub's coin id is
// claimed by the hub's own platform -- and stays a hand-mapped entry.
//
// Never overwrites an existing entry. Removes the slug from `unmapped` if it was
// there. Prints what it added; run `node src/validate.js` afterwards.
//   node scripts/add-cosmos-platforms.js [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const dry = process.argv.includes('--dry-run');
const rd = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const assetPlatforms = rd('data/sources/coingecko-asset-platforms.json.gz');
const slip44 = rd('data/sources/slip44.json.gz');
const table = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
const chains = JSON.parse(readFileSync('data/chains.json', 'utf8')).chains;

// native coin id -> [caip2], to enforce uniqueness on the chain side
const chainsByCoin = new Map();
for (const [caip2, c] of Object.entries(chains)) {
  if (!c.coingeckoNativeCoinId) continue;
  if (!chainsByCoin.has(c.coingeckoNativeCoinId)) chainsByCoin.set(c.coingeckoNativeCoinId, []);
  chainsByCoin.get(c.coingeckoNativeCoinId).push(caip2);
}
// native coin id -> [platform id], uniqueness on the CoinGecko side
const platformsByCoin = new Map();
for (const p of assetPlatforms) {
  if (!p.native_coin_id) continue;
  if (!platformsByCoin.has(p.native_coin_id)) platformsByCoin.set(p.native_coin_id, []);
  platformsByCoin.get(p.native_coin_id).push(p.id);
}
// SLIP-0044 registration of the native asset, only when the symbol is unambiguous.
const slipBySymbol = new Map();
for (const r of slip44) { const k = r.symbol.toUpperCase(); if (!slipBySymbol.has(k)) slipBySymbol.set(k, []); slipBySymbol.get(k).push(r); }

const alreadyCaip2 = new Set(Object.values(table.platforms).map((p) => p.caip2));
const added = [];
for (const p of assetPlatforms) {
  if (table.platforms[p.id] || !p.native_coin_id) continue;
  const candidates = chainsByCoin.get(p.native_coin_id) ?? [];
  if (candidates.length !== 1) continue;
  if ((platformsByCoin.get(p.native_coin_id) ?? []).length !== 1) continue;
  const caip2 = candidates[0];
  if (alreadyCaip2.has(caip2)) continue; // that chain already has a platform entry under another slug
  const c = chains[caip2];
  // The registry's native_coin_id must ALSO be a CoinGecko coin the chain names as its own.
  if (p.chain_identifier != null) continue; // an EVM-numbered platform is not a bech32 chain entry; handled by gen-platforms
  const slips = slipBySymbol.get((c.nativeSymbol ?? '').toUpperCase()) ?? [];
  const nativeAsset = slips.length === 1 ? `slip44:${slips[0].coinType}` : null;
  table.platforms[p.id] = {
    caip2,
    assetNamespace: null,
    nativeAsset,
    addressFormat: 'cosmos-denom',
    confidence: c.confidence === 'high' ? 'high' : 'medium',
    evidence: [
      ...(c.confidence === 'high' ? ['0xcounting.com production ingest (chain table)'] : []),
      `CoinGecko asset_platforms: id=${p.id}, chain_identifier=null, native_coin_id=${p.native_coin_id}`,
      `cosmos/chain-registry ${c.registryName}/chain.json: chain_id=${c.chainId}, coingecko_id=${c.coingeckoNativeCoinId} (the join key: unique on both sides)`,
      'ChainAgnostic/namespaces cosmos/caip2.md (reference = the chain-id)',
      ...(nativeAsset ? [`SLIP-0044: ${c.nativeSymbol} = coin type ${slips[0].coinType}`] : []),
    ],
    note: 'No ratified CAIP-19 for Cosmos. The asset namespace is chosen per identity — ics20 for ibc/ denoms, cw20 for contract addresses, factory for factory/ denoms, bank otherwise. All four are provisional. Added because CoinGecko files no token deployments under this platform, so the coin->platform map never surfaced it; the chain and its native coin are nonetheless CoinGecko assets.',
  };
  delete table.unmapped[p.id];
  added.push([p.id, caip2, table.platforms[p.id].confidence, nativeAsset]);
}
added.sort();
for (const a of added) console.log(a.join('  '));
console.log(`${dry ? 'would add' : 'added'} ${added.length} platform entries`);
if (!dry && added.length) writeFileSync('data/platforms.json', `${JSON.stringify(table, null, 2)}\n`);
