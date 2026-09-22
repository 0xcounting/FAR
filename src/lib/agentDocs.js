// Machine-readable descriptions of the registry, for agents and tooling.
//
//   openapiDoc()   OpenAPI 3.1 for every route, with response schemas that
//                  mirror what the build actually emits (a test holds them to
//                  the real files, so drift fails CI rather than misleading).
//   apiCatalog()   RFC 9727 linkset for /.well-known/api-catalog.
//   llmsFull()     llms.txt with the README and contributor guide inlined.
//
// All three take the public base URL so the same build can be served from a
// different origin without edits.

const S = {
  str: { type: 'string' },
  nstr: { type: ['string', 'null'] },
  int: { type: 'integer' },
  bool: { type: 'boolean' },
  caip2: { type: 'string', pattern: '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$', description: 'CAIP-2 chain id' },
  caip19: { type: 'string', pattern: '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}/[-a-z0-9]{3,8}:[-.%a-zA-Z0-9]{1,128}$', description: 'CAIP-19 asset id' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low', 'proposed'] },
};
const obj = (properties, required, description) => ({ type: 'object', properties, ...(required ? { required } : {}), ...(description ? { description } : {}) });
const arr = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) });

const envelope = {
  registry: { type: 'string', const: 'far' },
  version: { type: 'string', description: 'Release date, YYYY-MM-DD. Same across every file of one build.' },
  docs: { type: 'string', format: 'uri' },
};

const deployment = obj({
  caip19: S.caip19, caip2: S.caip2, chainName: S.nstr,
  coingeckoPlatform: { ...S.nstr, description: 'CoinGecko platform slug. Null for a native unit of account, which CoinGecko does not list as a platform entry.' },
  assetNamespace: S.str,
  address: { ...S.nstr, description: 'Contract address or asset id on that chain. Null for a native unit of account (assetNamespace slip44).' },
  native: { ...S.bool, description: 'Present and true when this is the chain\'s native unit of account.' },
  confidence: S.confidence,
  verified: obj({
    method: { type: 'string', enum: ['ics20-denom-trace'] },
    rule: S.str,
    path: S.str,
    baseDenom: S.str,
    origin: { ...S.nstr, description: 'CAIP-19 of the asset on its origin chain (derived by walking the path; null when the origin could not be reached).' },
    resolvedBy: S.nstr,
    placedVia: { type: 'string', enum: ['origin-identity', 'eth-erc20', 'ibc-canonical'], description: 'Which already-known identity placed this voucher on its CoinGecko id. Absent when CoinGecko itself lists the voucher.' },
  }, ['method', 'rule', 'path', 'baseDenom'], 'Present when the mapping is PROVEN rather than reviewed: for an ICS-20 voucher, sha256(path + "/" + baseDenom) reproduces the hash in the denom, so anyone can recompute it. The origin and placement are derived, the hash is not.'),
}, ['caip19', 'caip2', 'assetNamespace', 'confidence']);

const family = obj({
  family: { type: 'string', enum: ['canonical', 'standalone', 'derivative'], description: 'Naming structure, not merit: `canonical` is what other assets are named after, `derivative` declares itself a wrapper, `standalone` is neither. Most assets are standalone.' },
  citedBy: S.int, corroborated: S.int, attested: S.bool, derivative: S.bool,
}, ['family']);

const asset = obj({
  coingeckoId: S.str, name: S.str, symbol: S.str,
  deployments: arr(deployment, 'One entry per chain the asset exists on. Ordered by how much of the registry lives on that chain.'),
  related: obj({ sameName: arr(S.str), sameSymbol: arr(S.str) }, null, 'Other CoinGecko ids that collide with this one.'),
  family,
}, ['coingeckoId', 'name', 'symbol', 'deployments', 'family']);

