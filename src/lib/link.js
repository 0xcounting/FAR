import { slug } from './slug.js';
import { matchableName } from './dti.js';

// Linking DTI records to CoinGecko coins.
//
// The free DTI snapshot redacts AuxiliaryTechnicalReference — the contract
// address — so there is NO structural key to join on. Every link this module
// produces is therefore a PROPOSAL derived from names, and it is published as
// such. A link only becomes "accepted" by appearing in data/links.json, which
// changes solely through a reviewed pull request.
//
// The rules below are deliberately strict. A wrong accepted link is worse than
// a missing one: it silently tells a tax or reporting system that two
// different assets are the same asset.

export function proposeLinks(dtiTokens, coins, curated) {
  const accepted = new Map(); // dti -> Set(coingeckoId)
  const rejected = new Set(); // `${dti}|${coingeckoId}`
  for (const l of curated.accepted ?? []) {
    if (!accepted.has(l.dti)) accepted.set(l.dti, new Set());
    accepted.get(l.dti).add(l.coingeckoId);
  }
  for (const l of curated.rejected ?? []) rejected.add(`${l.dti}|${l.coingeckoId}`);

  const coinsByName = new Map();
  const coinsBySymbol = new Map();
  for (const c of coins) {
    push(coinsByName, slug(c.name), c);
    push(coinsBySymbol, slug(c.symbol), c);
  }

  const links = [];
  const unlinked = [];
  for (const t of dtiTokens) {
    const nameKey = matchableName(t.longName);
    const symKeys = new Set(t.shortNames.map(slug));

    // A curated decision always wins, and it wins whether or not the automatic
    // rules would have found the same pair.
    const manual = accepted.get(t.dti);
    if (manual?.size) {
      for (const id of manual) links.push({ dti: t.dti, coingeckoId: id, basis: 'curated', status: 'accepted' });
      continue;
    }

    const byName = (coinsByName.get(nameKey) ?? []).filter((c) => !rejected.has(`${t.dti}|${c.id}`));
    if (byName.length === 0) { unlinked.push({ dti: t.dti, reason: 'no-name-match', nameKey }); continue; }

    // Rule 1 — name matches exactly AND a symbol agrees, and that narrows to a
    // single coin. Strongest automatic evidence available without an address.
    const nameAndSymbol = byName.filter((c) => symKeys.has(slug(c.symbol)));
    if (nameAndSymbol.length === 1) {
      links.push({ dti: t.dti, coingeckoId: nameAndSymbol[0].id, basis: 'name+symbol', status: 'proposed' });
      continue;
    }

    // Rule 2 — the name is unique on both sides. Weaker: names are not unique
    // identifiers, and DTI covers security tokens that share a name with an
    // unrelated crypto asset.
    if (byName.length === 1 && nameAndSymbol.length === 0) {
      links.push({ dti: t.dti, coingeckoId: byName[0].id, basis: 'name-only', status: 'proposed' });
      continue;
    }

    // Anything else is ambiguous. Publishing the candidate set is useful —
    // it is exactly the queue a contributor works through — but picking one
    // automatically is not.
    unlinked.push({
      dti: t.dti,
      reason: nameAndSymbol.length > 1 ? 'ambiguous-name+symbol' : 'ambiguous-name',
      nameKey,
      candidates: (nameAndSymbol.length ? nameAndSymbol : byName).slice(0, 8).map((c) => c.id),
    });
  }
  return { links, unlinked };
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}
