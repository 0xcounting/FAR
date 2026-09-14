# FAR — Free Asset Resolver

A cross-reference between the three ways the world names a crypto asset:

| Identifier | Who issues it | How you get one | How many exist |
|---|---|---|---|
| **[CAIP-19](https://chainagnostic.org/CAIPs/caip-19)** | nobody — it is derived from the asset itself | deploy the token; the ID already exists | unbounded |
| **CoinGecko ID** | CoinGecko | get listed | 18,090 |
| **[DTI](https://dtif.org)** (ISO 24165) | DTI Foundation | apply; a governance process decides | 5,785 |

Each answers a different question. A DTI is what a European regulator expects on a
MiCA or DAC8 report. A CoinGecko ID is what almost every price API keys on. A
CAIP-19 is the only one you can compute yourself from a chain ID and a contract
address, without asking anyone's permission or waiting for a registry to catch up.

Software that touches all three ends up maintaining this mapping privately. FAR
maintains it in the open instead.

```
GET /name/tether.json
GET /symbol/usdt.json
GET /cg/tether.json
GET /caip/eip155/1/erc20/0xdac17f958d2ee523a2206206994597c13d831ec7.json
GET /dti/2RJ2NRNJ5.json
GET /ledger/PJP8FVDQ0.json
```

Every route is a static file. There is no server, no API key, no rate limit, and
no request that can fail differently from any other. The whole registry is also
one file (`/far.json.gz`) if you would rather hold it locally.

## What is actually in it

<!-- BUILD-STATS:START -->
| | |
|---|---|
| CoinGecko coins | 18,090 |
| — resolvable to at least one CAIP-19 | 17,214 (95.2%) |
| CAIP-19 identities | 25,297 across 290 chains |
| Native units of account | 42 chain identities |
| DTI token records | 5,775 |
| — linked to a CoinGecko coin | 3,942 (68.3%) |
|   address-derived (exact) | 2,528 |
|   rule-proposed / model-inferred / human-accepted | 717 / 697 / 0 |
|   wrong name-links removed by the address | 171 |
| — chain identified | 1,288 (22.3%) |
| DTI ledger records | 275, 242 with a CAIP-2 |
| CoinGecko platforms mapped to CAIP-2 | 290 |
| — still unmapped | 10 |
| Published files | 80,398 |
<!-- BUILD-STATS:END -->

## Read this before you trust a link

**The DTI↔CoinGecko mapping is inferred from names, and it is published as
proposals rather than as facts.**

The free DTI snapshot redacts every structural field —
`AuxiliaryTechnicalReference` (the contract address), `AuxiliaryDistributedLedger`,
and the anchor block hashes all come through as the literal string `<locked>`.
What is left is a name, a symbol, and an identifier. So there is **no key to join
on**: a link can only be proposed by matching text, and text is not an identifier.

Every link therefore carries a `status` and a `basis`:

| `status` | Meaning |
|---|---|
| `accepted` | A human reviewed it and merged it into `data/links.json`. Safe to rely on. |
| `proposed` | A rule in `src/lib/link.js` matched. **Plausible, not verified.** |

**Why one coin attracts many DTIs.** DTI issues a record *per chain deployment*;
CoinGecko issues one *per asset*. So `tether` draws 18 proposed DTIs — one for
each ledger DTIF has registered USDT on. The field that would say *which* ledger
each record refers to is `AuxiliaryDistributedLedger`, and it is redacted. That
asymmetry is the whole difficulty of this join in one sentence.

| `basis` | Rule |
|---|---|
| `curated` | Came from `data/links.json`. |
| `name+symbol` | Exact normalised name match *and* an agreeing symbol, unique. |
| `name-only` | Exact normalised name, unique on both sides, no symbol agreement. |

If a wrong link would cost you something — a tax filing, a regulatory report, a
reconciliation — **filter to `status: "accepted"`**. Everything else is a
candidate queue, and working through it is the most useful thing a contributor
can do here.

The same honesty applies to chains. Every entry in `data/platforms.json` carries
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

```bash
curl -sO https://<host>/manifest.json
curl -s  https://<host>/cg/tether.json | shasum -a 256
# compare against the entry for cg/tether.json in the manifest
node scripts/verify.js manifest.json cg/tether.json <hash>
```

The Merkle root means you can verify that a single file belongs to a specific
published release without downloading the other 79,228 — an inclusion proof is
~17 hashes. The root is also printed in the build log and committed to the
release, so two people can confirm they are looking at the same registry by
comparing one 64-character string.

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
- `related.dtiEquivalent` — coins the DTI registry declares functionally fungible
  with this one. **In practice this is almost always empty, and the reason is
  worth knowing.** `EquivalentDigitalTokenGroupDTI` does not cluster an asset's
  deployments: measured across all 5,785 records, every group has exactly one
  member. Each type-3 record points at a single type-0 record, pairwise. So the
  field cannot be used to enumerate "all the chains USDT is on" — which is what
  it looks like it should do. It is kept because the pairing is real
  information, not because it delivers the cross-chain grouping.

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

### Permissioned ledgers

DTIF registers bank and CSD platforms — SDX R3 Corda, HSBC Orion, SWIAT,
Euroclear D-FMI, Clearstream D7 — and this registry carries them with
`caip2: null`. That records **an absence, not an impossibility**: nothing in
CAIP-2 requires a chain to be public, CASA has ratified namespaces of exactly
that shape (`swift`, `tenzro`, `haneul`, `partisia`), and a Corda network
identity or Canton synchronizer id would serve perfectly well as a reference.
Nobody has published one. If that changes, a CAIP-2 on a permissioned ledger is
a welcome contribution — CI asks only that the namespace be shown to exist, the
same as for any other claim.

## Contributing

The registry is only as good as its curated tables, and those grow by pull
request. In rough order of usefulness:

1. **Confirm or reject a proposed DTI link** — turns a guess into a fact.
2. **Map an unmapped platform** — 106 of them, listed in `_platforms.json` under
   `unmapped`, worth 902 assets.
3. **Raise a `low`-confidence platform to `medium`** by citing a source.
4. **Add a missing native** — `data/natives.json`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how, and [GOVERNANCE.md](GOVERNANCE.md)
for who decides and how disputes are resolved.

## Sources and licences

Code is MIT. The curated tables in `data/` are CC0. Upstream data keeps its own
terms — see [SOURCES.md](SOURCES.md), which records what each source permits and
the sha256 of the exact snapshot every build consumed.

FAR is not affiliated with, endorsed by, or speaking for the DTI Foundation,
CoinGecko, or the Chain Agnostic Standards Alliance.
