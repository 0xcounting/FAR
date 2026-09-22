// ICS-20 vouchers: the one asset class in this registry whose mapping is
// CHECKABLE rather than merely assertable.
//
// When a token crosses an IBC channel it arrives as a voucher whose denom is
// `ibc/<HASH>`, and the chain that minted it defines the hash:
//
//     HASH = uppercase(hex(sha256(utf8(path + "/" + base_denom))))
//
// where `path` is the transfer route ("transfer/channel-0", or several hops
// joined with "/") and `base_denom` is the denom on the origin chain. So a
// claimed mapping (chain, ibc/<HASH>) -> (path, base_denom) can be re-derived
// by anyone from the two strings alone: if the hash does not reproduce, the
// claim is false and no node, API or reviewer can smuggle it in. This module
// enforces that at build time and at validate time. Rows that fail are dropped
// and counted, never published.
//
// What the hash does NOT prove: which chain sits at the far end of the path
// (`originChainId`), or the origin asset's symbol and decimals. The origin is
// the result of walking the path through the chain-registry's _IBC channel
// tables and is carried as provenance (`resolvedBy`); the metadata is not
// carried at all, because it is not what the hash establishes.
import { createHash } from 'node:crypto';
import { cosmosCaip2, cosmosNamespace, percentEncodeRef, percentDecodeRef, isValidCaip19 } from './caip.js';

export function ics20Hash(path, baseDenom) {
  return createHash('sha256').update(`${path}/${baseDenom}`, 'utf8').digest('hex').toUpperCase();
}

/** True iff the row's denom is exactly `ibc/` + the hash its own path and base denom produce. */
export function verifyIcs20Trace(row) {
  if (!row || typeof row.path !== 'string' || typeof row.baseDenom !== 'string' || typeof row.denom !== 'string') return false;
  if (!row.path || !row.baseDenom) return false;
  return row.denom === `ibc/${ics20Hash(row.path, row.baseDenom)}`;
}

// The identity key this module joins on: `<caip2>|<assetNamespace>|<native ref>`
// with the reference in its NATIVE (percent-decoded) spelling, so a CoinGecko-
// derived deployment and a trace-derived origin compare equal.
export function cosmosAssetKey(caip2, rawDenom) {
  const { ns, ref } = cosmosNamespace(rawDenom);
  return `${caip2}|${ns}|${ns === 'ics20' ? ref.toUpperCase() : ref}`;
}

export function caip19Of(caip2, rawDenom) {
  const { ns, ref } = cosmosNamespace(rawDenom);
  const caip19 = `${caip2}/${ns}:${percentEncodeRef(ns === 'ics20' ? ref.toUpperCase() : ref)}`;
  return isValidCaip19(caip19) ? caip19 : null;
}

/**
 * Place verified vouchers onto CoinGecko coins, using only identities the
 * registry already holds. Three routes, in order of directness:
 *
 *   origin-identity  the origin chain's base denom is itself a known identity
 *                    (a CoinGecko platform row, or the chain table's native coin)
 *   eth-erc20        the base denom is an Ethereum ERC-20 address (gravity0x…,
 *                    peggy0x…, 0x…) that eip155:1 already names
 *   ibc-canonical    CoinGecko lists SOME voucher for the same (origin, base)
 *                    pair; every other voucher with that pair is the same asset
 *
 * A voucher none of these reach is returned as `unplaced` WITH its origin
 * CAIP-19: two identifiers, one asset, no CoinGecko id -- still a fact worth
 * publishing, just not one this registry's asset-centric routes can carry yet.
 *
 * `coinsById` is the assembled asset map (mutated: deployments are pushed).
 * `chainTable` is data/chains.json's `chains`. `platformTable` is
 * data/platforms.json. Returns counts and the unplaced list.
 */
