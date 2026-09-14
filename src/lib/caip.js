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
  // CAIP-19 caps asset_namespace at 8 characters, so this cannot be
  // "tokenfactory" — that silently failed the grammar and dropped every
  // factory denom on the floor.
  //
  // The "factory/" prefix is STRIPPED rather than carried: it duplicates what
  // the namespace already says, and it is not free. Measured across 2,000 live
  // Osmosis denoms, 7 encode to 130 characters with the prefix retained and so
  // would exceed CAIP-19's 128-char reference limit; stripping brings every one
  // of them under it. The same reasoning as ics20, where "ibc/" is dropped.
  if (raw.startsWith('factory/')) return { ns: 'factory', ref: raw.slice('factory/'.length) };
  if (/^[a-z]+1[02-9ac-hj-np-z]{38,58}$/.test(raw)) return { ns: 'cw20', ref: raw };
  // x/bank is the SDK module that actually holds these denoms, and "bank" is
  // the namespace used in the CAIP-19 profile this project proposed upstream.
  // Publishing "native" while proposing "bank" would be incoherent.
  return { ns: 'bank', ref: raw }; // uatom, aarch, uinit …
}


// Shape rules for every address family the registry knows about.
//
// `re` is the accepted shape; anything that does not match is REJECTED rather
// than passed through, because a malformed reference looks authoritative and
// will not round-trip. `enc: true` means the native form contains characters
// CAIP-19 forbids in an asset_reference (`_`, `:`, `/`, `$`) and must be
// percent-encoded — the spec allows `%`, which is the escape hatch for exactly
// this. `lower: true` canonicalises hex casing so one asset cannot appear twice.
//
// Most of these came from model research and are paired with platform entries at
// confidence "proposed". A wrong shape rule here is SAFE in the sense that it
// rejects rather than fabricates — it shows up as a count in the build log.
const FORMATS = {
  'evm-lowercase':            { re: /^0x[0-9a-fA-F]{40}$/, lower: true },
  'evm-hex-no-prefix':        { re: /^[0-9a-fA-F]{40}$/, lower: true },
  // XDC writes EVM addresses with an "xdc" prefix instead of "0x". Same 20
  // bytes; normalised to the 0x form so one asset has one identifier.
  'xdc-address':              { re: /^(xdc|0x)[0-9a-fA-F]{40}$/, lower: true, xdc: true },
  'base58':                   { re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
  'base58check':              { re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
  'alephium-contract-address':{ re: /^[1-9A-HJ-NP-Za-km-z]{40,50}$/ },
  'asa-id':                   { re: /^[0-9]{1,20}$/ },
  'bittensor-netuid':         { re: /^[0-9]{1,6}$/ },
  // A Starknet address is a field element and is NOT fixed width — the node
  // itself emits class hashes at 62 and 63 digits, and four spellings of the
  // ETH contract (padded, stripped, uppercase, no 0x) all resolve to the same
  // class hash. Every one of those spellings uses only characters the
  // asset_reference charset permits, so this is a live CAIP-19 hazard rather
  // than a theoretical one. Pad rather than strip: fixed width makes byte
  // equality the same thing as asset equality.
  'starknet-felt':            { re: /^0x[0-9a-fA-F]{1,64}$/, lower: true, padFelt: true },
  'sora-asset-id':            { re: /^0x[0-9a-fA-F]{64}$/, lower: true },
  'fuel-asset-id':            { re: /^0x[0-9a-fA-F]{64}$/, lower: true },
  'move-object-address':      { re: /^0x[0-9a-fA-F]{1,64}$/, lower: true },
  // IOTA Rebased is a Move network and its coin types are Sui-shaped, so it
  // shares the same normalisation and escape rules.
  'iota-move':                { re: /^0x[0-9a-fA-F]{1,64}(::[A-Za-z0-9_]+){0,4}$/, enc: true, padMove: true },
  'ergo-token-id':            { re: /^[0-9a-fA-F]{64}$/, lower: true },
  'chia-asset-id':            { re: /^[0-9a-fA-F]{64}$/, lower: true },
  'slp-token-id':             { re: /^[0-9a-fA-F]{64}$/, lower: true },
  'casper-contract-hash':     { re: /^[0-9a-fA-F]{64}$/, lower: true },
  // Bitcoin carries two unrelated asset systems under CoinGecko's one
  // "ordinals" slug: inscription ids (64 hex, optionally "iN") and Rune ids
  // ("845764:84" = block:tx). They are different asset classes and get
  // different namespaces, dispatched in buildCaip19.
  'btc-inscription-id':       { re: /^([0-9a-fA-F]{64}(i[0-9]{1,3})?|[0-9]{1,9}:[0-9]{1,6})$/, lower: true, enc: true },
  'inscription-id':           { re: /^[0-9a-fA-F]{64}(i[0-9]{1,3})?$/, lower: true },
  'icon-score-address':       { re: /^cx[0-9a-fA-F]{40}$/, lower: true },
  'defichain-token-id':       { re: /^0x[0-9a-fA-F]{40}$/, lower: true },
  'zilliqa-bech32':           { re: /^zil1[02-9ac-hj-np-z]{38}$/ },
  'cosmos-bech32-contract':   { re: /^[a-z]{2,12}1[02-9ac-hj-np-z]{38,58}$/ },
  'cosmwasm-bech32':          { re: /^[a-z]{2,12}1[02-9ac-hj-np-z]{38,58}$/ },
  'massa-address':            { re: /^AS[1-9A-HJ-NP-Za-km-z]{40,60}$/ },
  'antelope-account':         { re: /^[a-z1-5.]{1,12}$/ },
  'native-coin-id':           { re: /^[a-z0-9]{1,32}$/ },
  'krc20-tick':               { re: /^[A-Za-z0-9$]{2,16}$/, enc: true },
  'bep2-symbol':              { re: /^[A-Z0-9]{1,12}-[A-Z0-9]{1,6}$/ },
  // CoinGecko writes Antelope assets as SYMBOL-chain-contract
  // ("WAXUSDT-wax-eth.token" = symbol WAXUSDT on chain wax at contract
  // eth.token). Two things are wrong with using that verbatim: the chain is
  // already carried by the CAIP-2, and the order is the reverse of the one the
  // CAIP-19 profile this project proposed upstream defines.
  //
  // That profile puts the CONTRACT first for a specific reason: an Antelope
  // account name is [.12345a-z] and a symbol code is [A-Z], so with a single
  // "-" separator the two halves have DISJOINT character classes and a
  // reference self-validates offline. Symbol-first with a dotted account would
  // need a parse-from-the-right rule instead.
  //
  // The safety point is not cosmetic: on EOS mainnet the symbol EOS is issued
  // by eosio.token, by iouiouiou123 AND by eosiotokenis at ZERO precision — a
  // consumer matching on symbol alone misreports the last by a factor of 10^4.
  'antelope-symbol-contract': { re: /^[A-Za-z0-9]{1,12}-[a-z0-9]{1,12}-[a-z0-9.]{1,24}$/, antelope: true },
  // Families whose native form contains characters CAIP-19 forbids.
  'ton-friendly-address':     { re: /^[EU]Q[A-Za-z0-9_-]{46}$/, enc: true },
  'radix-resource-address':   { re: /^resource_rdx1[0-9a-z]{40,70}$/, enc: true },
  'tvm-address':              { re: /^(0:[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40})$/, enc: true },
  'aelf-address':             { re: /^ELF_[1-9A-HJ-NP-Za-km-z]{40,60}_[A-Za-z0-9]{2,10}$/, enc: true },
  'kadena-module-name':       { re: /^[A-Za-z0-9_.-]{2,64}$/, enc: true },
  'substrate-asset-id':       { re: /^[A-Za-z0-9_%/-]{1,64}$/, enc: true, predecode: true },
  'sui-struct':               { re: /^0x[0-9a-fA-F]{1,64}(::[A-Za-z0-9_]+){0,4}$/, enc: true, padMove: true },
  'aptos-struct':             { re: /^0x[0-9a-fA-F]{1,64}(::[A-Za-z0-9_]+){0,4}$/, enc: true },
  'initia-asset':             { re: /^[A-Za-z0-9/_:-]{1,80}$/, enc: true },
  'near-account':             { re: /^[a-z0-9._-]{2,64}$/, enc: true },
  'cardano-asset':            { re: /^[0-9a-fA-F]{56,120}$/, lower: true },
  'mvx-esdt':                 { re: /^[A-Za-z0-9-]{3,40}$/ },
  'tezos-kt':                 { re: /^KT1[1-9A-HJ-NP-Za-km-z]{33}$/ },
  'stacks-principal':         { re: /^S[A-Z0-9]{20,60}\.[A-Za-z0-9-]{1,64}$/ },
  'hedera-token-id':          { re: /^([0-9]+\.[0-9]+\.[0-9]+|0x0{24}[0-9a-fA-F]{16})$/ },
  'stellar-asset':            { re: /^([A-Za-z0-9]{1,12}-G[A-Z2-7]{55}|C[A-Z2-7]{55})$/ },
  'xrpl-currency-issuer':     { re: /^([0-9A-Fa-f]{40}|[A-Za-z0-9]{1,20})\.(r[1-9A-HJ-NP-Za-km-z]{24,34})$/ },
};

export function normalizeAddress(identity, addressFormat) {
  const raw = (identity ?? '').trim();
  if (!raw) return null;

  // Cosmos-family denoms carry their namespace in the identifier itself, so the
  // namespace and the reference are decided together in buildCaip19.
  if (addressFormat === 'cosmos-denom' || addressFormat === 'cosmos-addr-or-denom') return raw;

  const spec = FORMATS[addressFormat];
  if (!spec) return null;

  // Hydration stores an already-percent-encoded identity ("asset_registry%2F…").
  // Encoding it again would produce "%2525" and a reference that never
  // round-trips, so decode to the native form first.
  const native = spec.predecode ? safeDecode(raw) : raw;
  if (!spec.re.test(native)) return null;

  let cased = spec.lower ? native.toLowerCase() : native;
  if (spec.xdc) cased = cased.replace(/^xdc/, '0x');
  // Move addresses have a short and a long spelling that both resolve, so one
  // asset would otherwise have two identifiers. Move's own TypeTag serialization
  // uses the full 32-byte form, so pad to 64 hex.
  if (spec.padFelt) {
    cased = cased.replace(/^0x([0-9a-fA-F]{1,64})$/, (_, h) => `0x${h.padStart(64, '0')}`);
  }
  if (spec.padMove) {
    cased = cased.replace(/^0x([0-9a-fA-F]{1,64})/, (_, h) => `0x${h.toLowerCase().padStart(64, '0')}`);
  }
  if (spec.antelope) {
    const [symbol, , ...rest] = cased.split('-');
    cased = `${rest.join('-')}-${symbol.toUpperCase()}`;
  }
  return spec.enc ? percentEncodeRef(cased) : cased;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function buildCaip19(platformEntry, identity) {
  const address = normalizeAddress(identity, platformEntry.addressFormat);
  if (address === null) return null;
  let namespace = platformEntry.assetNamespace;
  let reference = address;
  // Aptos carries TWO fungible standards side by side and they are NOT the same
  // thing. A Move TYPE TAG (0x1::aptos_coin::AptosCoin) is a legacy Coin; a bare
  // object address (0xbae207…) is an AIP-21 Fungible Asset with no type tag at
  // all. Half our Aptos rows are each kind, and labelling both "coin" asserted
  // an equivalence the chain does not guarantee — the inverse pairing genuinely
  // fails for FA-native assets like Circle's USDC, where paired_coin returns
  // empty.
  if (platformEntry.addressFormat === 'aptos-struct') {
    namespace = reference.includes('%3A%3A') ? 'coin' : 'aip21';
  }
  if (platformEntry.addressFormat === 'btc-inscription-id') {
    namespace = /^[0-9]+%3A[0-9]+$/.test(reference) ? 'rune' : 'ord';
  }
  if (platformEntry.addressFormat === 'stellar-asset') {
    namespace = /^C[A-Z2-7]{55}$/.test(address) ? 'sep41' : 'asset';
    reference = percentEncodeRef(address);
  }
  if (platformEntry.addressFormat === 'cosmos-denom' || platformEntry.addressFormat === 'cosmos-addr-or-denom') {
    const picked = cosmosNamespace(address.trim());
    namespace = picked.ns;
    reference = percentEncodeRef(picked.ref);
  }
  // A platform whose assetNamespace is null and whose addressFormat carries no
  // per-identity dispatch would otherwise interpolate the STRING "null" into the
  // identifier and publish `aelf:AELF/null:ELF%5F…`. Reject instead: a missing
  // namespace is missing data, and a reject is visible in the build log where a
  // malformed identifier is not.
  if (!namespace || namespace === 'null') return null;
  const caip19 = `${platformEntry.caip2}/${namespace}:${reference}`;
  // A reference that still fails the grammar after normalisation is dropped.
  // Publishing a malformed CAIP-19 is worse than publishing none: it looks
  // authoritative and will not round-trip.
  return isValidCaip19(caip19) ? { caip19, address, assetNamespace: namespace } : null;
}
