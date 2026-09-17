// Regenerates data/platforms.json from scratch: the production chain table, a
// hand-reviewed tier, an automatic name-match tier, and hand-written non-EVM
// entries. Running this OVERWRITES hand edits made directly to the file, so it
// is a maintenance tool, not part of the build. The build reads only the
// committed data/platforms.json.
//
//   node scripts/gen-platforms.js
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const rd = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const evm = rd('data/sources/evm-chains.json.gz');
const cgp = rd('data/sources/coingecko-platforms.json.gz');
// Vendored slice of the 0xcounting.com production ingest chain table — see SOURCES.md.
const coreChains = rd('data/sources/core-chains.json.gz');

const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const byName = new Map();
for (const c of evm) for (const k of [norm(c.name), norm(c.name).replace(/mainnet$/, ''), norm(c.shortName)]) {
  if (!k) continue; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(c);
}
const chainName = new Map(evm.map((c) => [c.chainId, c.name]));

const counts = new Map(); const shapes = new Map();
for (const { platform, identity } of cgp) {
  counts.set(platform, (counts.get(platform) ?? 0) + 1);
  if (!shapes.has(platform)) shapes.set(platform, new Set());
  shapes.get(platform).add(/^0x[0-9a-fA-F]{40}$/.test(identity ?? '') ? 'evm' : 'other');
}

const evmEntry = (id, conf, ev, note = null) => ({
  caip2: `eip155:${id}`, assetNamespace: 'erc20', nativeAsset: null,
  addressFormat: 'evm-lowercase', confidence: conf,
  evidence: ev, note,
});

const platforms = {};

// ---- Tier 1: chains this project already ingests in production. ------------
// chains.json is maintained against live RPC/explorer traffic, so its
// platform -> chainId pairs are exercised daily rather than name-matched.
const SYNTHETIC_CHAINID_FLOOR = 2_000_000_000; // see note below
for (const c of coreChains) {
  if (!c.coingeckoPlatform) continue;
  // chains.json assigns SYNTHETIC ids (>= 2e9) to non-EVM chains so the rest of
  // that codebase can key everything on one integer. Those are NOT EIP-155 chain
  // IDs and must never be published as `eip155:...`. Non-EVM chains are handled
  // by the hand-written NON_EVM table below instead.
  if (c.chainId >= SYNTHETIC_CHAINID_FLOOR) continue;
  // A few chains are EVM but CoinGecko files some non-EVM identities under them
  // (Injective, Kava, Sei). Those individual rows get rejected by the address
  // validator; the platform itself is still correctly eip155.
  platforms[c.coingeckoPlatform] = evmEntry(c.chainId, 'high',
    [`0xcounting.com production ingest (chain table)`, `ethereum-lists/chains: ${chainName.get(c.chainId) ?? 'n/a'}`]);
}

