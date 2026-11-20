"use client";

import { loadActivity, netUnits, type ActivityItem, type ActivityVault, type SignRequest } from "./activity";
import { oneClickFor } from "./exec";
import { chainIdByName } from "./exec-chains";
import { listPending } from "./pending-withdrawals";
import type { Catalog, Opportunity } from "./types";

/* The user's live positions across every chain: read from the chain (share tokens in the wallet, plus vaults used
   through Pecun), valued in USD. Shared by Portfolio and the deposit sheet's payback comparison. */

const STABLE = /^(USD|USDC|USDT|USDT0|USD₮0|DAI|USDS|USDE|GHO|PYUSD|USDG|FRXUSD|CRVUSD|USD0|AUSD|USD1|RLUSD|LUSD|FRAX|USDC\.E|USDBC)$/i;
const LIFI_CHAIN: Record<string, number> = { Solana: 1151111081099710, Sui: 9270000000000000 };
const prices = new Map<string, Promise<number | null>>();

/** USD per position unit: 1 for dollar-denominated positions and stablecoins, else LI.FI's open price by symbol. */
export function usdPerUnit(chain: string, symbol: string): Promise<number | null> {
  if (symbol === "USD" || symbol.startsWith("USD of ") || STABLE.test(symbol)) return Promise.resolve(1);
  const id = chainIdByName(chain) ?? LIFI_CHAIN[chain];
  if (!id) return Promise.resolve(null);
  const k = `${id}:${symbol}`;
  let p = prices.get(k);
  if (!p) {
    p = fetch(`https://li.quest/v1/token?chain=${id}&token=${encodeURIComponent(symbol)}`)
      .then((r) => r.json() as Promise<{ priceUSD?: string }>)
      .then((t) => Number(t.priceUSD) || null)
      .catch(() => null);
    prices.set(k, p);
  }
  return p;
}

export type Position = { o: Opportunity | ActivityVault; amount: number; symbol: string; usd: number | null; earned: number | null; earnedUsd: number | null };

/** Every vault the user may be in: share tokens found on-chain in their wallet, plus vaults they used through Pecun. */
async function findVaults(owner: string, log: { items: ActivityItem[]; vaults: string[] }): Promise<(Opportunity | ActivityVault)[]> {
  const [cat, held] = await Promise.all([
    fetch("/api/opportunities").then((r) => r.json() as Promise<Catalog>),
    fetch("/api/holdings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: owner }) })
      .then((r) => r.json() as Promise<{ tokens?: { chainId: number; token: string }[] }>)
      .catch(() => ({ tokens: [] })),
  ]);
  const all = [...cat.opportunities, ...(cat.unlisted ?? []), ...cat.closed];
  const byToken = new Map<string, Opportunity>();
  for (const o of all) {
    const id = chainIdByName(o.chain);
    if (id && o.address && /^0x[0-9a-fA-F]{40}$/.test(o.address)) byToken.set(`${id}:${o.address.toLowerCase()}`, o);
  }
  const byId = new Map(all.map((o) => [o.id, o]));
  const found = new Map<string, Opportunity | ActivityVault>();
  for (const t of held.tokens ?? []) {
    const o = byToken.get(`${t.chainId}:${t.token}`);
    if (o) found.set(o.id, o);
  }
  for (const a of log.items) if (!found.has(a.vault.id)) found.set(a.vault.id, byId.get(a.vault.id) ?? a.vault);
  for (const id of log.vaults) if (!found.has(id) && byId.has(id)) found.set(id, byId.get(id)!);
  for (const p of listPending(owner)) if (!found.has(p.id)) found.set(p.id, byId.get(p.id) ?? (p as Opportunity));
  return [...found.values()];
}

export async function readPositions(owner: string, who: { address: `0x${string}`; solanaAddress?: string; suiAddress?: string }, sign: SignRequest): Promise<Position[]> {
  const log = await loadActivity(owner, sign);
  const vaults = await findVaults(owner, log);
  const rows: Position[] = [];
  // A few at a time, so public RPCs don't rate-limit.
  for (let i = 0; i < vaults.length; i += 6) {
    const batch = await Promise.all(
      vaults.slice(i, i + 6).map(async (o): Promise<Position | null> => {
        const a = oneClickFor(o as Opportunity);
        if (!a) return null;
        const amount = await a.position(who).catch(() => 0);
        if (!(amount > 1e-9)) return null;
        const symbol = a.positionSymbol;
        const rate = await usdPerUnit(o.chain, symbol);
        const net = netUnits(log.items, o.id);
        const earned = net !== undefined && net > 0 ? Math.max(0, amount - net) : null;
        return { o, amount, symbol, usd: rate === null ? null : amount * rate, earned, earnedUsd: earned === null || rate === null ? null : earned * rate };
      }),
    );
    for (const r of batch) if (r) rows.push(r);
  }
  return rows.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}

