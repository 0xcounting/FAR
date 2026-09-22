# FAR — Free Asset Resolver

**A CoinGecko ID ↔ CAIP-19 resolver, published as static files.** Give it a
CoinGecko id and get every chain the asset is deployed on as a standards-compliant
CAIP-19; give it a CAIP-19 and get the CoinGecko id, so on-chain data can be
priced. 17,000+ assets, 25,000+ deployments, 290 chains, 45 address formats
normalised, no key, no server.

| Identifier | Who issues it | How you get one | How many exist |
|---|---|---|---|
| **[CAIP-19](https://chainagnostic.org/CAIPs/caip-19)** | nobody — it is derived from the asset itself | deploy the token; the ID already exists | unbounded |
| **CoinGecko ID** | CoinGecko | get listed | 18,090 |

A CoinGecko ID is what almost every price API keys on. A CAIP-19 is the only
identifier you can compute yourself from a chain ID and a contract address,
without asking anyone's permission or waiting for a registry to catch up.
Software that touches both ends up maintaining this mapping privately. FAR
maintains it in the open instead.

**Browse and test queries at <https://0xcounting.github.io/FAR>** — the site is a docs
page with a live resolver that queries these same static files.

```
GET /name/tether.json
GET /symbol/usdt.json
GET /cg/tether.json
GET /caip/eip155/1/erc20/0xdac17f958d2ee523a2206206994597c13d831ec7.json
```

Every route is a static file. There is no server, no API key, no rate limit, and
no request that can fail differently from any other. The whole registry is also
one file (`/far.json.gz`) if you would rather hold it locally.

**If you are an agent or a tool**, start at [`/llms.txt`](https://0xcounting.github.io/FAR/llms.txt)
(what this is and how to use it), then [`/openapi.json`](https://0xcounting.github.io/FAR/openapi.json)
(every route and response shape). There is also an RFC 9727 catalog at
`/.well-known/api-catalog`, this README at `/README.md`, and
[`/llms-full.txt`](https://0xcounting.github.io/FAR/llms-full.txt) with the docs inlined.

## What is actually in it

<!-- BUILD-STATS:START -->
| | |
|---|---|
| CoinGecko coins | 18,090 |
| — resolvable to at least one CAIP-19 | 17,212 (95.1%) |
| CAIP-19 identities | 25,293 across 306 chains |
| Native units of account | 41 chain identities |
| CoinGecko platforms mapped to CAIP-2 | 306 |
| — still unmapped | 10 |
| Chains named by CAIP-2 independent of a CoinGecko platform | 223 |
| Published files | 74,337 |
<!-- BUILD-STATS:END -->

## Read this before you trust a chain

A chain is also an identity in its own right, not only a CoinGecko platform:
`data/chains.json` (served as `/_chains.json`) names every mainnet in the Cosmos
chain-registry by CAIP-2 — 223 chains, whether or not CoinGecko files tokens under
them — so an IBC voucher's origin chain can always be named, and a platform under
which CoinGecko lists no tokens (Celestia, Stride, Axelar, Sei, ...) still resolves.
The CAIP-2 reference follows the cosmos profile's `hashed-` rule for chain ids that
fail its direct grammar (`kava_2222-10`, `shentu-2.2`) — and because nobody writes
that form by hand, the raw spelling is published as an alias that resolves on every
route to the same record. Ask in either dialect; see CONTRIBUTING §4.

Every entry in `data/platforms.json` carries
a `confidence`:

- **`high`** — the mapping is exercised daily in a production ingest pipeline, or
  the CAIP-2 is defined by the CASA namespace spec itself.
- **`medium`** — hand-reviewed by a person against a named source, which is
  recorded in `evidence`.
- **`low`** — matched automatically on a chain name, or the asset namespace is
  provisional because **no ratified CAIP-19 exists for that ecosystem yet**.

That last case is common and worth stating plainly: CASA has ratified a CAIP-2
namespace for ~48 ecosystems but a CAIP-19 asset namespace for only a handful.
For Cosmos, Tron, Aptos, Sui, Algorand, Tezos, NEAR and Cardano, **this registry
is choosing a namespace that no standard has blessed**. Those choices are marked
`low`, documented in each entry's `note`, and are exactly the kind of thing the
dispute process exists to change.

## Verifying what you fetched

Every build publishes `/manifest.json`: the sha256 of every file, plus a Merkle
root over `(path, hash)` pairs.

Every file also has a proof at `/proof/<path without .json>.json`: its hash,
the release root, and the ~17 sibling hashes that connect them. That is all you
need to check one response belongs to the release, without the 11 MB manifest.

```bash
curl -sO https://<host>/cg/tether.json
curl -sO https://<host>/proof/cg/tether.json          # ~1.3 KB
node scripts/verify.js --proof-file tether.json cg/tether.json <merkleRoot>
```

Pass the root from somewhere you trust — the build log, a release, a value you
pinned in CI — rather than the one inside the proof file; the latter only shows
the proof is self-consistent. Two people can confirm they are looking at the same
registry by comparing that one 64-character string.

Builds are deterministic: the same vendored snapshots and the same curated tables
produce byte-identical output and therefore the same root.

## Using it

```js
const res = await fetch(`https://<host>/name/${encodeURIComponent(name.toLowerCase())}.json`);
if (res.status === 404) { /* no asset by that name */ }
const { assets } = await res.json();
```

A name is **not** unique — that is the point of the `/name/` route returning a
group. `tether` is one name and several assets; `usdc` is a symbol shared by 62
of them. Each entry in a group carries its own `deployments` (the CAIP-19 on each
chain it exists on) and `related`:

- `related.sameName` / `related.sameSymbol` — the other coins in the collision.

## What this registry needs from the standards it uses

38 of the identifiers published here are **not defined by any CASA
specification** — FAR had to choose them in order to name assets that exist.
They are listed at `/_namespace-gaps.json`, and each one is a concrete proposal
somebody could take to [ChainAgnostic/namespaces](https://github.com/ChainAgnostic/namespaces).

**11 chain namespaces** (210 assets): `cip34` (Cardano), `near`, `radix`,
`kaspa`, `movement`, `massa`, `icon`, `supra`, `aelf`, `fuel`, `kadena`.

**27 asset namespaces** (999 assets) — the larger gap, because CASA has ratified
a CAIP-19 for only **six** ecosystems (eip155, solana, hedera, stellar, xrpl,
stacks). So `jetton` for TON's 213 tokens, `trc20` for Tron's 92, `nep141` for
NEAR's 72 and two dozen more are this registry's opinion, not a standard.

Tron makes the asymmetry concrete: its **CAIP-2 is ratified but its CAIP-19 is
not**, so we can name the chain correctly and cannot name a token on it
correctly. That is the gap CAIP-19 adoption actually faces, expressed as a count
rather than an opinion.

## Contributing

The registry is only as good as its curated tables, and those grow by pull
request. In rough order of usefulness:

1. **Map an unmapped platform** — 106 of them, listed in `_platforms.json` under
   `unmapped`, worth 902 assets.
2. **Raise a `low`-confidence platform to `medium`** by citing a source.
3. **Add a missing native** — `data/natives.json`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how, and [GOVERNANCE.md](GOVERNANCE.md)
for who decides and how disputes are resolved.

## Sources and licences

Code is MIT. **The data is not under one licence and you should read
[LICENSE-DATA](LICENSE-DATA) before redistributing any of it.** In short: the
mapping tables and CAIP-19 identifiers this project constructs are CC0; CoinGecko
ids and contract mappings, ethereum-lists and SLIP-0044 keep their own terms.

[SOURCES.md](SOURCES.md) records what each source permits, how this project
obtained it, and the sha256 of the exact snapshot every build consumed.

FAR is not affiliated with, endorsed by, or speaking for CoinGecko or the Chain
Agnostic Standards Alliance.
