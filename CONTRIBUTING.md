# Contributing

Everything published is built from four vendored snapshots plus two curated
tables. **You only ever edit the curated tables.** `dist/` is generated and is
not in git.

```
data/platforms.json        CoinGecko platform -> CAIP-2 chain + asset namespace
data/natives.json          coins that ARE a chain's unit of account (BTC, ETH, …)
data/sources/*.gz          upstream snapshots — replaced by the refresh job, not by hand
```

Setup is `git clone` and nothing else — Node 22+, zero dependencies.

```bash
node src/validate.js     # the CI gate; run it before you push
node src/build.js        # writes dist/ (~79k files, ~10s)
node scripts/propose-platforms.js   # suggests candidates for unmapped platforms
```

## The three useful contributions

### 1. Map an unmapped platform

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

### 2. Raise a low-confidence platform

84 platforms were matched on chain name alone by `scripts/propose-platforms.js`
and are marked `low`. Confirming one is quick and the evidence is concrete:

- Find a token on that chain in `/caip/…`, look the address up on the chain's own
  explorer, confirm the chain ID the explorer reports.
- Update `confidence` to `medium` and add what you checked to `evidence`.

Name matching has already been wrong here at least once — `core` matched
"MemeCore" (4352) instead of CoreDAO (1116) — so this is not busywork.

### 3. Add a missing native

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
- Editing `data/sources/*` by hand. Those are snapshots; the refresh job replaces
  them wholesale so the recorded sha256 stays meaningful.
- Editing `dist/`. It is generated.
- Adding a dependency. The build is dependency-free on purpose: this thing is
  meant to still build in five years.

## Conduct

Argue about evidence, not about people. Someone disputing your mapping is doing
the job. A maintainer with a commercial interest in an outcome says so and steps
back from deciding it.
