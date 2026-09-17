import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const SOURCES = {
  coingeckoCoins: 'data/sources/coingecko-coins.json.gz',
  coingeckoPlatforms: 'data/sources/coingecko-platforms.json.gz',
  dtiRegistry: 'data/sources/dti-registry.json.gz',
  evmChains: 'data/sources/evm-chains.json.gz',
};

// Every build records the sha256 of the exact bytes it read. That hash travels
// into the published manifest, so a consumer can tell whether two dumps were
// built from the same inputs without re-downloading the inputs.
export function loadSources() {
  const provenance = {};
  const out = {};
  for (const [key, path] of Object.entries(SOURCES)) {
    const raw = readFileSync(path);
    provenance[key] = { path, sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length };
    out[key] = JSON.parse(gunzipSync(raw));
  }
  // The DTI snapshot wraps its rows in { records: [...] }; the others are bare arrays.
  out.dtiRegistry = out.dtiRegistry.records;
  return { ...out, provenance };
}

// The free DTI snapshot redacts most fields to the literal string "<locked>".
// A redacted value is absent data, not a value — treating "<locked>" as content
// would publish that string as if it were an issuer name.
export const LOCKED = '<locked>';
export const unlocked = (v) => (v === LOCKED || v == null ? null : v);