const query = (by) => obj({ by: { type: 'string', const: by }, key: S.str }, ['by', 'key']);
const single = (by) => obj({ ...envelope, query: query(by), asset }, ['registry', 'version', 'query', 'asset']);
// The CAIP-19 route answers with the whole asset plus the one deployment that
// matched, so a caller need not search `deployments` for the id they asked for.
const byCaip = obj({ ...envelope, query: query('caip19'),
  alias: obj({ requested: S.caip19, canonical: S.caip19, chainAlias: S.caip2, chainCanonical: S.caip2 }, ['requested', 'canonical', 'chainAlias', 'chainCanonical'],
    'Present when the path was an ALIAS spelling of the chain (the raw cosmos chain-id of a hashed reference, e.g. cosmos:kava_2222-10). The record itself carries the canonical CAIP-19; this says what was asked for and what it resolved to.'),
  asset: obj({ ...asset.properties, deployment: { ...deployment, description: 'The deployment matching the requested CAIP-19.' } }, asset.required) },
  ['registry', 'version', 'query', 'asset']);
const group = (by) => obj({ ...envelope, query: query(by), count: S.int, assets: arr(asset) }, ['registry', 'version', 'query', 'count', 'assets'],
  'A GROUP: names and tickers are not unique. Use `family` to pick the canonical one.');

const proofDoc = obj({
  ...envelope, path: S.str, sha256: S.str, merkleRoot: S.str,
  proof: arr(obj({ side: { type: 'string', enum: ['left', 'right'] }, hash: S.str }, ['side', 'hash']), 'Sibling hashes from leaf to root, RFC 6962 style (leaf prefix 0x00, node prefix 0x01, odd nodes promoted).'),
}, ['path', 'sha256', 'merkleRoot', 'proof']);

const jsonResp = (schema, description) => ({ description, content: { 'application/json': { schema } } });
const notFound = { description: 'No such key. Static hosting returns the host\'s 404 page, not JSON.' };

