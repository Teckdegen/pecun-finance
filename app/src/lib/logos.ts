import { getJson } from "./http.ts";
import { PLATFORM_LOGO } from "./platforms.ts";
import type { Opportunity } from "./types.ts";

/**
 * Logos come from three places:
 *  - Protocols: icons taken from each protocol's own website, stored in /public/logos/protocols.
 *  - Chains: LI.FI's open chain list (logoURI per chain).
 *  - Tokens: LI.FI's open token list (35k+ tokens on EVM, Solana and Sui), unless the protocol's
 *    own API already gave us one.
 */

const PROTOCOL_LOGO = PLATFORM_LOGO;

/** Our chain names → LI.FI's chain names where they differ. */
const CHAIN_ALIAS: Record<string, string> = {
  "BNB Chain": "BSC",
  Optimism: "OP Mainnet",
  Robinhood: "Robinhood Chain",
  "X Layer": "XLayer",
  Megaeth: "MegaETH",
};

type LifiChain = { id: number; name: string; logoURI?: string };
type LifiToken = { chainId: number; symbol: string; logoURI?: string; verificationStatus?: string };

type LogoIndex = {
  chain: Map<string, string>;
  chainIdByName: Map<string, number>;
  /** "chainId:SYMBOL" → logo */
  tokenOnChain: Map<string, string>;
  /** "SYMBOL" → logo (first verified hit on any chain) */
  token: Map<string, string>;
  at: number;
};

const DAY = 24 * 60 * 60_000;
const g = globalThis as unknown as { __pecunLogos?: LogoIndex; __pecunLogosLoading?: Promise<LogoIndex> };

async function loadIndex(): Promise<LogoIndex> {
  const [chains, tokens] = await Promise.all([
    getJson<{ chains: LifiChain[] }>("https://li.quest/v1/chains?chainTypes=EVM,SVM,MVM,UTXO"),
    getJson<{ tokens: Record<string, LifiToken[]> }>("https://li.quest/v1/tokens?chainTypes=EVM,SVM,MVM", 120_000),
  ]);
  const idx: LogoIndex = { chain: new Map(), chainIdByName: new Map(), tokenOnChain: new Map(), token: new Map(), at: Date.now() };
  for (const c of chains.chains) {
    if (c.logoURI) idx.chain.set(c.name, c.logoURI);
    idx.chainIdByName.set(c.name, c.id);
  }
  // Verified tokens first, so a scam token with a popular symbol never wins the symbol-only lookup.
  const all = Object.values(tokens.tokens).flat();
  all.sort((a, b) => Number(b.verificationStatus === "verified") - Number(a.verificationStatus === "verified"));
  for (const t of all) {
    if (!t.logoURI) continue;
    const sym = t.symbol.toUpperCase();
    const k = `${t.chainId}:${sym}`;
    if (!idx.tokenOnChain.has(k)) idx.tokenOnChain.set(k, t.logoURI);
    if (!idx.token.has(sym)) idx.token.set(sym, t.logoURI);
  }
  return idx;
}

/** Returns the cached index, refreshing daily in the background. Never throws. */
export async function getLogoIndex(waitMs = 30_000): Promise<LogoIndex | null> {
  const cur = g.__pecunLogos;
  if (cur && Date.now() - cur.at < DAY) return cur;
  g.__pecunLogosLoading ??= loadIndex()
    .then((i) => (g.__pecunLogos = i))
    .finally(() => (g.__pecunLogosLoading = undefined));
  const loading = g.__pecunLogosLoading.catch(() => null);
  if (cur) return cur; // serve stale while refreshing
  return Promise.race([loading, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
}

/** Strip wrappers so "PT sUSDe", "USDC-WETH", "jlUSDC" still find a sensible first-asset logo. */
function candidates(asset: string): string[] {
  const first = asset.split(/[-/ ]/)[0] ?? asset;
  const out = [asset, first];
  for (const s of [first]) {
    if (/^w(?!stETH)/i.test(s) && s.length > 3) out.push(s.slice(1)); // WETH → ETH
    if (/^(st|s)[A-Z]/.test(s)) out.push(s.replace(/^(st|s)/, "")); // sUSDe → USDe
    if (/^(vb|super)[A-Z]/.test(s)) out.push(s.replace(/^(vb|super)/, "")); // vbUSDC → USDC (bridged/wrapped)
  }
  return out.map((s) => s.toUpperCase());
}

export function withLogos(list: Opportunity[], idx: LogoIndex | null): Opportunity[] {
  return list.map((o) => {
    const lifiChain = CHAIN_ALIAS[o.chain] ?? o.chain;
    const chainId = idx?.chainIdByName.get(lifiChain);
    // LI.FI's curated token logos first; some protocol APIs link to pages that aren't images.
    let assetLogo: string | undefined;
    if (idx) {
      for (const c of candidates(o.asset)) {
        assetLogo = (chainId !== undefined && idx.tokenOnChain.get(`${chainId}:${c}`)) || idx.token.get(c);
        if (assetLogo) break;
      }
    }
    return {
      ...o,
      protocolLogo: PROTOCOL_LOGO[o.protocol] ?? o.protocolLogo ?? (o.protocol === "Solana staking" ? o.logoUrl : undefined),
      chainLogo: idx?.chain.get(lifiChain) ?? o.chainLogo,
      assetLogo: assetLogo ?? o.assetLogo,
    };
  });
}
