// Routing keys. These are load-bearing: every published file path is a slug, so
// a change here silently breaks every URL the registry has ever served. Treat
// this function as frozen — see GOVERNANCE.md "Breaking changes".
export function slug(s) {
  const folded = (s ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return folded || '_';
}

// CAIP-19 IDs contain ":" and "/", and CAIP-2 references may contain "_"
// (starknet:SN_MAIN), so any scheme that maps ":" to "_" cannot be reversed.
//
// Routing is DIRECTORY-STYLE instead: the "/" between chain and asset and the
// ":" inside each half become path separators, so
//   eip155:1/erc20:0xdac17f…  ->  caip/eip155/1/erc20/0xdac17f….json
// which needs no escaping at all for the overwhelming majority of assets and
// stays readable in a URL bar.
//
// The one residue is "%", which our own percent-encoding introduces into an
// asset reference (Sui coin types, Injective factory denoms). A literal "%" in
// a URL path is decoded by the server BEFORE the file lookup, so it can never
// survive as a filename. It maps to "~", which appears in no CAIP grammar.
const PCT = '%';
const PCT_FILE = '~';

export function caipPath(caip19) {
  const slash = caip19.indexOf('/');
  const chain = caip19.slice(0, slash);
  const asset = caip19.slice(slash + 1);
  const cColon = chain.indexOf(':');
  const aColon = asset.indexOf(':');
  const parts = [
    chain.slice(0, cColon),
    chain.slice(cColon + 1),
    asset.slice(0, aColon),
    asset.slice(aColon + 1),
  ];
  return parts.map((p) => p.split(PCT).join(PCT_FILE)).join('/');
}

export function unCaipPath(path) {
  const [ns, ref, assetNs, ...rest] = path.split('/');
  const assetRef = rest.join('/').split(PCT_FILE).join(PCT);
  return `${ns}:${ref}/${assetNs}:${assetRef}`;
}

// Symbols and names are user-supplied and can be empty, emoji-only, or pure
// punctuation. Those all fold to "_", which would pile thousands of unrelated
// assets into one file, so the build routes them to a single explicit bucket
// rather than pretending the key is meaningful.
export const isDegenerateSlug = (s) => s === '_';
