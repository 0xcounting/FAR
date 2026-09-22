import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const SOURCES = {
  coingeckoCoins: 'data/sources/coingecko-coins.json.gz',
  coingeckoPlatforms: 'data/sources/coingecko-platforms.json.gz',
  evmChains: 'data/sources/evm-chains.json.gz',
  // Cosmos chain-registry snapshot (chain_id, bech32 prefix, native denom, CoinGecko id per chain) -- see SOURCES.md.
  cosmosChainRegistry: 'data/sources/cosmos-chain-registry.json.gz',
  // Hash-verified ICS-20 voucher traces from the 0xcounting.com IBC sweep -- see SOURCES.md and src/lib/ics20.js.
  ibcDenomTraces: 'data/sources/ibc-denom-traces.json.gz',
};

// Every build records the sha256 of the exact bytes it read. That hash travels
// into the published manifest, so a consumer can tell whether two dumps were
// built from the same inputs without re-downloading the inputs.
export function loadSources() {
  const provenance = {};
  const out = {};
  for (const [key, path] of Object.entries(SOURCES)) {
    const raw = readFileSync(path);
    provenance[key] = { path, sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length };
    out[key] = JSON.parse(gunzipSync(raw));
  }
  return { ...out, provenance };
}