// ---- Tier 2: hand-curated, verified against ethereum-lists by name+ID. -----
// Each of these was read off the candidate list by a human; the ones where the
// automatic name match was WRONG are called out in `note`.
const HAND_EVM = {
  'core':                   [1116,  'CoreDAO. Auto-match proposed eip155:4352 (MemeCore) — wrong; rejected.'],
  'hyperliquid':            [999,   'HyperEVM mainnet. ethereum-lists only carries testnet 998 under this name.'],
  'chiliz':                 [88888, null],
  'klay-token':             [8217,  'Kaia (formerly Klaytn). CoinGecko still uses the legacy klay-token slug.'],
  'plume-network':          [98866, 'Plume Mainnet. 98865 is the legacy chain; tokens may straddle both.'],
  'flare-network':          [14,    null],
  'tomochain':              [88,    'Viction (formerly TomoChain). Not under that name in ethereum-lists.'],
  'huobi-token':            [128,   'Huobi ECO Chain (HECO).'],
  'merlin-chain':           [4200,  null],
  'bob-network':            [60808, 'BOB. Distinct from Bobabeam/Bobaopera, which name-match first.'],
  'immutable':              [13371, 'Immutable zkEVM.'],
  'velas':                  [106,   'Velas EVM Mainnet.'],
  'conflux':                [1030,  'Conflux eSpace (the EVM-compatible space).'],
  'shibarium':              [109,   'Shibarium mainnet; 719 is Shibarium Beta.'],
  'lightlink':              [1890,  'Lightlink Phoenix Mainnet.'],
  'wemix-network':          [1111,  'WEMIX3.0 Mainnet.'],
  'telos':                  [40,    'Telos EVM Mainnet.'],
  'elastos':                [20,    'Elastos Smart Chain.'],
  'kucoin-community-chain': [321,   'KCC. Not under that name in ethereum-lists.'],
  'okex-chain':             [66,    'OKTC/OKExChain mainnet; only testnet 65 name-matches.'],
  'bsquared-network':       [223,   'B² Network.'],
  'xdc-network':            [50,    null],
  'iotex':                  [4689,  null],
  'boba':                   [288,   'Boba Ethereum mainnet; the Bobabeam/Boba Avax entries name-match first.'],
  'oasys':                  [248,   null],
  'beam':                   [4337,  'Beam. Distinct from Moonbeam (1284), which is a near name-match.'],
  'neon-evm':               [245022934, null],
  'canto':                  [7700,  null],
  'zircuit':                [48900, 'Zircuit Mainnet; 48899/48898 are testnets.'],
  'wanchain':               [888,   null],
  'arbitrum-nova':          [42170, null],
  'oasis':                  [42262, 'Oasis Emerald (the EVM paratime); Sapphire is 23294.'],
  'corn':                   [21000000, null],
  'gravity-alpha':          [1625,  null],
  'somnia':                 [5031,  null],
  'thundercore':            [108,   'ThunderCore Mainnet; 18 is the testnet.'],
  'bifrost-network':        [3068,  'Bifrost Mainnet (EVM). Distinct from Bifrost Polkadot (996).'],
  'botanix':                [3637,  'Botanix Mainnet; 3636 is the testnet.'],
  'kardiachain':            [24,    null],
  'superseed':              [5330,  null],
  'ethereum-classic':       [61,    null],
  'bitkub-chain':           [96,    'Bitkub Chain. Not under that name in ethereum-lists.'],
  '0g':                     [16661, '0G Mainnet.'],
  'zklink-nova':            [810180, null],
  'bitlayer':               [200901, 'Bitlayer Mainnet; 200810 is the testnet.'],
  'goat':                   [2345,  'GOAT Network.'],
  'doma':                   [97477, 'Doma mainnet; 97476 is the testnet.'],
  'redbelly-network':       [151,   'Redbelly Network Mainnet; 154 is TGE, 152 devnet.'],
  'bouncebit':              [6001,  'BounceBit Mainnet; 6000 is the testnet.'],
  'step-network':           [1234,  null],
  'robinhood':              [4663,  'Robinhood Chain. Carries tokenized equities, not crypto-native assets.'],
  'filecoin':               [314,   'Filecoin FEVM. Native FIL is not an FEVM ERC-20.'],
  'mantle':                 [5000,  null],
  'morph-l2':               [2818,  'Morph mainnet. Not under that name in ethereum-lists.'],
  'skale':                  [null,  'SKALE is many independent hub chains; one CoinGecko slug cannot address them.'],
  'milkomeda-cardano':      [2001,  'Milkomeda C1 (Cardano EVM sidechain).'],
};
for (const [p, [id, note]] of Object.entries(HAND_EVM)) {
  if (id === null) continue;
  platforms[p] = evmEntry(id, 'medium',
    [`hand-reviewed against ethereum-lists/chains: ${chainName.get(id) ?? 'not in list'}`], note);
}

// ---- Tier 3: auto name-match, EVM-shaped, unique hit. ---------------------
let auto = 0;
for (const [platform] of [...counts].sort((a, b) => b[1] - a[1])) {
  if (platforms[platform]) continue;
  const s = shapes.get(platform);
  if (!(s.size === 1 && s.has('evm'))) continue;
  const ids = [...new Set((byName.get(norm(platform)) ?? []).map((c) => c.chainId))];
  if (ids.length !== 1) continue;
  platforms[platform] = evmEntry(ids[0], 'low',
    [`ethereum-lists/chains unique name match: ${chainName.get(ids[0])}`],
    'Auto-matched on name alone. Not human-verified — see CONTRIBUTING.md "Confirming a low-confidence platform".');
  auto++;
}

