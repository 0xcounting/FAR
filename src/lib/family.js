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
// It finds the HEAD of a naming family. Measured on the current data, 86% of
// assets have neither citations nor a second-registry attestation, so for most
// of the registry this says `standalone` and nothing more. That is a real limit
// and it is reported rather than papered over with a fabricated score.

// A name that declares itself a wrapper of something else. Matched at token
// boundaries so `pegaxy` is not read as a "peg", and `unstaked-thing` is.
const DERIVATIVE = /(^|-)(bridged|wrapped|peg|pegged|portal|wormhole|synthetic|staked|anchored|alloyed|receipt)(-|$)/;

// Count, for every id, how many OTHER ids embed it as a whole token run.
// Done by generating each id's own token runs once (ids are short, so this is
// linear in practice) rather than comparing every id against every other, which
// would be 327 million substring tests on the current data.
export function citationIndex(ids) {
  const counts = new Map();
  for (const id of ids) {
    const parts = id.split('-');
    const seen = new Set();
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j <= parts.length; j++) {
        const run = parts.slice(i, j).join('-');
        // A run equal to the whole id is the id citing itself.
        if (run !== id && run.length >= 3) seen.add(run);
      }
    }
    for (const run of seen) counts.set(run, (counts.get(run) ?? 0) + 1);
  }
  return counts;
}

export const isDerivative = (id, name) => DERIVATIVE.test(id) || DERIVATIVE.test((name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));

export function classify(asset, citations) {
  const id = asset.coingeckoId;
  const citedBy = citations.get(id) ?? 0;
  const derivative = isDerivative(id, asset.name);
  // A second registry independently registering the asset is corroboration
  // that does not depend on naming at all, so it can establish a head even
  // where nothing happens to cite it.
  const attested = asset.dti.some((d) => d.status === 'exact' || d.status === 'accepted')
    || asset.deployments.some((d) => d.assetNamespace === 'slip44');

  let family;
  if (derivative) family = 'derivative';
  else if (citedBy > 0 || attested) family = 'canonical';
  else family = 'standalone';

  return { family, citedBy, attested, derivative };
}

// Order within a collision group: the head first, then ordinary assets, then
// the wrappers — so "which of these 60 USDCs" has an obvious answer at the top.
export const FAMILY_ORDER = { canonical: 0, standalone: 1, derivative: 2 };
