"use client";

import type { Opp } from "./execute";

/**
 * Withdrawals waiting in a protocol's queue (Ember, Upshift), remembered per user on this device so Pecun can bring the
 * payout back to USDG by itself once the protocol pays it out, without the user pressing anything.
 */

const key = (owner: string) => `pecun:pending-withdrawals:${owner.toLowerCase()}`;

/** Only the fields adapters need, so the list stays small. */
function slim(o: Opp & { redemption?: string }): Opp & { redemption?: string } {
  const { id, chain, protocol, asset, name, kind, ticker, address, ref, redemption } = o;
  return { id, chain, protocol, asset, name, kind, ticker, address, ref, redemption };
}

export function listPending(owner: string): (Opp & { redemption?: string })[] {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key(owner)) ?? "[]");
  } catch {
    return [];
  }
}

function save(owner: string, list: Opp[]) {
  try {
    if (list.length) globalThis.localStorage?.setItem(key(owner), JSON.stringify(list));
    else globalThis.localStorage?.removeItem(key(owner));
  } catch {
    /* storage unavailable: the user can still press Withdraw to bring it back */
  }
}

export function rememberPending(owner: string, o: Opp & { redemption?: string }) {
  const list = listPending(owner).filter((x) => x.id !== o.id);
  save(owner, [...list, slim(o)]);
}

export function forgetPending(owner: string, id: string) {
  save(
    owner,
    listPending(owner).filter((x) => x.id !== id),
  );
}

/** Vaults with a run in progress in this tab (a manual press or the background check), so the two never overlap. */
export const runningVaults = new Set<string>();
