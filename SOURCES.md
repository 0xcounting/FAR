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
| `data/sources/dti-registry.json.gz` | 184,290 | `f9760db90daa0878bf86a26a13b2a593b1a699376e03062b8f70a1588b1bb864` |
| `data/sources/evm-chains.json.gz` | 60,608 | `a304489007afcd1e91db81825c327b19b58a7fcc927b6792c2786b20703799e2` |
| `data/sources/cosmos-chain-registry.json.gz` | 7,098 | `64a1ba4f464cf4c156280ebc5130ea0209581ed8b0b2c5d8e1dd6a142dac847d` |
| `data/sources/ibc-denom-traces.json.gz` | 468,990 | `ddc883065345312a98b355e7fc4cb968dff8ee4b59e012dc0a6302c616a1d96c` |

## Digital Token Identifier Foundation (DTIF)

- **What:** `DTI_Data_YYYYMMDD.json`, the free monthly snapshot of the ISO 24165
  registry, from <https://dtif.org/download-dti-data/>.
- **Licence:** open. DTIF states: *"The DTI is open and may be freely reproduced,
  distributed, transmitted, or otherwise used by anyone for any purpose,
  commercial or non-commercial at no cost."* Redistribution here is within that.
- **Attribution:** Digital Token Identifier Foundation, an Etrading Software
  initiative. Given as courtesy, not obligation.
- **What is missing from the free snapshot, and why it matters:** the snapshot
  redacts most fields to the literal string `<locked>`, including
  `AuxiliaryTechnicalReference` (the contract address),
  `AuxiliaryDistributedLedger` (which chain), `AuxiliaryMechanism`,
  `AnchorBlockHash`, `UnitMultiplier` and every `Metadata` flag. What is left is
  the identifier, the type, and the names.

  **This is the single biggest constraint on this project.** With the chain and
  the address, DTI to CAIP-19 would be a mechanical join with no ambiguity.
  Without them, every link has to be inferred from a name, and names are a poor
  key: the registry holds 18 records named "Tether" and many named "USD Coin"
  that differ only in the redacted fields. Nor can that inference be scored:
  grading it would need the contract address for each DTI, which is the field
  being withheld. Links are therefore published as proposals, never as facts.

  Redaction is a tiering decision by DTIF, not a licence restriction. What the
  free snapshot does give us, we may republish, and do.

### Compliance review against DTIF's conditions

Their grant is conditional. Reviewed against what this project actually
publishes:

| Condition | Status |
|---|---|
| *"must not modify the Registry … in any way which could be misleading"* | Registry fields are reproduced unmodified and kept in a separate object from this project's own annotations, so a reader can always tell which fields are DTIF's. |
| *"must not charge any person for any redistribution"* | FAR is free, has no paid tier, and never will have one for this data. |
| *"may not use any robot … to monitor, extract or copy any Materials from the Registry (other than the permitted download of any machine-readable Materials which may be made available)"* | Complied with. The only DTIF input to this repository is the free monthly snapshot, which is the permitted machine-readable download. |
| *"We … are the owner(s) of all intellectual property rights"* | Acknowledged in `LICENSE-DATA`, which places only this project's own work under CC0 and leaves DTIF's content under DTIF's terms. |

**If DTIF would like anything changed here, the fastest route is an issue on this
repository, and the maintainers will act on it.**

- **Not affiliated with or endorsed by DTIF.**

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

## cosmos/chain-registry (via chains.cosmos.directory)

- **What:** one row per MAINNET Cosmos SDK chain — `chain_name` (the registry
  directory, stable across regenesis), `chain_id` (the Tendermint chain id the
  CAIP-2 reference derives from), bech32 prefix, `slip44`, the fee/staking denom
  with symbol and decimals, and the CoinGecko id of the native coin where the
  registry records one. Read from the aggregated feed at
  <https://chains.cosmos.directory> (ECO Stake's index of
  <https://github.com/cosmos/chain-registry>), slimmed, and vendored as
  `data/sources/cosmos-chain-registry.json.gz`. 221 chains in the current snapshot.
- **Licence:** the chain-registry is **CC-BY-4.0**. Attribution: *Cosmos
  chain-registry contributors*, aggregated by cosmos.directory (ECO Stake).
  Given here and in `_chains.json`'s `_readme`.
- **Used for:** `data/chains.json` (via `scripts/gen-chains.js`) — the CAIP-2
  identity of every Cosmos chain, whether or not CoinGecko has a platform for it;
  the `chainName` on Cosmos deployments; the join key
  (`native_coin_id == coingecko_id`) that lets `scripts/add-cosmos-platforms.js`
  map CoinGecko asset-platforms under which no token is filed.
- **What it does NOT establish:** that a chain is live. A registry row is the
  chain's own published metadata; a killed chain (Stargaze) drops out of the live
  feed and is kept in `chains.json` as a `curated` row instead, because ledgers
  still hold identifiers rooted on it.
- **Not affiliated with or endorsed by the chain-registry maintainers or ECO Stake.**

## ICS-20 denom traces (0xcounting.com IBC sweep)

- **What:** one row per IBC voucher observed on the Cosmos chains the
  0xcounting.com pipeline ingests (18 chains, 7,938 rows): the chain's
  Tendermint `chainId`, the voucher `denom` (`ibc/<HASH>`), the transfer `path`
  and `baseDenom` the minting chain filed for it (`/ibc/apps/transfer/v1/denom_traces`,
  or `/denoms` on ibc-go v9+), the `originChainId` reached by walking the path
  hop by hop through the chain-registry's `_IBC/` channel tables (live
  `client_state` queries only for uncatalogued channels), and `resolvedBy`, which
  names the authority that answered for the origin. Vendored as
  `data/sources/ibc-denom-traces.json.gz`.
- **Why it is different from every other source here:** the mapping is
  **checkable**. ICS-20 defines `HASH = uppercase(hex(sha256(path + "/" + base_denom)))`,
  so any row can be re-derived from its own two strings. `src/validate.js`
  refuses a snapshot in which any row fails; `src/build.js` drops and counts
  rather than publishes. A wrong node cannot get a row in. Published deployments
  built from this source carry a `verified` object stating the rule and its inputs.
- **What the hash does not prove:** which chain is at the far end of the path
  (`originChainId` is a walk result and is carried as provenance, not as a
  verified fact), and the origin asset's symbol or decimals, which the sweep
  resolves separately and which are deliberately **not** vendored here.
- **Licence:** the sweep's output is this project's own derived data — **CC0-1.0**
  like every other curated table. Inputs are on-chain state (no licence) and the
  cosmos/chain-registry `_IBC/` tables (CC-BY-4.0, attributed above).
- **Refresh:** replaced wholesale by the upstream sweep; a row that stops
  verifying cannot be re-vendored, so the file is monotone in correctness.

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
- **Curated data** (`data/platforms.json`, `data/natives.json`, `data/links.json`)
  and the published dump: **CC0-1.0** — see `LICENSE-DATA`. Copy it, sell it,
  fork it, no attribution required. Attribution is welcome and a link back helps
  people find the dispute process.