// ---- Tier 4: non-EVM, hand-written against the CASA namespace specs. ------
const NON_EVM = {
  'solana': { caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', assetNamespace: 'token',
    nativeAsset: 'slip44:501', addressFormat: 'base58', confidence: 'high',
    evidence: ['ChainAgnostic/namespaces solana/caip2.md (mainnet genesis hash)', 'solana/caip19.md (token | nft)'] },
  'tron': { caip2: 'tron:0x2b6653dc', assetNamespace: 'trc20', nativeAsset: 'slip44:195',
    addressFormat: 'base58check', confidence: 'medium',
    evidence: ['ChainAgnostic/namespaces tron/caip2.md (mainnet 728126428 / 0x2b6653dc)'],
    note: 'CAIP-2 is ratified; there is NO ratified CAIP-19 asset namespace for Tron. "trc20" is this registry\'s provisional choice.' },
  'stellar': { caip2: 'stellar:pubnet', assetNamespace: 'asset', nativeAsset: 'slip44:148',
    addressFormat: 'stellar-asset', confidence: 'medium',
    evidence: ['ChainAgnostic/namespaces stellar/caip19.md (slip44 | asset | cap38 | sep41)'],
    note: 'CoinGecko encodes classic assets as CODE-ISSUER; Soroban SEP-41 contracts need the sep41 namespace instead.' },
  'hedera-hashgraph': { caip2: 'hedera:mainnet', assetNamespace: 'token', nativeAsset: 'slip44:3030',
    addressFormat: 'hedera-token-id', confidence: 'medium',
    evidence: ['ChainAgnostic/namespaces hedera/caip19.md (token namespace, reference = tokenID)'],
    note: 'CoinGecko stores the EVM-alias 0x form; the CAIP-19 reference is the shard.realm.num tokenID. Conversion is unresolved — see data/unmapped.' },
  'xrp': { caip2: 'xrpl:0', assetNamespace: 'token', nativeAsset: 'slip44:144',
    addressFormat: 'xrpl-currency-issuer', confidence: 'medium',
    evidence: ['ChainAgnostic/namespaces xrpl/caip19.md (token_ref = currency_code "." issuer_address)'] },
  'aptos': { caip2: 'aptos:1', assetNamespace: 'coin', nativeAsset: 'slip44:637',
    addressFormat: 'aptos-struct', confidence: 'low',
    evidence: ['ChainAgnostic/namespaces aptos/caip2.md (Mainnet = 1)'],
    note: 'No ratified CAIP-19 for Aptos. "coin" is provisional and does not distinguish coin from fungible-asset (FA) standards.' },
  'sui': { caip2: 'sui:mainnet', assetNamespace: 'coin', nativeAsset: 'slip44:784',
    addressFormat: 'sui-struct', confidence: 'low',
    evidence: ['ChainAgnostic/namespaces sui/caip2.md (^sui:(mainnet|testnet|devnet)$)'],
    note: 'No ratified CAIP-19 for Sui. "coin" is provisional.' },
  'elrond': { caip2: 'mvx:1', assetNamespace: 'esdt', nativeAsset: 'slip44:508',
    addressFormat: 'mvx-esdt', confidence: 'low',
    evidence: ['ChainAgnostic/namespaces mvx/caip2.md (Mainnet = 1)'],
    note: 'MultiversX (CoinGecko still uses the legacy "elrond" slug). No ratified CAIP-19; "esdt" is provisional.' },
  'tezos': { caip2: 'tezos:mainnet', assetNamespace: 'fa2', nativeAsset: 'slip44:1729',
    addressFormat: 'tezos-kt', confidence: 'low',
    evidence: ['ChainAgnostic/namespaces tezos/caip2.md'],
    note: 'No ratified CAIP-19. FA1.2 vs FA2 is not distinguishable from the CoinGecko identity alone.' },
  'algorand': { caip2: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k', assetNamespace: 'asa',
    nativeAsset: 'slip44:283', addressFormat: 'asa-id', confidence: 'low',
    evidence: ['ChainAgnostic/namespaces algorand/caip2.md (MainNet genesis hash)'],
    note: 'No ratified CAIP-19. "asa" (Algorand Standard Asset) is provisional.' },
  'stacks': { caip2: 'stacks:1', assetNamespace: 'sip010', nativeAsset: 'slip44:5757',
    addressFormat: 'stacks-principal', confidence: 'medium',
    evidence: ['ChainAgnostic/namespaces stacks/caip19.md (sip010 | sip009)'] },
};
for (const [k, v] of Object.entries(NON_EVM)) platforms[k] = { nativeAsset: null, note: null, ...v };


