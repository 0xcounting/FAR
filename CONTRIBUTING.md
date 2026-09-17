# Contributing

Everything published is built from four vendored snapshots plus three curated
tables. **You only ever edit the curated tables.** `dist/` is generated and is
not in git.

```
data/platforms.json        CoinGecko platform -> CAIP-2 chain + asset namespace
data/natives.json          coins that ARE a chain's unit of account (BTC, ETH, …)
data/links.json            DTI <-> CoinGecko links a human has accepted or rejected
data/ledgers.json          DTI ledger records (DLIs) -> CAIP-2
data/links-inferred.json   model-asserted links — GENERATED, do not hand-edit
data/sources/*.gz          upstream snapshots — replaced by the refresh job, not by hand
```

`data/links-inferred.json` is written by `scripts/ingest-agent-results.js` from a
model run. Editing it by hand is pointless: the next run overwrites it. To keep
a link, **promote** it (below).

Setup is `git clone` and nothing else — Node 22+, zero dependencies.

```bash
node src/validate.js     # the CI gate; run it before you push
node src/build.js        # writes dist/ (~79k files, ~10s)
node scripts/propose-platforms.js   # suggests candidates for unmapped platforms
```

## The four useful contributions

### 0. Promote a model-inferred link

The fastest useful contribution. A model has already done the reading and left
its reasoning on the record; you are supplying the evidence it could not get.

Open `/dti/{DTI}.json`, find a link with `"status": "inferred"`, and read its
`reasoning`. Then check the one thing the model could not: **which deployment
the DTI actually names**. The free snapshot will not tell you, so the evidence
has to come from somewhere public: issuer documentation, the project's own
announcement of a contract address, a block explorer's verified-contract page,
or the token contract's own `name()`/`symbol()`/`decimals()`. If that lines up
with the CoinGecko platform entry for the coin the model picked, move the link
into `data/links.json` with that evidence as the rationale, and cite the model's
reasoning as the prior:

```json
{
  "dti": "5XMDC8VG3",
  "coingeckoId": "pixelverse-xyz",
  "rationale": "Confirmed the inferred link. PixelVerse's docs give the PIXFI contract as 0x… on Ethereum; Etherscan shows that contract verified with symbol PIXFI and 18 decimals, and it is the address in CoinGecko's `ethereum` platform entry for pixelverse-xyz.",
  "decidedIn": "https://github.com/0xcounting/FAR/issues/…"
}
```

**Disproving one is worth just as much.** Add it to `rejected` instead — CI
refuses to publish an inferred link that contradicts a human rejection, so a
single `rejected` entry kills that proposal permanently, including on re-runs.

### 1. Confirm or reject a proposed DTI link

This is the highest-value change in the repo, because it converts a guess into a
fact. 1,929 links are currently proposed and **zero** are accepted.

Pick one from `/dti/{DTI}.json` or `_unlinked.json`, establish that the DTI
record and the CoinGecko coin are the same asset, then add it:

```json
{
  "dti": "5XMDC8VG3",
  "coingeckoId": "pixelverse-xyz",
  "rationale": "PixelVerse's documentation gives PIXFI as a single Ethereum deployment at 0x…, Etherscan shows that contract verified with symbol PIXFI and 18 decimals, and it is the address in CoinGecko's `ethereum` platform entry for pixelverse-xyz. The asset has one deployment, so the DTI record's name identifies it without ambiguity.",
  "decidedIn": "https://github.com/0xcounting/FAR/issues/…"
}
```

`rationale` must say **what you checked**, not that you are confident. CI rejects
an entry without a rationale and a `decidedIn`.

What counts as establishing it:

- ✅ An issuer's official documentation states the DTI for a named contract.
- ✅ The DTI record's ISIN resolves to an instrument whose prospectus names the contract.
- ✅ The asset has exactly one known deployment, so a unique name match cannot be
  pointing anywhere else.
- ❌ The names match. That is what the automatic rule already did.
- ❌ The symbols match. `USDC` is 62 different assets.

