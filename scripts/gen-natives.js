// Generates data/natives.json: the CAIP-19 identity of each chain's OWN unit of
// account. These never appear in CoinGecko's platform list (a native coin has
// no contract address), so without this table the registry cannot resolve
// "bitcoin" or "ethereum" — which are the most-queried assets it holds.
//
// CAIP-19 identifies a native asset as <caip2>/slip44:<coinType>, so every
// entry needs a coin type from the SLIP-0044 registry. Symbol matching against
// SLIP-44 is ambiguous for reused tickers, so a symbol that resolves to more
// than one coin type is skipped rather than guessed.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const rd = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const slip44 = rd('data/sources/slip44.json.gz');
const evmChains = rd('data/sources/evm-chains.json.gz');
const coins = rd('data/sources/coingecko-coins.json.gz');
const table = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
// A vendored slice of the 0xcounting.com production ingest chain table (chainId, name, native
// symbol, CoinGecko platform + native coin id). Vendored so this repo builds
// standalone; see SOURCES.md.
const coreChains = rd('data/sources/core-chains.json.gz');

const bySymbol = new Map();
for (const r of slip44) {
  const k = r.symbol.toUpperCase();
  if (!bySymbol.has(k)) bySymbol.set(k, []);
  bySymbol.get(k).push(r);
}
const chainName = new Map(evmChains.map((c) => [`eip155:${c.chainId}`, c.name]));
const coinIds = new Set(coins.map((c) => c.id));

const natives = {};
const add = (coingeckoId, entry) => {
  if (!coinIds.has(coingeckoId)) return false;
  natives[coingeckoId] ??= [];
  if (natives[coingeckoId].some((e) => e.caip19 === entry.caip19)) return false;
  natives[coingeckoId].push(entry);
  return true;
};

// --- derived: every chain this project ingests, keyed by its CoinGecko slug ---
let derived = 0;
for (const c of coreChains) {
  const id = c.coingeckoNativeCoinId;
  const sym = (c.nativeSymbol ?? '').toUpperCase();
  if (!id || !sym) continue;
  const caip2 = c.chainId < 2_000_000_000
    ? `eip155:${c.chainId}`
    : table.platforms[c.coingeckoPlatform]?.caip2;
  if (!caip2) continue;
  const hits = bySymbol.get(sym) ?? [];
  if (hits.length !== 1) continue; // ambiguous ticker — a human picks, not this script
  if (add(id, {
    caip2,
    caip19: `${caip2}/slip44:${hits[0].coinType}`,
    chainName: chainName.get(caip2) ?? c.name,
    confidence: 'medium',
    evidence: [`SLIP-0044 ${sym} = coin type ${hits[0].coinType}`, `0xcounting.com production ingest (chain table)`],
  })) derived++;
}

// --- hand-written: chains whose CAIP-2 is documented in the CASA spec itself --
const HAND = [
  ['bitcoin',      'bip122:000000000019d6689c085ae165831e93', 0,    'bip122/caip2.md example'],
  ['bitcoin-cash', 'bip122:000000000000000000651ef99cb9fcbe', 145,  'bip122/caip2.md example'],
  ['litecoin',     'bip122:12a765e31ffd4059bada1e25190f6e98', 2,    'bip122/caip2.md example'],
  ['dogecoin',     'bip122:1a91e3dace36e2be3bf030a65679fe82', 3,    'bip122/caip2.md example'],
];
for (const [id, caip2, coinType, evidence] of HAND) {
  add(id, { caip2, caip19: `${caip2}/slip44:${coinType}`, chainName: null, confidence: 'high',
    evidence: [`ChainAgnostic/namespaces ${evidence}`, `SLIP-0044 coin type ${coinType}`] });
}

// --- derived: non-EVM platforms that declared a nativeAsset in platforms.json --
for (const [platform, p] of Object.entries(table.platforms)) {
  if (!p.nativeAsset) continue;
  const owner = coreChains.find((c) => c.coingeckoPlatform === platform)?.coingeckoNativeCoinId;
  if (!owner) continue;
  add(owner, { caip2: p.caip2, caip19: `${p.caip2}/${p.nativeAsset}`, chainName: null,
    confidence: p.confidence, evidence: [`data/platforms.json nativeAsset for ${platform}`] });
}

for (const list of Object.values(natives)) list.sort((a, b) => (a.caip19 < b.caip19 ? -1 : 1));
writeFileSync('data/natives.json', JSON.stringify({
  $schema: './../schema/natives.schema.json',
  _readme: 'CAIP-19 identities for chains\' own units of account, which never appear in CoinGecko\'s platform list. A coin listed here on several chains (ETH on every L2, USDC-style natives) is the SAME asset with several chain-scoped identities — that is what CAIP-19 is for. Adding a missing native is the easiest first contribution to this repo; see CONTRIBUTING.md.',
  natives,
}, null, 2) + '\n');
console.log(`natives: ${Object.keys(natives).length} coins, ${Object.values(natives).flat().length} chain identities (${derived} derived, ${HAND.length} hand-written)`);
