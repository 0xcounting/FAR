# Sources, licences, and attribution

Every build records the sha256 of the exact bytes it read, and publishes them in
`/index.json` and `/manifest.json`. Two dumps built from the same snapshots are
byte-identical, so you can tell whether anything upstream moved without
re-downloading anything upstream.

## Current snapshots

| File | Bytes | sha256 |
|---|---:|---|
| `data/sources/coingecko-coins.json.gz` | 262,755 | `b53303e6686c5a18c633b6a2a4164bd982d01f82693d692d649fac8765b95ddb` |
| `data/sources/coingecko-platforms.json.gz` | 862,570 | `e3e0193d814a98cf13cbd2c474ab135f2b7051e19d948359e5650e085a4d1e31` |
| `data/sources/evm-chains.json.gz` | 60,608 | `a304489007afcd1e91db81825c327b19b58a7fcc927b6792c2786b20703799e2` |

## CoinGecko

- **What:** the public coin list and the coin→platform→contract map
  (`/api/v3/coins/list?include_platform=true`), snapshotted.
- **Attribution:** *"Price and asset identifier data by CoinGecko"* — CoinGecko's
  free tier requires attribution, and it is given here and in `/index.json`.
- **⚠️ Open question:** CoinGecko's terms are clear that attribution is required
  and less clear about wholesale redistribution of the coin list as a dataset.
  What FAR republishes is the *factual mapping* (this ID names a token at this
  address on this chain) rather than any of CoinGecko's proprietary output —
  no prices, no market data, no rankings, no logos, no descriptions. **This has
  not been cleared with CoinGecko.** If they object, the resolution is to keep
  the CoinGecko ID as a join key and drop the vendored snapshot, rebuilding the
  spine from on-chain data instead. Anyone with a view should open an issue.

## ChainAgnostic Standards Alliance (CASA)

- **What:** the CAIP-2 and CAIP-19 namespace specifications,
  <https://github.com/ChainAgnostic/namespaces>. Read as documentation; cited in
  `evidence` throughout `data/platforms.json`. Not vendored.
- **Licence:** CC0.
- **Note:** CASA has ratified a **CAIP-2** namespace for ~48 ecosystems but a
  **CAIP-19** asset namespace for only a handful. Where FAR needed an asset
  namespace that no spec defines, it chose one, marked it `low`, and said so in
  the entry's `note`. Those are this registry's opinions, not standards.
- **Not affiliated with or endorsed by CASA.**

## ethereum-lists / chains

- **What:** `https://chainid.network/chains_mini.json`, slimmed to
  `{chainId, name, shortName, nativeCurrency}`.
- **Licence:** MIT.
- **Used for:** resolving a CoinGecko platform slug to an EIP-155 chain ID, and
  for the human-readable chain name on every deployment.

## SLIP-0044

- **What:** the registered BIP-44 coin types,
  <https://github.com/satoshilabs/slips/blob/master/slip-0044.md>, parsed to
  `{coinType, symbol, name}`.
- **Licence:** MIT.
- **Used for:** the `slip44:` reference in every native asset's CAIP-19.

## 0xcounting.com production ingest

- **What:** a slimmed platform↔chain table (`chainId`, `name`, `nativeSymbol`,
  and the two CoinGecko slugs) contributed from the production ingest pipeline
  at [0xcounting.com](https://0xcounting.com). Used as `high`-confidence
  evidence because those mappings are exercised against live chain data daily
  rather than matched on a name. Vendored as
  `data/sources/core-chains.json.gz`, so this repository builds standalone.
- **Caveat recorded in code:** the upstream table assigns *synthetic* chain IDs
  ≥ 2×10⁹ to non-EVM chains for its own internal keying. Those are not EIP-155
  IDs, and `scripts/gen-platforms.js` explicitly skips them: passing one through
  would yield an identifier like `eip155:2100000002` for Osmosis. The address
  validator rejects shapes it does not recognise rather than passing them on.

## This repository

- **Code** (`src/`, `scripts/`): MIT — see `LICENSE`.
- **Curated data** (`data/platforms.json`, `data/natives.json`)
  and the published dump: **CC0-1.0** — see `LICENSE-DATA`. Copy it, sell it,
  fork it, no attribution required. Attribution is welcome and a link back helps
  people find the dispute process.
