"use client";

import { formatUnits, parseUnits } from "viem";
import { OUT_STEPS, type Step } from "../execute";

/**
 * Shared bits for vaults whose withdrawals are queued (Ember, Upshift): the user asks to withdraw, the protocol's
 * operator pays the assets into the user's wallet on the vault's chain once the queue clears (days later), and a
 * later press of Withdraw brings what was paid out back to USDG.
 *
 * Paid-out funds sit in the user's own wallet as a plain token, which the chain can't tie back to the vault, so we keep
 * a note per vault and wallet of how much was requested and not yet brought home. The note is only a convenience
 * (it caps what counts as "paid out" for this vault); the funds are the user's either way.
 */

type Note = { requested: string; at: number };
const key = (vault: string, owner: string) => `pecun:queued:${vault.toLowerCase()}:${owner.toLowerCase()}`;

function read(vault: string, owner: string): Note | null {
  try {
    const raw = globalThis.localStorage?.getItem(key(vault, owner));
    return raw ? (JSON.parse(raw) as Note) : null;
  } catch {
    return null;
  }
}

/** How much (raw asset units) was requested from this vault and not yet brought home. */
export const requestedNotHome = (vault: string, owner: string) => BigInt(read(vault, owner)?.requested ?? "0");

export function noteRequested(vault: string, owner: string, amount: bigint) {
  try {
    const total = requestedNotHome(vault, owner) + amount;
    globalThis.localStorage?.setItem(key(vault, owner), JSON.stringify({ requested: total.toString(), at: Date.now() } satisfies Note));
  } catch {
    /* storage unavailable: the payout still lands in the user's wallet */
  }
}

export function noteBroughtHome(vault: string, owner: string, amount: bigint) {
  try {
    const left = requestedNotHome(vault, owner) - amount;
    if (left > BigInt(0)) globalThis.localStorage?.setItem(key(vault, owner), JSON.stringify({ requested: left.toString(), at: Date.now() } satisfies Note));
    else globalThis.localStorage?.removeItem(key(vault, owner));
  } catch {
    /* ignore */
  }
}

/**
 * Paid-out funds for this vault that are waiting in the wallet: the wallet's balance of the asset, capped by what was
 * requested and is no longer pending in the queue (plus 2% for yield earned while queued).
 */
export function arrivedFor(vault: string, owner: string, idle: bigint, pendingValue: bigint): bigint {
  const open = requestedNotHome(vault, owner) - pendingValue;
  if (open <= BigInt(0) || idle <= BigInt(0)) return BigInt(0);
  const cap = (open * BigInt(102)) / BigInt(100);
  return idle < cap ? idle : cap;
}

export const queuedSteps = (protocol: string, wait: string): Step[] => [
  { id: "withdraw", label: `Request withdrawal (${protocol} pays out${wait ? ` in ${wait}` : " after its queue"})` },
  { id: "bridge", label: "Bring paid-out funds back" },
  OUT_STEPS[2],
];

export const waitLabel = (seconds: bigint | number) => {
  const d = Math.ceil(Number(seconds) / 86_400);
  return d <= 0 ? "about a day" : d === 1 ? "about 1 day" : `about ${d} days`;
};

/** The catalog's redemption text ("3 days", "2 Weeks", "Monthly") as a short wait, or "". */
export function catalogWait(o: unknown): string {
  const r = (o as { redemption?: string } | null)?.redemption?.trim();
  if (!r || /^instant$/i.test(r)) return "";
  return /^(monthly|quarterly)$/i.test(r) ? `up to a ${r === "Monthly" ? "month" : "quarter"}` : `up to ${r.replace(/^up to /i, "").toLowerCase()}`;
}

export const requestedMessage = (amount: bigint, decimals: number, symbol: string, protocol: string, wait: string, where: string) =>
  `Withdrawal of ${formatUnits(amount, decimals)} ${symbol} requested. ${protocol} pays it into your Pecun wallet on ${where}${wait ? ` in ${wait}` : " once its queue clears"}; press Withdraw again then to bring it back as USDG.`;

/** What the user asked for, in raw units ("max" = everything). */
export const wanted = (amount: string | "max", decimals: number, everything: bigint) => (amount === "max" ? everything : parseUnits(amount, decimals));
