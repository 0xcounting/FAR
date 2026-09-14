# Contributing

Everything published is built from four vendored snapshots plus three curated
tables. **You only ever edit the curated tables.** `dist/` is generated and is
not in git.

```
data/platforms.json   CoinGecko platform -> CAIP-2 chain + asset namespace
data/natives.json     coins that ARE a chain's unit of account (BTC, ETH, …)
data/links.json       DTI <-> CoinGecko links a human has accepted or rejected
data/sources/*.gz     upstream snapshots — replaced by the refresh job, not by hand
```

Setup is `git clone` and nothing else — Node 22+, zero dependencies.

```bash
node src/validate.js     # the CI gate; run it before you push
node src/build.js        # writes dist/ (~79k files, ~10s)
node scripts/propose-platforms.js   # suggests candidates for unmapped platforms
```

## The four useful contributions

### 1. Confirm or reject a proposed DTI link

This is the highest-value change in the repo, because it converts a guess into a
fact. 1,929 links are currently proposed and **zero** are accepted.

Pick one from `/dti/{DTI}.json` or `_unlinked.json`, establish that the DTI
record and the CoinGecko coin are the same asset, then add it:

```json
{
  "dti": "2RJ2NRNJ5",
  "coingeckoId": "tether",
  "rationale": "DTIF's public registry record for 2RJ2NRNJ5 gives AuxiliaryDistributedLedger 3Q57NZGGJ (= ledger 'Core') and AuxiliaryTechnicalReference 0x9ebab27608bd64aff36f027049aecc69102a0d1e, which is CoinGecko's `core` platform entry for coin id 'tether'. NOTE: this record is USDT on Core, NOT on Ethereum \u2014 the long name is bare 'Tether' for every chain, so the name alone cannot tell you which deployment a record is.",
  "decidedIn": "https://github.com/0xcounting/far/issues/12"
}
```

`rationale` must say **what you checked**, not that you are confident. CI rejects
an entry without a rationale and a `decidedIn`.

What counts as establishing it:

- ✅ The contract address from DTIF's own lookup matches the CoinGecko platform entry.
- ✅ An issuer's official documentation states the DTI for a named contract.
- ✅ The DTI record's ISIN resolves to an instrument whose prospectus names the contract.
- ❌ The names match. That is what the automatic rule already did.
- ❌ The symbols match. `USDC` is 62 different assets.

That example is deliberately the one that caught me out. An earlier draft of
this file asserted 2RJ2NRNJ5 was Ethereum USDT at `0xdac17f...`, because
"Tether" plus a plausible address *reads* correct. It is Tether on **Core**.
All 18 DTI records named "Tether" carry the identical long name and ticker and
differ only in the redacted ledger field — which is precisely why name evidence
is not evidence.

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

### 4. Add a missing native

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
