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
