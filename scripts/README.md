# Maintenance scripts

None of these run in the build. `src/build.js` reads only the committed files
under `data/`; everything here exists to produce or revise those files, and each
one says at the top whether it overwrites hand edits.

## Every-build tooling

| Script | Does |
|---|---|
| `verify.js` | Checks a fetched file against `manifest.json`, or against a `/proof/` file and the published root with no manifest at all. The consumer-side half of the integrity story. |
| `update-readme-stats.js` | Regenerates the README's headline table from `dist/index.json`. CI fails if the committed README disagrees with the build. |
| `serve.js` | Serves `dist/` locally with the same routing as GitHub Pages. |

## Chain table (`data/platforms.json`, `data/natives.json`)

| Script | Does |
|---|---|
| `gen-platforms.js` | Regenerates `platforms.json` from the production chain table, ethereum-lists and hand-written non-EVM entries. **Overwrites hand edits.** Run it to pick up new CoinGecko platforms, then re-apply anything curated. |
| `propose-platforms.js` | Lists unmapped CoinGecko platforms with the evidence needed to map each, biggest first. Read-only. |
| `gen-natives.js` | Regenerates `natives.json` from SLIP-0044 and the platform table. |
| `resolve-ledger-caip2.js` | Fills CAIP-2 on DTI ledger records by reusing identifiers already verified in `platforms.json`. Never researches; only reuses. |

## DTI link adjudication (`data/links-inferred.json`)

A three-step loop for the records the deterministic rules in `src/lib/link.js`
cannot decide. It is how the `inferred` tier was produced and how it is refreshed.

1. `gen-link-candidates.js` — for each unlinked DTI, a bounded set of CoinGecko
   candidates (name, ticker, canonicality prior). Decides nothing; turns "which
   of 18,090?" into "which of these 12, or none?".
2. Adjudication — a reviewer, human or model, answers each candidate set with a
   verdict, a confidence and a written reason. The prompt and output shape are
   documented at the top of `ingest-agent-results.js`.
3. `ingest-agent-results.js` — validates the verdicts against the schema,
   refuses any that contradict a human rejection in `data/links.json`, and
   writes `links-inferred.json`.

`select-rerun.js` picks which already-adjudicated records deserve a second pass
after the candidate generator improves, so a retrieval failure is retried
without re-asking questions that were answered.

## Evidence gathering (`data/links.json`)

| Script | Does |
|---|---|
| `gather-onchain-evidence.js` | For a queue entry on an EVM chain, reads the contract's own `name()`, `symbol()` and `decimals()` from a public RPC and prints a rationale a reviewer can paste into an `accepted` entry. One request per second; opt-in per entry; writes nothing. |

The queue it reads from is `/_acceptance-queue.json`, emitted by the build:
every proposed link whose CoinGecko asset has exactly one deployment, so the
DTI could not be pointing at a different chain. Those are the links a reviewer
can responsibly accept from public evidence. Links on multi-chain assets are not
in the queue, because no public source says which deployment a DTI names.
