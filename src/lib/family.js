// Asset FAMILY classification: is this the thing other assets are named after,
// a wrapper of something else, or neither?
//
// ── What this is and is not ───────────────────────────────────────────────────
// It is NOT a quality, importance or trust score, and it deliberately cannot be
// read as one. `standalone` is not "suspicious" — it is the normal state of most
// legitimate assets, including every new one. GOVERNANCE.md commits this project
// to not rating assets, and nothing here rates anything: the buckets describe
// NAMING STRUCTURE, which is observable, not merit, which is not.
//
// ── Why it exists ─────────────────────────────────────────────────────────────
// 60 assets share the ticker USDC. Asked "which is the real one", a registry
// should be able to answer, and the answer is derivable: derivatives are named
// after the thing they wrap, so the canonical asset is the stem the imitators
// embed. `celer-bridged-usdc-astar` contains `usd-coin`'s family name; nothing
// contains `celer-bridged-usdc-astar`.
//
// ── Why it is shaped for verification ─────────────────────────────────────────
// Every input is a field this registry already publishes. There is no curated
// list, no external feed and no market data — so a consumer can recompute the
// classification from /far.json.gz and check we did not put a thumb on it. And
// because it introduces no new inputs, it cannot make the build less
// deterministic: the Merkle root still follows from the same sources.
//
// ── What it cannot do ─────────────────────────────────────────────────────────
// It finds the HEAD of a naming family. Most assets have neither citations nor
// a native-unit attestation, so for most of the registry this says
// `standalone` and nothing more.

// A name that declares itself a wrapper of something else. Matched at token
// boundaries so `pegaxy` is not read as a "peg", and `unstaked-thing` is.
const DERIVATIVE = /(^|-)(bridged|wrapped|peg|pegged|portal|wormhole|synthetic|staked|anchored|alloyed|receipt)(-|$)/;

export const isDerivative = (id, name) => DERIVATIVE.test(id) || DERIVATIVE.test((name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));

const normSym = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// For every asset, how many OTHER assets embed its id as a whole token run, and
// how many of those also carry its ticker inside their own.
//
// The second count is what makes the first one usable. An id that happens to be
// an ordinary word (`token`, `finance`, `base`) is embedded by hundreds of ids
// that have nothing to do with it, so raw citation count crowns the wrong heads.
// A citer corroborates only if it plausibly IS this asset elsewhere: it carries
// the identical ticker (every bridged USDC is still USDC), or it declares itself
// a wrapper and keeps the ticker inside its own (WBTC, stETH). "Baby Doge" shares
// a word with "Baby" and a substring with its ticker; it is not a wrapper of it,
// and this rule says so.
//
// Token runs are generated per id once (ids are short, so this is linear in
// practice) rather than comparing every id against every other.
export function citationIndex(assets) {
  const symById = new Map();
  for (const a of assets) symById.set(a.coingeckoId, normSym(a.symbol));
  const index = new Map();
  for (const a of assets) {
    const id = a.coingeckoId;
    const parts = id.split('-');
    const seen = new Set();
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j <= parts.length; j++) {
        const run = parts.slice(i, j).join('-');
        // A run equal to the whole id is the id citing itself.
        if (run !== id && run.length >= 3) seen.add(run);
      }
    }
    const citerSym = symById.get(id);
    const citerWraps = isDerivative(id, a.name);
    for (const run of seen) {
      if (!symById.has(run)) continue;         // only runs that ARE another asset
      const e = index.get(run) ?? { citedBy: 0, corroborated: 0 };
      e.citedBy++;
      const headSym = symById.get(run);
      if (headSym.length >= 3 && (citerSym === headSym || (citerWraps && citerSym.includes(headSym)))) e.corroborated++;
      index.set(run, e);
    }
  }
  return index;
}


export function classify(asset, citations) {
  const id = asset.coingeckoId;
  const { citedBy, corroborated } = citations.get(id) ?? { citedBy: 0, corroborated: 0 };
  const derivative = isDerivative(id, asset.name);
  // A native unit of account (SLIP-0044 registered) is a head regardless of
  // naming: corroboration that does not depend on what anything is called.
  const attested = asset.deployments.some((d) => d.assetNamespace === 'slip44');

  let family;
  if (derivative) family = 'derivative';
  else if (corroborated > 0 || attested) family = 'canonical';
  else family = 'standalone';

  return { family, citedBy, corroborated, attested, derivative };
}

// Order within a collision group: the head first, then ordinary assets, then
// the wrappers — so "which of these 60 USDCs" has an obvious answer at the top.
export const FAMILY_ORDER = { canonical: 0, standalone: 1, derivative: 2 };