// ---- Tier 4b: Cosmos-family and other non-EVM chains dropped by the Tier 1 --
// guard. CAIP-2 references are the chains' own chain-ids, which is what
// ChainAgnostic/namespaces cosmos/caip2.md specifies.
const COSMOS = {
  'cosmos': ['cosmoshub-4', 'slip44:118'], 'osmosis': ['osmosis-1', null],
  'juno': ['juno-1', null], 'noble': ['noble-1', null], 'neutron': ['neutron-1', null],
  'archway': ['archway-1', null], 'terra': ['columbus-5', null], 'terra-2': ['phoenix-1', null],
  'saga': ['ssc-1', null],
};
for (const [p, [chainId, native]] of Object.entries(COSMOS)) {
  platforms[p] = {
    caip2: `cosmos:${chainId}`, assetNamespace: null, nativeAsset: native,
    addressFormat: 'cosmos-denom', confidence: 'medium',
    evidence: ['ChainAgnostic/namespaces cosmos/caip2.md (reference = the chain-id)'],
    note: 'No ratified CAIP-19 for Cosmos. The asset namespace is chosen per identity — ics20 for ibc/ denoms, cw20 for contract addresses, tokenfactory for factory/ denoms, native otherwise. All four are provisional.',
  };
}
const OTHER_NON_EVM = {
  'starknet': { caip2: 'starknet:SN_MAIN', assetNamespace: 'erc20', nativeAsset: 'slip44:9004',
    addressFormat: 'starknet-felt', confidence: 'low',
    evidence: ['ChainAgnostic/namespaces starknet/caip2.md'],
    note: 'CAIP-2 is ratified; CAIP-19 is not. "erc20" mirrors the Cairo token interface and is provisional.' },
  'near-protocol': { caip2: 'near:mainnet', assetNamespace: 'nep141', nativeAsset: 'slip44:397',
    addressFormat: 'near-account', confidence: 'low',
    evidence: ['no CASA namespace for NEAR — "near:mainnet" is community convention'],
    note: 'NEAR has NO ratified CAIP-2 namespace at all. Both the chain ID and the asset namespace are provisional and may change.' },
  'cardano': { caip2: 'cip34:1-764824073', assetNamespace: 'native', nativeAsset: 'slip44:1815',
    addressFormat: 'cardano-asset', confidence: 'low',
    evidence: ['CIP-34 network identifier; no CASA namespace for Cardano'],
    note: 'No ratified CAIP-2 for Cardano. Reference is policyId+assetNameHex concatenated, as CoinGecko stores it.' },
};
for (const [k, v] of Object.entries(OTHER_NON_EVM)) platforms[k] = { nativeAsset: null, note: null, ...v };

// ---- Everything left over: the public backlog. ---------------------------
const unmapped = {};
for (const [platform, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  if (platforms[platform]) continue;
  const ids = [...new Set((byName.get(norm(platform)) ?? []).map((c) => c.chainId))];
  unmapped[platform] = {
    tokens: n,
    evmShaped: shapes.get(platform).size === 1 && shapes.get(platform).has('evm'),
    candidates: ids.slice(0, 4).map((i) => `eip155:${i} (${chainName.get(i)})`),
    reason: ids.length > 1 ? 'ambiguous name match — needs a human to pick'
          : ids.length === 0 ? 'no CAIP-2 identified for this network yet'
          : 'needs review',
  };
}
unmapped['skale'] = { tokens: counts.get('skale') ?? 0, evmShaped: true, candidates: [],
  reason: 'SKALE is many independent hub chains; one CoinGecko slug cannot address them. Needs per-hub split.' };

const out = {
  $schema: './../schema/platforms.schema.json',
  _readme: 'Maps a CoinGecko platform slug to a CAIP-2 chain ID and the CAIP-19 asset namespace used for tokens on it. This file is the ONLY platform truth the build reads; nothing is derived at build time. Confidence: high = exercised in production ingest or ratified by a CASA spec; medium = hand-reviewed against a named source; low = auto name-match or a provisional namespace with no ratified spec. Raising a confidence level or clearing an entry from `unmapped` is the most useful contribution to this repo.',
  platforms,
  unmapped,
};
writeFileSync('data/platforms.json', JSON.stringify(out, null, 2) + '\n');
const byConf = {};
for (const v of Object.values(platforms)) byConf[v.confidence] = (byConf[v.confidence] ?? 0) + 1;
const tokensFor = (pred) => [...counts].filter(([p]) => pred(p)).reduce((a, [, n]) => a + n, 0);
console.log(`platforms mapped: ${Object.keys(platforms).length}  (${JSON.stringify(byConf)})   auto tier: ${auto}`);
console.log(`unmapped: ${Object.keys(unmapped).length} platforms / ${tokensFor((p) => !platforms[p])} token rows`);
console.log(`mapped token rows: ${tokensFor((p) => !!platforms[p])} of ${cgp.length}`);
