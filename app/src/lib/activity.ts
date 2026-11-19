"use client";

import type { Opportunity } from "./types";

/**
 * Deposits and withdrawals made through Pecun: the Activity history, and the amounts the Portfolio uses to estimate
 * yield earned. Indexed in Upstash (via /api/activity, signed with the user's own session) so it follows the wallet to
 * any device, and mirrored on this device so it shows instantly and survives the index being unreachable.
 * On-chain positions are read live; this is only the log.
 */

/** Signs a "list my wallet accounts" request with the user's session (useAuth().signAccountsRequest). */
export type SignRequest = () => Promise<unknown | null>;

export type ActivityVault = Pick<
  Opportunity,
  "id" | "slug" | "name" | "protocol" | "chain" | "asset" | "kind" | "address" | "ref" | "ticker" | "apy" | "logoUrl" | "assetLogo" | "protocolLogo" | "chainLogo" | "stablecoin"
>;

export type ActivityItem = {
  vault: ActivityVault;
  side: "add" | "withdraw";
  /** What was typed: USDC for a deposit, position units for a withdrawal ("max" for everything). */
  amount: string;
  /** Position units this moved into (deposit) or out of (withdrawal) the vault, when known. */
  units?: number;
  /** The result line ("99.28 USDC") or the error. */
  result?: string;
  error?: string;
  status: "done" | "failed";
  /** Set when Pecun finished it on its own (a queued payout brought home). */
  auto?: boolean;
  at: number;
};

const key = (owner: string) => `pecun:activity:${owner.toLowerCase()}`;
const MAX = 300;

export function slimVault(o: Opportunity): ActivityVault {
  const { id, slug, name, protocol, chain, asset, kind, address, ref, ticker, apy, logoUrl, assetLogo, protocolLogo, chainLogo, stablecoin } = o;
  return { id, slug, name, protocol, chain, asset, kind, address, ref, ticker, apy, logoUrl, assetLogo, protocolLogo, chainLogo, stablecoin };
}

export function listActivity(owner: string): ActivityItem[] {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key(owner)) ?? "[]") as ActivityItem[];
  } catch {
    return [];
  }
}

function saveLocal(owner: string, list: ActivityItem[]) {
  try {
    globalThis.localStorage?.setItem(key(owner), JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage unavailable */
  }
}

const sameItem = (a: ActivityItem, b: ActivityItem) => a.at === b.at && a.side === b.side && a.vault.id === b.vault.id;
const merge = (...lists: ActivityItem[][]) => {
  const out: ActivityItem[] = [];
  for (const l of lists) for (const it of l) if (!out.some((x) => sameItem(x, it))) out.push(it);
  return out.sort((a, b) => b.at - a.at);
};

/** Reads (and with `item`, adds to) the wallet's history in the index. Null when the index can't be reached. */
async function remote(owner: string, sign: SignRequest, item?: ActivityItem): Promise<{ items: ActivityItem[]; vaults: string[] } | null> {
  try {
    const signed = await sign();
    if (!signed) return null;
    const res = await fetch("/api/activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signed, address: owner, item }) });
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: ActivityItem[]; vaults?: string[]; indexed?: boolean };
    return j.indexed ? { items: j.items ?? [], vaults: j.vaults ?? [] } : null;
  } catch {
    return null;
  }
}

/** Records a deposit or withdrawal on this device and in the index. */
export function recordActivity(owner: string, item: ActivityItem, sign?: SignRequest) {
  saveLocal(owner, [item, ...listActivity(owner)]);
  window.dispatchEvent(new Event("pecun:activity-changed"));
  if (sign) void remote(owner, sign, item);
}

/**
 * The full history: the index (every device) merged with this device's log, newest first; plus every vault id the
 * wallet has used. Local entries the index doesn't have yet (recorded while it was unreachable) are sent up.
 */
export async function loadActivity(owner: string, sign?: SignRequest): Promise<{ items: ActivityItem[]; vaults: string[] }> {
  const local = listActivity(owner);
  const r = sign ? await remote(owner, sign) : null;
  if (!r) return { items: local, vaults: [...new Set(local.map((a) => a.vault.id))] };
  const missing = local.filter((l) => !r.items.some((x) => sameItem(x, l)));
  for (const m of missing.slice(0, 20)) void remote(owner, sign!, m);
  const items = merge(r.items, local);
  saveLocal(owner, items);
  return { items, vaults: [...new Set([...r.vaults, ...items.map((a) => a.vault.id)])] };
}

/** The first number in a result line like "99.28 USDC" or "1,204.5 USD of GM". */
export const firstNumber = (s?: string) => {
  const m = s?.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

/** Net position units put in through Pecun (deposits minus withdrawals), or undefined when the log can't tell. */
export function netUnits(items: ActivityItem[], vaultId: string): number | undefined {
  let net = 0;
  let any = false;
  for (const a of items) {
    if (a.vault.id !== vaultId || a.status !== "done" || a.units === undefined) continue;
    any = true;
    net += a.side === "add" ? a.units : -a.units;
  }
  return any ? net : undefined;
}