**Multi-deployment assets mostly cannot be confirmed from public data, and that is
the honest state of this registry.** DTI issues a record per chain deployment, so
all 18 records named "Tether" carry an identical long name and ticker and differ
only in the redacted ledger field. Nothing public distinguishes them, so a
contributor cannot responsibly accept any of them without evidence from the
issuer or from DTIF. Those links stay `proposed` until that evidence exists.

**Rejecting is a contribution.** A `rejected` entry suppresses a wrong automatic
proposal permanently, which is worth as much as an accepted one.

### 2. Map an unmapped platform

106 CoinGecko platforms have no CAIP-2, covering 902 assets. They are listed in
`data/platforms.json` under `unmapped`, biggest first.

```json
"the-open-network": {
  "caip2": "ton:-239",
  "assetNamespace": "jetton",
  "nativeAsset": "slip44:607",
  "addressFormat": "ton-address",
  "confidence": "low",
  "evidence": ["TON whitepaper: mainnet workchain -239", "no CASA namespace for TON"],
  "note": "TON has no ratified CAIP-2. Both the chain ID and 'jetton' are provisional."
}
```

Then remove the entry from `unmapped`. If the address shape needs handling that
`src/lib/caip.js` does not have, add a case to `normalizeAddress` — and make it
**reject** anything that does not match the expected shape. A malformed CAIP-19
is worse than a missing one: it looks authoritative and will not round-trip.

Run `node src/build.js` and check the `rejected addresses` line. If your platform
appears there, the shape check is wrong.

### 3. Raise a low-confidence platform

84 platforms were matched on chain name alone by `scripts/propose-platforms.js`
and are marked `low`. Confirming one is quick and the evidence is concrete:

- Find a token on that chain in `/caip/…`, look the address up on the chain's own
  explorer, confirm the chain ID the explorer reports.
- Update `confidence` to `medium` and add what you checked to `evidence`.

Name matching has already been wrong here at least once — `core` matched
"MemeCore" (4352) instead of CoreDAO (1116) — so this is not busywork.

### 4. Raise a `proposed` ledger or platform

`data/ledgers.json` maps DTIF's 275 ledger records to CAIP-2; 62 have none.
Some of those are correct and permanent — SWIAT, Clearstream D7, JP Morgan
Kinexys and other bank or CSD ledgers are `kind: "permissioned"` and will never
have a public chain identifier. CI enforces that a permissioned ledger has no
CAIP-2, so do not "fix" those.

The ones worth work are `kind: "public"` with `caip2: null`: chains whose
genesis hash nobody could reach. Several are recorded with an explicit
`uncertainty` naming exactly what could not be verified — Chiliz Legacy needs
`eth_chainId` off a surviving archive node; Bitcoin Diamond, Bitcoin Gold and
eCash all inherit Bitcoin's or BCH's genesis hash, so a `bip122` reference
does not distinguish them and inventing a fork-block reference would be a guess.

### 5. Add a missing native

`data/natives.json` covers 28 coins. Cardano, TON, Polkadot and others are
missing. A native needs a CAIP-2 you can cite and a SLIP-0044 coin type
(`data/sources/slip44.json.gz`).

## Rules that CI enforces

- Every platform entry has non-empty `evidence`.
- `high` confidence requires production or CASA-spec evidence.
- Every curated link has a `rationale` and a `decidedIn`.
- The same pair is never both accepted and rejected.
- Every CAIP-2 and CAIP-19 matches the grammar.
- Every native is `<caip2>/slip44:<n>` and its CAIP-2 agrees with its own field.
- Route slugs round-trip.

## What gets a PR rejected

- A mapping with no evidence, or evidence that is "I know this".
- Bulk-adding links from a script. The automatic rules already ran; a PR of 400
  accepted links means 400 unreviewed claims.
- Editing `data/sources/*` by hand. Those are snapshots; the refresh job replaces
  them wholesale so the recorded sha256 stays meaningful.
- Editing `dist/`. It is generated.
- Adding a dependency. The build is dependency-free on purpose: this thing is
  meant to still build in five years.

## Conduct

Argue about evidence, not about people. Someone disputing your mapping is doing
the job. A maintainer with a commercial interest in an outcome says so and steps
back from deciding it.
