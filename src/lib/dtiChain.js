// Best-effort recovery of the two DTI fields the free snapshot redacts:
// which ledger a token record refers to, and its address there.
//
// Neither can be READ. Both are inferred, and the inference is only as good as
// the DTI->CoinGecko link it rests on. Every result therefore carries a `basis`
// saying how it was reached, and nothing here is ever published as fact.
//
// Three inference paths, strongest first:
//
//  1. name-hint      — the DTI long name names its own chain. DTIF is
//                      inconsistent about this, but 98 of 5,785 records do it:
//                      "Eth on Blast", "Dai Stablecoin on xDai", "(PoS) Dai".
//                      When the hint resolves AND the linked coin has a
//                      deployment on that chain, the pair agrees and both
//                      fields follow.
//  2. sole-deployment— the linked coin exists on exactly ONE chain, so there is
//                      nothing to choose between. Weaker than it looks: it is
//                      only as sound as the link.
//  3. none           — the coin is on several chains and nothing picks one.
//                      We publish the candidate list instead of guessing. This
//                      is the common case and it is the honest answer.

import { slug } from './slug.js';

// Chain words that appear inside DTI long names, mapped to the CoinGecko
// platform slug they denote. DTIF uses informal names ("xDai" for Gnosis,
// "PoS" for Polygon), so this is a vocabulary table, not a lookup.
const HINT_TO_PLATFORM = {
  eth: 'ethereum', ethereum: 'ethereum', erc20: 'ethereum',
  bsc: 'binance-smart-chain', bnb: 'binance-smart-chain', bep20: 'binance-smart-chain',
  xdai: 'xdai', gnosis: 'xdai',
  pos: 'polygon-pos', polygon: 'polygon-pos', matic: 'polygon-pos',
  sol: 'solana', solana: 'solana',
  avax: 'avalanche', avalanche: 'avalanche',
  arbitrum: 'arbitrum-one', optimism: 'optimistic-ethereum', op: 'optimistic-ethereum',
  base: 'base', blast: 'blast', taiko: 'taiko', linea: 'linea', scroll: 'scroll',
  zksync: 'zksync', celo: 'celo', fantom: 'fantom', cronos: 'cronos', moonbeam: 'moonbeam',
  tron: 'tron', trc20: 'tron', heco: 'huobi-token', harmony: 'harmony-shard-0',
  near: 'near-protocol', algorand: 'algorand', tezos: 'tezos', cardano: 'cardano',
  osmosis: 'osmosis', terra: 'terra', kava: 'kava', codex: null, // unknown chain, recorded so it is not silently dropped
};

// "pepecoin on SOL" | "Dai Stablecoin on xDai" | "(PoS) Dai Stablecoin" | "ELA on Ethereum"
export function extractChainHint(longName) {
  const name = longName ?? '';
  const on = name.match(/\bon\s+([A-Za-z0-9 ]{2,20})$/);
  if (on) return normaliseHint(on[1]);
  const paren = name.match(/\(([A-Za-z0-9 ]{2,20})\)/);
  if (paren) return normaliseHint(paren[1]);
  return null;
}

function normaliseHint(raw) {
  const key = slug(raw).replace(/-/g, '');
  if (!(key in HINT_TO_PLATFORM)) return null;
  const platform = HINT_TO_PLATFORM[key];
  return platform ? { hint: raw.trim(), platform } : null;
}

export function inferChainAndAddress(dtiRecord, coin, platformTable) {
  if (!coin || coin.deployments.length === 0) {
    return { caip2: null, caip19: null, address: null, basis: 'no-linked-deployment', candidates: [] };
  }
  const candidates = coin.deployments.map((d) => d.caip19);

  const hint = extractChainHint(dtiRecord.longName);
  if (hint) {
    const wanted = platformTable.platforms[hint.platform]?.caip2;
    const match = wanted && coin.deployments.find((d) => d.caip2 === wanted);
    if (match) {
      return { caip2: match.caip2, caip19: match.caip19, address: match.address,
               basis: 'name-hint', hint: hint.hint, candidates };
    }
    // The name names a chain the coin is not deployed on. That is a genuine
    // disagreement between two sources, not a near-miss — surface it rather
    // than falling through to a weaker inference that would hide it.
    return { caip2: null, caip19: null, address: null,
             basis: 'name-hint-unmatched', hint: hint.hint, candidates };
  }

  if (coin.deployments.length === 1) {
    const only = coin.deployments[0];
    return { caip2: only.caip2, caip19: only.caip19, address: only.address,
             basis: 'sole-deployment', candidates };
  }

  return { caip2: null, caip19: null, address: null, basis: 'ambiguous', candidates };
}
