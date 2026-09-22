import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { openapiDoc, apiCatalog } from '../src/lib/agentDocs.js';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const BASE = 'https://0xcounting.github.io/FAR';

// Walk an actual response against a schema: every key present must be declared,
// every `required` key must be present, enums must hold. Not a full validator
// (the repo has no dependencies) but it is the drift a hand-written schema gets.
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };
function conforms(value, schema, path = '$') {
  if (!schema) { problems.push(`${path}: no schema`); return; }
  const types = [].concat(schema.type ?? []);
  // Dispatch on what the value IS, then ask whether the schema allows it. A
  // union like string|array|null must accept each member, not just the first.
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array'
    : Number.isInteger(value) ? 'integer' : typeof value;
  if (types.length && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))
      && !(actual === 'object' && schema.properties && !types.length)) {
    problems.push(`${path}: got ${actual}, schema allows ${types.join('|')}`); return;
  }
  if (actual === 'null') return;
  if (schema.const !== undefined) check(value === schema.const, `${path}: const`);
  if (schema.enum) check(schema.enum.includes(value), `${path}: ${JSON.stringify(value)} not in enum`);
  if (actual === 'array') {
    if (schema.items) for (const [i, v] of value.entries()) conforms(v, schema.items, `${path}[${i}]`);
  } else if (actual === 'object') {
    if (schema.properties) {
      for (const k of Object.keys(value)) check(k in schema.properties, `${path}.${k}: emitted but not in schema`);
      for (const k of schema.required ?? []) check(k in value, `${path}.${k}: required but missing`);
      for (const [k, v] of Object.entries(value)) if (k in schema.properties) conforms(v, schema.properties[k], `${path}.${k}`);
    }
  } else if (actual === 'string' && schema.pattern) {
    check(new RegExp(schema.pattern).test(value), `${path}: ${value} fails ${schema.pattern}`);
  }
}

const doc = openapiDoc(BASE, read('dist/index.json').counts);
const schemaFor = (p) => doc.paths[p].get.responses[200].content['application/json'].schema;

test('openapi.json is well-formed and covers every advertised route', () => {
  assert.equal(doc.openapi, '3.1.0');
  const routes = read('dist/index.json').routes;
  const declared = Object.keys(doc.paths).map((p) => p.replace(/\{[^}]+\}/g, '').replace(/\/+/g, '/').split('/')[1]);
  for (const [k, r] of Object.entries(routes)) {
    const prefix = r.replace(/\s.*$/, '').replace(/\{[^}]+\}.*$/, '').split('/')[1];
    assert.ok(declared.includes(prefix), `route ${k} (${r}) has no OpenAPI path`);
  }
});

test('published responses conform to their OpenAPI schemas', () => {
  const cases = [
    ['/cg/{coingeckoId}.json', 'dist/cg/tether.json'],
    ['/cg/{coingeckoId}.json', 'dist/cg/usd-coin.json'],
    ['/cg/{coingeckoId}.json', 'dist/cg/bitcoin.json'],
    ['/caip/{namespace}/{reference}/{assetNamespace}/{assetReference}.json', 'dist/caip/eip155/1/erc20/0xdac17f958d2ee523a2206206994597c13d831ec7.json'],
    ['/name/{slug}.json', 'dist/name/tether.json'],
    ['/symbol/{slug}.json', 'dist/symbol/usdc.json'],
    ['/dti/{dti}.json', 'dist/dti/2RJ2NRNJ5.json'],
    ['/dti/{dti}.json', 'dist/dti/2ZTG3NNVB.json'],
    ['/ledger/{dli}.json', 'dist/ledger/PJP8FVDQ0.json'],
    ['/proof/{path}.json', 'dist/proof/cg/tether.json'],
    ['/_acceptance-queue.json', 'dist/_acceptance-queue.json'],
    ['/manifest.json', 'dist/manifest.json'],
    ['/index.json', 'dist/index.json'],
  ];
  for (const [route, file] of cases) {
    assert.ok(existsSync(file), `${file} missing; build first`);
    conforms(read(file), schemaFor(route), file);
  }
  // Report every distinct mismatch at once, de-duplicated by shape, so one run
  // shows the whole gap between schema and emitted data.
  const distinct = [...new Set(problems.map((m) => m.replace(/\[\d+\]/g, '[]')))];
  assert.equal(distinct.length, 0, `schema drift:\n  ${distinct.slice(0, 40).join('\n  ')}`);
});

test('llms.txt follows the llmstxt.org shape', () => {
  const t = readFileSync('site/llms.txt', 'utf8');
  const lines = t.split('\n');
  assert.match(lines[0], /^# \S/, 'first line is the H1');
  assert.match(t, /\n> \S/, 'has a blockquote summary');
  assert.match(t, /\n## Optional\n/, 'has the Optional section');
  for (const m of t.matchAll(/\]\((https?:[^)]+)\)/g)) assert.doesNotMatch(m[1], /\s/, `link has whitespace: ${m[1]}`);
  assert.ok((t.match(/^- \[/gm) ?? []).length >= 15, 'lists the routes');
});

test('api-catalog is an RFC 9727 linkset pointing at the OpenAPI description', () => {
  const c = apiCatalog(BASE);
  assert.ok(Array.isArray(c.linkset) && c.linkset.length === 1);
  const e = c.linkset[0];
  assert.equal(e.anchor, `${BASE}/`);
  assert.ok(e['service-desc'].some((l) => l.href.endsWith('/openapi.json')));
  assert.ok(e['service-doc'].length >= 1 && e['service-meta'].length >= 1);
});

test('DTIF group membership is read from the snapshot and expressed as asset equivalence', () => {
  const counts = read('dist/index.json').counts;
  assert.ok(counts.assetsWithDtifEquivalence >= 10, `expected some equivalences, got ${counts.assetsWithDtifEquivalence}`);
  const q = read('dist/_acceptance-queue.json');
  assert.ok(q.queue.every((e) => e.dtiType !== 3), 'group records must not be in the acceptance queue');
});