export function placeIcs20Vouchers(traces, { coinsById, chainTable, platformTable }) {
  const stats = { verified: 0, rejected: 0, alreadyListed: 0, placed: 0, unplaced: 0, placedVia: {} };

  // chainId (raw Tendermint id) -> chain row, and CAIP-2 -> platform slug
  // (accepting the legacy unhashed spelling, as validate does).
  const chainByRawId = new Map(Object.values(chainTable).map((c) => [c.chainId, c]));
  const caip2ByRawId = new Map(Object.entries(chainTable).map(([caip2, c]) => [c.chainId, caip2]));
  const platformByCaip2 = new Map();
  for (const [slug, p] of Object.entries(platformTable.platforms)) if (!platformByCaip2.has(p.caip2)) platformByCaip2.set(p.caip2, slug);
  const platformFor = (caip2, rawId) => platformByCaip2.get(caip2) ?? platformByCaip2.get(`cosmos:${rawId}`) ?? null;
  const caip2ForChain = (rawId) => caip2ByRawId.get(rawId) ?? cosmosCaip2(rawId);

  // Identity index over what the registry already knows.
  const coinByKey = new Map();
  const ethByAddress = new Map();
  for (const coin of coinsById.values()) {
    for (const d of coin.deployments) {
      if (d.caip2 === 'eip155:1' && d.assetNamespace === 'erc20') { ethByAddress.set(d.address, coin.coingeckoId); continue; }
      if (!d.caip2.startsWith('cosmos:') || d.native) continue;
      const ref = percentDecodeRef(d.caip19.slice(d.caip19.indexOf(':', d.caip19.indexOf('/')) + 1));
      // The platform may be served under the legacy unhashed caip2; index under
      // the chain table's spelling too so an origin computed from a raw chain id
      // finds it either way.
      const spellings = new Set([d.caip2]);
      const raw = d.caip2.slice('cosmos:'.length);
      if (chainByRawId.has(raw)) spellings.add(caip2ForChain(raw));
      for (const c2 of spellings) {
        coinByKey.set(`${c2}|${d.assetNamespace}|${d.assetNamespace === 'ics20' ? ref.toUpperCase() : ref}`, coin.coingeckoId);
        // CoinGecko renders some bank denoms chain-prefixed ("persistence/uxprt");
        // index the bare denom as well so the on-chain spelling resolves.
        if (d.assetNamespace === 'bank' && ref.includes('/')) coinByKey.set(`${c2}|bank|${ref.slice(ref.indexOf('/') + 1)}`, coin.coingeckoId);
      }
    }
  }
  for (const [caip2, c] of Object.entries(chainTable)) {
    if (c.coingeckoNativeCoinId && c.nativeDenom && coinsById.has(c.coingeckoNativeCoinId)) {
      const k = `${caip2}|bank|${c.nativeDenom}`;
      if (!coinByKey.has(k)) coinByKey.set(k, c.coingeckoNativeCoinId);
    }
  }

  // Verified rows only, then the canonical pass needs (origin|base) -> coin from
  // vouchers CoinGecko already lists.
  const rows = [];
  for (const t of traces) {
    if (!verifyIcs20Trace(t)) { stats.rejected++; continue; }
    stats.verified++;
    rows.push(t);
  }
  const canonical = new Map();
  for (const t of rows) {
    if (!t.originChainId) continue;
    const listed = coinByKey.get(`${caip2ForChain(t.chainId)}|ics20|${t.denom.slice(4).toUpperCase()}`);
    if (listed) { const k = `${t.originChainId}|${t.baseDenom}`; if (!canonical.has(k)) canonical.set(k, listed); }
  }

  const unplaced = [];
  for (const t of rows) {
    const chainCaip2 = caip2ForChain(t.chainId);
    const chain = chainByRawId.get(t.chainId);
    const hash = t.denom.slice(4).toUpperCase();
    const caip19 = `${chainCaip2}/ics20:${hash}`;
    const originCaip2 = t.originChainId ? caip2ForChain(t.originChainId) : null;
    const originCaip19 = originCaip2 ? caip19Of(originCaip2, t.baseDenom) : null;
    const verified = {
      method: 'ics20-denom-trace',
      rule: 'uppercase(hex(sha256(path + "/" + baseDenom))) reproduces the hash in the denom',
      path: t.path,
      baseDenom: t.baseDenom,
      origin: originCaip19,
      resolvedBy: t.resolvedBy ?? null,
    };

    // Already a CoinGecko-listed deployment: attach the provenance, add nothing.
    const listedCoin = coinByKey.get(`${chainCaip2}|ics20|${hash}`);
    if (listedCoin) {
      const coin = coinsById.get(listedCoin);
      const d = coin?.deployments.find((x) => x.assetNamespace === 'ics20' && x.address?.toUpperCase() === `IBC/${hash}`);
      if (d && !d.verified) d.verified = verified;
      stats.alreadyListed++;
      continue;
    }

    let coinId = null; let via = null;
    if (originCaip2) {
      coinId = coinByKey.get(cosmosAssetKey(originCaip2, t.baseDenom)) ?? null; if (coinId) via = 'origin-identity';
      if (!coinId) {
        const m = t.baseDenom.match(/^(?:gravity|peggy)?(0x[0-9a-fA-F]{40})$/);
        if (m && ethByAddress.has(m[1].toLowerCase())) { coinId = ethByAddress.get(m[1].toLowerCase()); via = 'eth-erc20'; }
      }
      if (!coinId) { const c = canonical.get(`${t.originChainId}|${t.baseDenom}`); if (c) { coinId = c; via = 'ibc-canonical'; } }
    }
    if (!coinId || !coinsById.has(coinId)) {
      stats.unplaced++;
      unplaced.push({ caip19, chainId: t.chainId, denom: t.denom, path: t.path, baseDenom: t.baseDenom, originChainId: t.originChainId ?? null, equivalentTo: originCaip19, resolvedBy: t.resolvedBy ?? null });
      continue;
    }
    const coin = coinsById.get(coinId);
    if (coin.deployments.some((d) => d.caip19 === caip19)) { stats.alreadyListed++; continue; }
    coin.deployments.push({
      caip19,
      caip2: chainCaip2,
      chainName: chain?.name ?? null,
      coingeckoPlatform: platformFor(chainCaip2, t.chainId),
      assetNamespace: 'ics20',
      address: `ibc/${hash}`,
      // The hash proves the voucher IS (path, baseDenom); the confidence that the
      // chain named by `chainId` is the chain we think it is comes from the chain
      // table, and the voucher cannot be more certain than its chain.
      confidence: chain?.confidence ?? 'medium',
      verified: { ...verified, placedVia: via },
    });
    stats.placed++;
    stats.placedVia[via] = (stats.placedVia[via] ?? 0) + 1;
  }
  unplaced.sort((a, b) => (a.caip19 < b.caip19 ? -1 : a.caip19 > b.caip19 ? 1 : 0));
  return { stats, unplaced };
}
