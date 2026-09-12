// CAIP-19 construction. Everything here is driven by data/platforms.json — this
// module never guesses a chain ID, and a platform that is not in that file
// produces no CAIP-19 at all rather than a plausible-looking wrong one.

// CAIP-2:  namespace:reference   namespace 3-8 lowercase, reference 1-32
// CAIP-19: <caip2>/<asset_namespace>:<asset_reference>
const CAIP2_RE = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const ASSET_NS_RE = /^[-a-z0-9]{3,8}$/;
const ASSET_REF_RE = /^[-.%a-zA-Z0-9]{1,128}$/;

export function isValidCaip2(s) {
  return CAIP2_RE.test(s);
}

export function isValidCaip19(s) {
  const slash = s.indexOf('/');
  if (slash < 0) return false;
  const chain = s.slice(0, slash);
  const asset = s.slice(slash + 1);
  const colon = asset.indexOf(':');
  if (colon < 0) return false;
  return (
    CAIP2_RE.test(chain) &&
    ASSET_NS_RE.test(asset.slice(0, colon)) &&
    ASSET_REF_RE.test(asset.slice(colon + 1))
  );
}

// Address normalisation is per-family and deliberately narrow. Getting this
// wrong is how two spellings of one asset become two registry entries, so an
// address whose shape does not match its declared family is REJECTED rather
// than passed through — a malformed reference is worse than a missing one.
// CAIP-19's asset_reference grammar is [-.%a-zA-Z0-9]{1,128}: no "_", no "/",
// no ":". Real identifiers on several chains contain all three — Sui coin types
// are 0x…::module::NAME, Injective factory denoms are factory/inj1…/sub. The
// spec's inclusion of "%" is the escape hatch, so anything outside the allowed
// set is percent-encoded. This is reversible, so a consumer can recover the
// native identifier exactly.
export function percentEncodeRef(s) {
  return [...Buffer.from(s, 'utf8')]
    .map((b) => {
      const ch = String.fromCharCode(b);
      return /[-.a-zA-Z0-9]/.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

export const percentDecodeRef = (s) => decodeURIComponent(s);

// Cosmos has no ratified CAIP-19. The identifier shape itself says which kind
// of asset it is, so the namespace is chosen per-identity rather than per-chain
// — one Cosmos chain routinely carries all four kinds at once.
function cosmosNamespace(raw) {
  if (raw.startsWith('ibc/')) return { ns: 'ics20', ref: raw.slice(4) };
  if (raw.startsWith('factory/')) return { ns: 'tokenfactory', ref: raw };
  if (/^[a-z]+1[02-9ac-hj-np-z]{38,58}$/.test(raw)) return { ns: 'cw20', ref: raw };
  return { ns: 'native', ref: raw }; // uatom, aarch, uinit …
}

export function normalizeAddress(identity, addressFormat) {
  const raw = (identity ?? '').trim();
  if (!raw) return null;
  switch (addressFormat) {
    case 'evm-lowercase':
      // EIP-55 checksum casing carries no extra information and doubles every
      // key, so the registry canonicalises to lowercase.
      return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : null;
    case 'base58':
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw) ? raw : null;
    case 'base58check':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw) ? raw : null;
    case 'hedera-token-id':
      // CoinGecko stores the EVM alias (0x…); the CAIP-19 reference is the
      // shard.realm.num token ID. We can decode the low 64 bits, but shard and
      // realm are not recoverable from the alias, so we only emit when the
      // alias is in the default 0.0.* space, which is what every HTS token
      // issued to date uses.
      if (!/^0x0{24}[0-9a-fA-F]{16}$/.test(raw)) return null;
      return `0.0.${BigInt(raw).toString(10)}`;
    case 'xrpl-currency-issuer': {
      const m = raw.match(/^([0-9A-Fa-f]{40}|[A-Za-z0-9]{3})\.(r[1-9A-HJ-NP-Za-km-z]{24,34})$/);
      return m ? `${m[1]}.${m[2]}` : null;
    }
    case 'stellar-asset':
      return /^[A-Za-z0-9]{1,12}-G[A-Z2-7]{55}$/.test(raw) ? raw : null;
    case 'asa-id':
      return /^[0-9]{1,20}$/.test(raw) ? raw : null;
    // Families whose reference grammar is still provisional pass through with a
    // conservative character check only. They are all confidence "low" in
    // data/platforms.json, which is what a consumer should be keying off.
    case 'aptos-struct':
    case 'sui-struct':
      // 0x<hex>::module::NAME — the "::" must be encoded to be a legal reference.
      return /^0x[0-9a-fA-F]{1,64}(::[A-Za-z0-9_]+){0,4}$/.test(raw) ? percentEncodeRef(raw) : null;
    case 'starknet-felt':
      return /^0x[0-9a-fA-F]{1,64}$/.test(raw) ? raw.toLowerCase() : null;
    case 'near-account':
      return /^[a-z0-9._-]{2,64}$/.test(raw) ? percentEncodeRef(raw) : null;
    case 'cardano-asset':
      return /^[0-9a-fA-F]{56,120}$/.test(raw) ? raw.toLowerCase() : null;
    case 'mvx-esdt':
    case 'tezos-kt':
    case 'stacks-principal':
      return ASSET_REF_RE.test(raw) ? raw : percentEncodeRef(raw);
    case 'cosmos-denom':
      return raw; // namespace + reference are decided together in buildCaip19
    default:
      return null;
  }
}

export function buildCaip19(platformEntry, identity) {
  const address = normalizeAddress(identity, platformEntry.addressFormat);
  if (address === null) return null;
  let namespace = platformEntry.assetNamespace;
  let reference = address;
  if (platformEntry.addressFormat === 'cosmos-denom') {
    const picked = cosmosNamespace(address.trim());
    namespace = picked.ns;
    reference = percentEncodeRef(picked.ref);
  }
  const caip19 = `${platformEntry.caip2}/${namespace}:${reference}`;
  // A reference that still fails the grammar after normalisation is dropped.
  // Publishing a malformed CAIP-19 is worse than publishing none: it looks
  // authoritative and will not round-trip.
  return isValidCaip19(caip19) ? { caip19, address, assetNamespace: namespace } : null;
}
