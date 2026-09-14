#!/usr/bin/env node
// Turns the crawled DTIF records into EXACT DTI <-> CAIP-19 identities.
//
// This is the join the whole project wanted. A full record gives:
//   AuxiliaryDistributedLedger   -> a DLI, which resolves to a CAIP-2 chain
//   AuxiliaryTechnicalReference  -> the contract address on that chain
//   AuxiliaryMechanism           -> the token standard ("ERC-20"), i.e. the
//                                   CAIP-19 asset namespace
// Together those are a CAIP-19, derived rather than guessed. Matching it against
// the CoinGecko deployment index then yields a DTI<->CoinGecko link that rests
// on a contract address, not on two strings looking alike.
//
// Native coins (DTIType 1) carry ProtocolDistributedLedger and no technical
// reference; they resolve to <caip2>/slip44:<coinType> where we know the type.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildCaip19, isValidCaip19, isValidCaip2, percentEncodeRef } from '../src/lib/caip.js';

const DIR = process.env.FAR_DTIF_OUT ?? '/tmp/dtif';
const readNd = (f) => existsSync(f)
  ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

// The crawler shards its output (tokens.0.ndjson, tokens.1.ndjson, …), so read
// every file for the kind and dedupe by identifier — a resumed or re-sharded
// crawl can legitimately write the same record twice.
const readAll = (prefix) => {
  const seen = new Map();
  for (const f of readdirSync(DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.ndjson'))) {
    for (const r of readNd(`${DIR}/${f}`)) if (r.__id && !seen.has(r.__id)) seen.set(r.__id, r);
  }
  return [...seen.values()];
};
const ledgerRecs = readAll('ledgers');
const tokenRecs = readAll('tokens');
const platformTable = JSON.parse(readFileSync('data/platforms.json', 'utf8'));
const existingLedgers = JSON.parse(readFileSync('data/ledgers.json', 'utf8')).ledgers;
const evmChains = JSON.parse(gunzipSync(readFileSync('data/sources/evm-chains.json.gz')));

// ─────────────────────────────────────────────────────────── ledgers -> CAIP-2
// The anchor block hash is the genesis hash, which IS the CAIP-2 reference for
// Bitcoin-family chains. For everything else it is corroboration, not the
// identifier, so the existing table (deterministic matches plus reviewed model
// proposals) stays authoritative and the hash is recorded as evidence.
const bip122FromHash = (hash) => (/^[0-9a-f]{64}$/i.test(hash ?? '') ? `bip122:${hash.toLowerCase().slice(0, 32)}` : null);

const ledgers = { ...existingLedgers };
let anchored = 0, newlyIdentified = 0;
for (const r of ledgerRecs) {
  const dli = r.__id;
  if (r.__error) continue;
  const nrm = r.Normative ?? {};
  const inf = r.Informative ?? {};
  const prev = ledgers[dli] ?? {};
  const hash = nrm.AnchorBlockHash;
  const entry = {
    ...prev,
    longName: inf.LongName ?? prev.longName ?? null,
    anchorBlockHash: hash ?? null,
    anchorBlockHashAlgorithm: nrm.AnchorBlockHashAlgorithm ?? null,
    anchorBlockHeight: nrm.AnchorBlockHeight ?? null,
    publicLedger: inf.PublicDistributedLedgerIndication ?? null,
    url: inf.URL ?? null,
  };
  // Ledgers fetched directly from the API have no `kind` yet. DTIF states it
  // itself via PublicDistributedLedgerIndication; where that is absent, an
  // anchor hash implies a public chain (a permissioned ledger has no published
  // genesis), and otherwise we say "unknown" rather than assume.
  if (!entry.kind) {
    entry.kind = inf.PublicDistributedLedgerIndication === true ? 'public'
      : inf.PublicDistributedLedgerIndication === false ? 'permissioned'
      : hash ? 'public' : 'unknown';
  }
  entry.confidence ??= 'proposed';
  entry.evidence = entry.evidence?.length ? entry.evidence : ['DTIF registry ledger record'];
  // A double-SHA-256 anchor is a Bitcoin-family genesis hash, and CAIP-2 for
  // that family is literally its first 32 hex characters — so this is derived,
  // not inferred, and outranks anything a model proposed.
  const looksBitcoin = /double sha-?256/i.test(nrm.AnchorBlockHashAlgorithm ?? '');
  const derived = looksBitcoin ? bip122FromHash(hash) : null;
  if (derived && isValidCaip2(derived)) {
    if (entry.caip2 !== derived) newlyIdentified++;
    entry.caip2 = derived;
    entry.kind = 'public';
    entry.confidence = 'high';
    entry.evidence = [`DTIF registry AnchorBlockHash ${hash} (${nrm.AnchorBlockHashAlgorithm}); CAIP-2 bip122 reference is its first 32 hex characters`];
    entry.assertedBy = null;
    entry.uncertainty = null;
  } else if (hash) {
    entry.evidence = [...(prev.evidence ?? []), `DTIF registry AnchorBlockHash ${hash}`];
  }
  if (hash) anchored++;
  ledgers[dli] = entry;
}

// ────────────────────────────────────────────────────── tokens -> CAIP-19
// AuxiliaryMechanism is DTIF's name for the token standard. Map to a CAIP-19
// asset namespace only where the mapping is unambiguous; an unrecognised
// mechanism yields no namespace rather than a plausible-looking wrong one.
const MECHANISM_NS = {
  'erc-20': 'erc20', 'erc20': 'erc20', 'erc-721': 'erc721', 'erc-1155': 'erc1155',
  'bep-20': 'erc20', 'bep20': 'erc20', 'trc-20': 'trc20', 'trc20': 'trc20',
  'spl': 'token', 'spl-token': 'token', 'cw20': 'cw20', 'nep-141': 'nep141',
  'hts': 'token', 'asa': 'asa', 'fa1.2': 'fa12', 'fa2': 'fa2', 'sip-010': 'sip010',
  'erc-404': 'erc404', 'esdt': 'esdt', 'jetton': 'jetton', 'krc-20': 'krc20',
  'zrc-2': 'zrc2', 'oep-4': 'oep4', 'src-20': 'src20', 'psp22': 'psp22',
  'crc20': 'crc20', 'crc-20': 'crc20', 'tip-3': 'tip3', 'tip3': 'tip3',
  'ibc coin': 'ics20', 'ibc': 'ics20', 'native attribute': 'native',
  'ft': 'ftoken',            // Flow fungible token — "ft" is under CAIP-19's 3-char minimum
  'sui coin': 'coin', 'brc-20': 'brc20', 'move coin': 'coin',
  'fungible asset': 'faobj', // Aptos Fungible Asset — "fa" likewise too short
  'sep-1': 'asset', 'sep-41': 'sep41', 'grc-20': 'grc20', 'fa-2': 'fa2',
  'arc-3': 'asa', 'arc-200': 'arc200', 'oep-8': 'oep8', 'nep-17': 'nep17',
  'trc-10': 'trc10', 'xrc-20': 'xrc20', 'prc-20': 'prc20', 'rune': 'rune',
  // Chain-specific spellings of the same ERC-20 shape. DTIF writes the
  // ecosystem's own name for it; the CAIP-19 namespace follows the ecosystem.
  'hrc-20': 'hrc20', 'hrc20': 'hrc20', 'xrc20': 'xrc20', 'kip-20': 'kip20',
  'kip-7': 'kip7', 'sep20': 'sep20', 'vrc21': 'vrc21', 'vrc20': 'vrc20',
  'wrc-20': 'wrc20', 'frc-20': 'frc20', 'nep-5': 'nep5', 'cis-2': 'cis2',
  'sip-10': 'sip010', 'brc 2.0': 'brc20', 'dog-20': 'dog20',
  'bep-2': 'bep2', 'bep2': 'bep2', 'eosio.token': 'token', 'omni': 'omni',
  'slp token': 'slp', 'fungible cashtoken': 'cashtkn', 'sora token': 'sora',
  'sui coin': 'coin', 'plt': 'plt',
  'ats': 'ats', 'wsc': 'wsc', 'liquidasset': 'liqasset',
  'cardano smart contract': 'native', 'native coin': 'native',
  'statemintasset': 'asset', 'statemineasset': 'asset', 'polkadot asset': 'asset',
  'worldline': 'wln', 'escrow': 'escrow', 'bip-32': 'slip44',
};

const ns = (mech) => MECHANISM_NS[(mech ?? '').trim().toLowerCase()] ?? null;
const caip2Of = (dli) => ledgers[dli]?.caip2 ?? null;

const out = [];
const stats = { total: 0, group: 0, noLedger: 0, unknownLedgerCaip2: 0, noReference: 0, unknownMechanism: 0, malformed: 0, resolved: 0, native: 0 };
for (const r of tokenRecs) {
  if (r.__error) { stats.total++; continue; }
  stats.total++;
  const dti = r.__id;
  const nrm = r.Normative ?? {};
  const type = r.Header?.DTIType;
  const dli = nrm.AuxiliaryDistributedLedger ?? nrm.ProtocolDistributedLedger ?? null;
  const rec = {
    dti, dtiType: type,
    ledgerDli: dli,
    mechanism: nrm.AuxiliaryMechanism ?? null,
    technicalReference: nrm.AuxiliaryTechnicalReference ?? null,
    caip2: null, caip19: null, basis: null,
  };
  // DTIType 2 is a FUNCTIONALLY FUNGIBLE GROUP record: an identifier for the set
  // of tokens that are the same economic asset across ledgers. It has no ledger
  // and no address of its own BY DESIGN, and EquivalentDigitalTokenGroupDTI
  // lists its members. This is not a missing-data case and must not be counted
  // as one.
  if (type === 2) {
    stats.group++;
    const members = nrm.EquivalentDigitalTokenGroupDTI ?? [];
    out.push({ ...rec, basis: 'functionally-fungible-group',
               groupMembers: Array.isArray(members) ? members : [members].filter(Boolean) });
    continue;
  }
  if (!dli) { stats.noLedger++; out.push({ ...rec, basis: 'no-ledger-in-record' }); continue; }
  const caip2 = caip2Of(dli);
  rec.caip2 = caip2;
  if (!caip2) { stats.unknownLedgerCaip2++; out.push({ ...rec, basis: 'ledger-has-no-caip2' }); continue; }

  // For the "Native Attribute" mechanism DTIF often records a DOCUMENTATION URL
  // rather than an identifier — a link to the chain's source describing its
  // native unit. That is not an address and must not be encoded as one.
  const ref0 = nrm.AuxiliaryTechnicalReference ?? '';
  const isUrl = /^https?:\/\//i.test(ref0);

  // Native / protocol token: the ledger's own unit of account, no contract.
  if (type === 1 || !nrm.AuxiliaryTechnicalReference || isUrl) {
    stats.native++;
    out.push({ ...rec, basis: 'protocol-token-no-reference' });
    continue;
  }
  const namespace = ns(nrm.AuxiliaryMechanism);
  if (!namespace) { stats.unknownMechanism++; out.push({ ...rec, basis: `unmapped-mechanism:${nrm.AuxiliaryMechanism}` }); continue; }

  // Reuse the platform table's address normalisation for this chain where one
  // exists, so a DTI-derived CAIP-19 is byte-identical to the CoinGecko-derived
  // one for the same asset. Without that the two would never join.
  const platformEntry = Object.values(platformTable.platforms).find((p) => p.caip2 === caip2);
  const built = platformEntry
    ? buildCaip19({ ...platformEntry, assetNamespace: namespace }, nrm.AuxiliaryTechnicalReference)
    : null;
  // Without a matching platform entry we still have to produce a legal
  // reference, so apply the same rules by hand: an `ibc/<hash>` denom carries
  // its namespace in the prefix, and everything else is percent-encoded so
  // characters CAIP-19 forbids survive reversibly.
  let rawRef = nrm.AuxiliaryTechnicalReference;
  if (namespace === 'ics20' && rawRef.startsWith('ibc/')) rawRef = rawRef.slice(4);
  const caip19 = built?.caip19 ?? `${caip2}/${namespace}:${percentEncodeRef(rawRef)}`;
  if (!isValidCaip19(caip19)) { stats.malformed++; out.push({ ...rec, basis: 'malformed-caip19' }); continue; }
  stats.resolved++;
  out.push({ ...rec, caip19, basis: 'dtif-registry-exact' });
}

writeFileSync('data/ledgers.json', JSON.stringify({
  $schema: './../schema/ledgers.schema.json',
  _readme: 'DTI ledger records (DLIs) mapped to CAIP-2. Anchor block hashes come from DTIF\'s registry API; for Bitcoin-family chains the CAIP-2 reference IS the first 32 hex of that hash, so those entries are derived rather than inferred. Entries with caip2 null and kind "permissioned" are bank or CSD ledgers with no public chain identifier.',
  ledgers,
}, null, 2) + '\n');

writeFileSync('data/dti-identities.json', JSON.stringify({
  $schema: './../schema/dti-identities.schema.json',
  _readme: 'CAIP-19 identities derived from DTIF registry records — chain and contract address read from the registry, not inferred from names. `basis` "dtif-registry-exact" means the identifier was constructed from AuxiliaryDistributedLedger + AuxiliaryTechnicalReference + AuxiliaryMechanism. Any other basis says why no identifier could be built.',
  stats,
  identities: out,
}, null, 2) + '\n');

console.log(`ledgers: ${ledgerRecs.length} fetched, ${anchored} with an anchor hash, ${newlyIdentified} CAIP-2 newly derived from genesis`);
console.log(`tokens:  ${stats.total} fetched`);
for (const [k, v] of Object.entries(stats)) if (k !== 'total') console.log(`   ${k.padEnd(22)} ${v}`);
