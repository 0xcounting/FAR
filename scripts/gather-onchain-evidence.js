#!/usr/bin/env node
// Reads a token contract's own name(), symbol() and decimals() and prints a
// rationale a reviewer can paste into an `accepted` entry in data/links.json.
//
//   node scripts/gather-onchain-evidence.js <DTI> [<DTI> ...]
//   node scripts/gather-onchain-evidence.js --first 5
//
// It works from /_acceptance-queue.json (dist/, or the live site with
// FAR_BASE), so it only ever looks at links whose CoinGecko asset has exactly
// one deployment. Reading the contract confirms that the deployment CoinGecko
// points at really carries the name and ticker the DTI record carries. It does
// NOT confirm that the DTI names this deployment rather than one on a chain
// CoinGecko does not list; nothing public can. The rationale says so.
//
// EVM chains only, one JSON-RPC request per second, writes nothing. Public RPC
// endpoints come from chainid.network at run time; none are vendored.
import { readFileSync } from 'node:fs';

const BASE = process.env.FAR_BASE ?? null;
const args = process.argv.slice(2);
const firstN = args.includes('--first') ? Number(args[args.indexOf('--first') + 1]) : 0;
const wanted = new Set(args.filter((a) => /^[0-9A-Z]{9}$/.test(a)));
if (!firstN && !wanted.size) {
  console.error('usage: gather-onchain-evidence.js <DTI> [...]  |  --first <n>');
  process.exit(2);
}

const queue = BASE
  ? await (await fetch(`${BASE}/_acceptance-queue.json`)).json()
  : JSON.parse(readFileSync('dist/_acceptance-queue.json', 'utf8'));
let entries = queue.queue.filter((e) => e.caip19.startsWith('eip155:'));
entries = wanted.size ? entries.filter((e) => wanted.has(e.dti)) : entries.slice(0, firstN);
if (!entries.length) { console.error('nothing in the queue matches (EVM only)'); process.exit(1); }

const chains = await (await fetch('https://chainid.network/chains.json')).json();
const rpcsFor = (chainId) => {
  const c = chains.find((x) => x.chainId === chainId);
  // Skip endpoints that need a key or a websocket; keep a few to fall back on.
  return (c?.rpc ?? []).filter((u) => /^https:\/\//.test(u) && !u.includes('${') && !/wss?:/.test(u)).slice(0, 4);
};

const SEL = { name: '0x06fdde03', symbol: '0x95d89b41', decimals: '0x313ce567' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(rpc, to, data) {
  const r = await fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error.message);
  if (typeof j.result !== 'string' || j.result === '0x') throw new Error('empty result (not a contract, or does not implement the call)');
  return j.result;
}

// Try each public endpoint in turn; a chain's first-listed RPC is often the
// flakiest. Only a consistent revert across endpoints means the contract itself
// does not answer.
async function readToken(rpcs, address) {
  let last;
  for (const rpc of rpcs) {
    try {
      const name = decodeString(await call(rpc, address, SEL.name)); await sleep(1000);
      const symbol = decodeString(await call(rpc, address, SEL.symbol)); await sleep(1000);
      const decimals = Number(BigInt(await call(rpc, address, SEL.decimals))); await sleep(1000);
      return { name, symbol, decimals, rpc };
    } catch (err) { last = `${new URL(rpc).host}: ${err.message}`; }
  }
  throw new Error(last ?? 'no endpoint answered');
}
const decodeString = (hex) => {
  const b = Buffer.from(hex.slice(2), 'hex');
  if (b.length < 64) return b.toString('utf8').replace(/\0+$/, '');   // bytes32-style
  const len = Number(BigInt('0x' + b.subarray(32, 64).toString('hex')));
  return b.subarray(64, 64 + len).toString('utf8');
};

for (const e of entries) {
  const [, chainRef, address] = e.caip19.match(/^eip155:(\d+)\/[a-z0-9]+:(.+)$/) ?? [];
  const chainId = Number(chainRef);
  const rpcs = rpcsFor(chainId);
  console.log(`\n${e.dti}  ${e.dtiLongName} / ${e.dtiShortName ?? '—'}  ->  ${e.coingeckoId}`);
  console.log(`  ${e.caip19}`);
  if (!rpcs.length) { console.log('  no public RPC listed for this chain; check on an explorer instead'); continue; }
  try {
    const { name, symbol, decimals, rpc } = await readToken(rpcs, address);
    const agrees = name.toLowerCase().includes(e.dtiLongName.toLowerCase().split(' ')[0])
      || (e.dtiShortName && symbol.toLowerCase() === e.dtiShortName.toLowerCase());
    console.log(`  on-chain: name="${name}" symbol="${symbol}" decimals=${decimals}   ${agrees ? 'AGREES' : 'DISAGREES'}`);
    console.log('  rationale:');
    console.log(`    "The contract at ${address} on eip155:${chainId} reports name() = \\"${name}\\", symbol() = \\"${symbol}\\", decimals() = ${decimals} (read via ${new URL(rpc).host}). It is the only deployment CoinGecko lists for ${e.coingeckoId}, so a DTI record named \\"${e.dtiLongName}\\"${e.dtiShortName ? ` / ${e.dtiShortName}` : ''} cannot be pointing at a different chain among those CoinGecko knows. Residual risk: DTIF may hold a deployment CoinGecko does not list."`);
  } catch (err) {
    console.log(`  could not read the contract: ${err.message}`);
  }
}
