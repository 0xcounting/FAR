import { slug } from './slug.js';
import { unlocked } from './sources.js';

// DTIType and DLTType are integers in the snapshot with no legend shipped
// alongside them. These labels are inferred from the distribution and from the
// ISO 24165 structure; they are NOT quoted from the standard, so they are
// published as `typeLabel` next to the raw `type` and a consumer that needs
// certainty should key off the raw value.
const DTI_TYPE = {
  0: 'auxiliary-token',   // 3,287 records — token on a host ledger
  1: 'native-token',      // 255 records — the ledger's own unit of account
  3: 'functionally-fungible-group-member', // 2,336 — carries EquivalentDigitalTokenGroupDTI
};

export function normalizeDtiRecords(records) {
  const tokens = [];
  const ledgers = [];
  for (const r of records) {
    const h = r.Header ?? {};
    const inf = r.Informative ?? {};
    const nrm = r.Normative ?? {};
    // The snapshot ships duplicate rows for some identifiers; dedupe downstream.
    if (h.DTI) {
      tokens.push({
        dti: h.DTI,
        type: h.DTIType,
        typeLabel: DTI_TYPE[h.DTIType] ?? null,
        longName: inf.LongName ?? null,
        // LongName sometimes carries an appended " // ISIN: DE000…" for
        // security tokens. The ISIN is real data worth keeping, but it must not
        // leak into the matching key.
        shortNames: extractShortNames(inf.ShortNames),
        isin: extractIsin(inf.LongName),
        equivalentGroup: unlocked(nrm.EquivalentDigitalTokenGroupDTI),
      });
    } else if (h.DLI) {
      ledgers.push({
        dli: h.DLI,
        type: h.DLTType,
        longName: inf.LongName ?? null,
      });
    }
  }
  return { tokens: dedupeBy(tokens, (t) => t.dti), ledgers: dedupeBy(ledgers, (l) => l.dli) };
}

function dedupeBy(rows, key) {
  const seen = new Map();
  for (const r of rows) if (!seen.has(key(r))) seen.set(key(r), r);
  return [...seen.values()];
}

function extractIsin(longName) {
  const m = (longName ?? '').match(/\bISIN:\s*([A-Z]{2}[A-Z0-9]{9}\d)\b/);
  return m ? m[1] : null;
}

export function matchableName(longName) {
  return slug((longName ?? '').split('//')[0]);
}

// ShortNames arrives as an object, an array of objects, or an array of strings
// depending on record age. All three shapes are live in the current snapshot.
function extractShortNames(sn) {
  if (!sn) return [];
  const list = Array.isArray(sn) ? sn : [sn];
  const out = [];
  for (const e of list) {
    const v = typeof e === 'string' ? e : e?.ShortName;
    for (const s of Array.isArray(v) ? v : [v]) if (s) out.push(s);
  }
  return [...new Set(out)];
}
