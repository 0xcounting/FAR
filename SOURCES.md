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

## Digital Token Identifier Foundation (DTIF)

- **What:** `DTI_Data_YYYYMMDD.json`, the free monthly snapshot of the ISO 24165
  registry, from <https://dtif.org/download-dti-data/>.
- **Licence:** open. DTIF states: *"The DTI is open and may be freely reproduced,
  distributed, transmitted, or otherwise used by anyone for any purpose,
  commercial or non-commercial at no cost."* Redistribution here is within that.
- **Attribution:** Digital Token Identifier Foundation, an Etrading Software
  initiative. Given as courtesy, not obligation.
### The registry API, and a decision recorded rather than buried

DTIF also serves an **unauthenticated public API** at
`https://registry-api.dtif.org/api/v1` (the backend of their Registry Search UI)
which returns records **unredacted** — `AuxiliaryDistributedLedger`,
`AuxiliaryTechnicalReference` and `AnchorBlockHash` all populated. Those three
fields are the only mechanical join key between a DTI and a CAIP-19. With them
the mapping is derived; without them every link is a guess from names.

**This repository's published data was built by reading that API**, and the
terms position is genuinely mixed, so here it is in full rather than summarised:

- DTIF's public framing: *"The DTI is open and may be freely reproduced,
  distributed, transmitted, or otherwise used by anyone for any purpose,
  commercial or non-commercial at no cost."*
- Their site terms grant redistribution: *"You are granted permission to use,
  download and redistribute the Registry on the ongoing condition that: (a) you
  must not modify the Registry … in any way which could be misleading to any
  person; and (b) you must not charge any person for any redistribution."*
- **And the same terms prohibit automated collection:** *"You … may not use any
  robot, spider, other automated system or software or device to monitor,
  extract or copy any Materials from the Registry (other than the permitted
  download of any machine-readable Materials which may be made available)."*
  That carve-out points at the monthly snapshot — the very file that redacts
  these fields.
- Their paid Search API is **€7,409/yr** (Standard) for equivalent access, and
  its rate limit (60 req/min) is *higher* than what we used.

So: redistribution is expressly permitted, automated collection is expressly
prohibited, and the data is described as open. The decision to read the API was
made **explicitly and with these facts in hand** by the repository owner. It is
not a default, and it is recorded here so that anyone forking this repository
makes their own decision from the same position rather than inheriting ours.

`scripts/fetch-dtif-registry.js` runs at under one request per second across two
shards, with an honest User-Agent carrying a contact address, exponential
backoff on 429, and full resumability so an interruption never becomes a
re-crawl. An earlier configuration was withdrawn mid-run for repeatedly
triggering 429s.

**If you would rather not rely on this:** every record derived from the API
carries `basis: "dtif-registry-exact"`, so filtering it out is one predicate.
What remains is the name-matched tier, which is what the project had before.

- **What is missing from the free snapshot and why it matters:** it redacts most fields to
  the literal string `<locked>` — including `AuxiliaryTechnicalReference` (the
  contract address), `AuxiliaryDistributedLedger`, `UnitMultiplier` and every
  `Metadata` flag. **This is the single biggest constraint on this project.** With
  the address, DTI↔CAIP-19 would be a mechanical join with no ambiguity. Without
  it, every link is inferred from a name. Redaction is a tiering decision by
  DTIF, not a licence restriction: what we do have, we may republish.
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

## 0xcounting.com production ingest

- **What:** a slimmed platform↔chain table (`chainId`, `name`, `nativeSymbol`,
  and the two CoinGecko slugs) contributed from the production ingest pipeline
  at [0xcounting.com](https://0xcounting.com). Used as `high`-confidence
  evidence because those mappings are exercised against live chain data daily
  rather than matched on a name. Vendored as
  `data/sources/core-chains.json.gz`, so this repository builds standalone.
- **Caveat recorded in code:** the upstream table assigns *synthetic* chain IDs
  ≥ 2×10⁹ to non-EVM chains for its own internal keying. Those are not EIP-155
  IDs, and `scripts/gen-platforms.js` explicitly skips them. An earlier revision
  did not, and produced `eip155:2100000002` for Osmosis — which is why the
  address validator rejects rather than passes through a shape it does not
  recognise.

## This repository

- **Code** (`src/`, `scripts/`): MIT — see `LICENSE`.
- **Curated data** (`data/platforms.json`, `data/natives.json`, `data/links.json`)
  and the published dump: **CC0-1.0** — see `LICENSE-DATA`. Copy it, sell it,
  fork it, no attribution required. Attribution is welcome and a link back helps
  people find the dispute process.
