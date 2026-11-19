"use client";

import type { Opportunity } from "./types";

/**
 * Deposits and withdrawals made through Pecun, remembered per user on this device: the Activity history, and the
 * amounts the Portfolio uses to estimate yield earned. On-chain positions are read live; this is only the log.
 */

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

export function recordActivity(owner: string, item: ActivityItem) {
  try {
    const list = [item, ...listActivity(owner)].slice(0, MAX);
    globalThis.localStorage?.setItem(key(owner), JSON.stringify(list));
    window.dispatchEvent(new Event("pecun:activity-changed"));
  } catch {
    /* storage unavailable: the on-chain position still shows in the portfolio */
  }
}

/** The first number in a result line like "99.28 USDC" or "1,204.5 USD of GM". */
export const firstNumber = (s?: string) => {
  const m = s?.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

/** Net position units put in through Pecun (deposits minus withdrawals), or undefined when the log can't tell. */
export function netUnits(owner: string, vaultId: string): number | undefined {
  let net = 0;
  let any = false;
  for (const a of listActivity(owner)) {
    if (a.vault.id !== vaultId || a.status !== "done" || a.units === undefined) continue;
    any = true;
    net += a.side === "add" ? a.units : -a.units;
  }
  return any ? net : undefined;
}