export function openapiDoc(base, counts) {
  const b = base.replace(/\/$/, '');
  return {
    openapi: '3.1.0',
    info: {
      title: 'FAR — Free Asset Resolver',
      version: counts?.version ?? '0',
      summary: 'A static, key-less resolver between CoinGecko ids and CAIP-19 identifiers.',
      description: [
        'Every route is a static JSON file. There is no server, no authentication and no rate limit; a missing key is a 404 from the host.',
        '',
        `Current release: ${counts?.coins ?? '?'} CoinGecko assets, ${counts?.deployments ?? '?'} CAIP-19 deployments across ${counts?.chainsWithDeployments ?? '?'} chains.`,
        '',
        'Read /llms.txt first. Names and tickers are not unique: the /name and /symbol routes return groups, and `family` says which member is the canonical asset.',
        '',
        'Every file is sha256-hashed into /manifest.json and has an inclusion proof at /proof/{path without .json}.json, so a single response can be verified against the release\'s Merkle root.',
      ].join('\n'),
      license: { name: 'MIT (code); CC0 (curated tables); upstream terms for CoinGecko and chain data', url: 'https://github.com/0xcounting/FAR/blob/main/LICENSE-DATA' },
      contact: { url: 'https://github.com/0xcounting/FAR/issues' },
    },
    externalDocs: { url: `${b}/README.md`, description: 'Documentation (Markdown)' },
    servers: [{ url: b }],
    tags: [
      { name: 'lookup', description: 'One asset or group by identifier' },
      { name: 'bulk', description: 'Whole-registry and metadata files' },
      { name: 'integrity', description: 'Hashes and Merkle proofs' },
      { name: 'agents', description: 'Discovery files for agents and tooling' },
    ],
    paths: {
      '/index.json': { get: { tags: ['bulk'], summary: 'Counts, source hashes and the route list. Fetch this first.',
        responses: { 200: jsonResp(obj({ ...envelope, generated: S.str, sources: { type: 'object' }, counts: { type: 'object' }, routes: { type: 'object' } }, ['registry', 'version', 'counts', 'routes'])) } } },
      '/cg/{coingeckoId}.json': { get: { tags: ['lookup'], summary: 'One asset by CoinGecko id, with every chain deployment.',
        parameters: [{ name: 'coingeckoId', in: 'path', required: true, schema: S.str, example: 'tether' }],
        responses: { 200: jsonResp(single('coingeckoId')), 404: notFound } } },
      '/caip/{namespace}/{reference}/{assetNamespace}/{assetReference}.json': { get: { tags: ['lookup'],
        summary: 'The asset at an exact CAIP-19.',
        description: 'The CAIP-19 is written as a path: the `:` inside each half and the `/` between them become path separators, and `%` becomes `~`. So `eip155:1/erc20:0xdac17f…` is `/caip/eip155/1/erc20/0xdac17f….json`, and a Sui coin type `…%3A%3Ausdc%3A%3AUSDC` is `…~3A~3Ausdc~3A~3AUSDC`. Cosmos chains whose chain_id fails the cosmos profile\'s direct grammar (`kava_2222-10`, `shentu-2.2`) are canonically `cosmos:hashed-<16 hex>` and ALSO answer under the raw spelling (`/caip/cosmos/kava_2222-10/...`); the alias response carries an `alias` object naming the canonical id. See /_chains.json `aliases`.',
        parameters: [
          { name: 'namespace', in: 'path', required: true, schema: S.str, example: 'eip155' },
          { name: 'reference', in: 'path', required: true, schema: S.str, example: '1' },
          { name: 'assetNamespace', in: 'path', required: true, schema: S.str, example: 'erc20' },
          { name: 'assetReference', in: 'path', required: true, schema: S.str, example: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
        ],
        responses: { 200: jsonResp(byCaip), 404: notFound } } },
      '/name/{slug}.json': { get: { tags: ['lookup'], summary: 'Every asset with this name. Always a group.',
        description: 'Slug: lowercase, runs of anything but letters and digits become `-`, trimmed. "USD Coin" is `usd-coin`.',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: S.str, example: 'tether' }],
        responses: { 200: jsonResp(group('name')), 404: notFound } } },
      '/symbol/{slug}.json': { get: { tags: ['lookup'], summary: 'Every asset with this ticker. Always a group; `usdc` returns 60+.',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: S.str, example: 'usdc' }],
        responses: { 200: jsonResp(group('symbol')), 404: notFound } } },
      '/far.json.gz': { get: { tags: ['bulk'], summary: 'The entire registry, gzipped JSON (~1.8 MB).',
        responses: { 200: { description: 'gzip-compressed JSON', content: { 'application/gzip': { schema: { type: 'string', format: 'binary' } } } } } } },
      '/search-index.json': { get: { tags: ['bulk'], summary: 'Compact array the site searches client-side.',
        responses: { 200: jsonResp({ type: 'array', items: { type: 'object' } }) } } },
      '/_ics20-unplaced.json': { get: { tags: ['bulk'], summary: 'Hash-verified ICS-20 vouchers whose origin asset has no CoinGecko id; each carries the origin CAIP-19 it is equivalent to.', responses: { 200: jsonResp({ type: 'object' }) } } },
      '/_platforms.json': { get: { tags: ['bulk'], summary: 'Every chain mapping with confidence and evidence.', responses: { 200: jsonResp({ type: 'object' }) } } },
      '/_chains.json': { get: { tags: ['bulk'], summary: 'CAIP-2 -> chain identity for every chain the registry can name, independent of CoinGecko platforms (Cosmos today), with `aliases` mapping every raw-chain-id spelling to its canonical hashed key.', responses: { 200: jsonResp({ type: 'object' }) } } },
      '/_namespace-gaps.json': { get: { tags: ['bulk'], summary: 'Identifiers this registry chose because no CASA spec defines them.', responses: { 200: jsonResp({ type: 'object' }) } } },
      '/_explorers.json': { get: { tags: ['bulk'], summary: 'Block explorer base URLs by chain.', responses: { 200: jsonResp({ type: 'object' }) } } },
      '/manifest.json': { get: { tags: ['integrity'], summary: 'sha256 of every file and the release Merkle root (11 MB).',
        responses: { 200: jsonResp(obj({ ...envelope, generated: S.str, merkleRoot: S.str, algorithm: S.str, counts: { type: 'object' },
          files: arr(obj({ path: S.str, sha256: S.str, bytes: S.int }, ['path', 'sha256', 'bytes'])) }, ['merkleRoot', 'files'])) } } },
      '/manifest.sha256': { get: { tags: ['integrity'], summary: 'Two lines: sha256 of manifest.json, and the Merkle root.',
        responses: { 200: { description: 'text', content: { 'text/plain': { schema: S.str } } } } } },
      '/proof/{path}.json': { get: { tags: ['integrity'], summary: 'Inclusion proof for one published file.',
        description: '`path` is the file\'s published path without its `.json` suffix (so `/proof/cg/tether.json` proves `cg/tether.json`; `/proof/index.html.json` proves `index.html`). Verify: hash the file, walk the proof (0x00-prefixed leaf, 0x01-prefixed nodes, left/right by `side`), compare to `merkleRoot`.',
        parameters: [{ name: 'path', in: 'path', required: true, schema: S.str, example: 'cg/tether' }],
        responses: { 200: jsonResp(proofDoc), 404: notFound } } },
      '/llms.txt': { get: { tags: ['agents'], summary: 'What this is and how to use it, for LLMs (llmstxt.org format).', responses: { 200: { description: 'Markdown', content: { 'text/markdown': { schema: S.str } } } } } },
      '/llms-full.txt': { get: { tags: ['agents'], summary: 'llms.txt with the README and contributor guide inlined.', responses: { 200: { description: 'Markdown', content: { 'text/markdown': { schema: S.str } } } } } },
      '/README.md': { get: { tags: ['agents'], summary: 'Documentation.', responses: { 200: { description: 'Markdown', content: { 'text/markdown': { schema: S.str } } } } } },
      '/openapi.json': { get: { tags: ['agents'], summary: 'This document.', responses: { 200: jsonResp({ type: 'object' }) } } },
      '/.well-known/api-catalog': { get: { tags: ['agents'], summary: 'RFC 9727 API catalog.', responses: { 200: jsonResp({ type: 'object' }) } } },
      '/robots.txt': { get: { tags: ['agents'], summary: 'Crawler policy: everything is allowed. Comments point at the machine entry points.', responses: { 200: { description: 'text', content: { 'text/plain': { schema: S.str } } } } } },
    },
    components: { schemas: { Asset: asset, Deployment: deployment, Family: family, Proof: proofDoc } },
  };
}

export function apiCatalog(base) {
  const b = base.replace(/\/$/, '');
  return {
    linkset: [{
      anchor: `${b}/`,
      'service-desc': [{ href: `${b}/openapi.json`, type: 'application/json', title: 'OpenAPI 3.1' }],
      'service-doc': [
        { href: `${b}/`, type: 'text/html', title: 'Docs and live resolver' },
        { href: `${b}/README.md`, type: 'text/markdown', title: 'Documentation' },
        { href: `${b}/llms.txt`, type: 'text/markdown', title: 'Summary for LLMs' },
      ],
      'service-meta': [
        { href: `${b}/index.json`, type: 'application/json', title: 'Counts, sources, routes' },
        { href: `${b}/manifest.json`, type: 'application/json', title: 'File hashes and Merkle root' },
      ],
    }],
  };
}

export function llmsFull(llms, readme, contributing) {
  const rule = '\n\n---\n\n';
  return `${llms.trim()}${rule}# README\n\n${readme.trim()}${rule}# CONTRIBUTING\n\n${contributing.trim()}\n`;
}
