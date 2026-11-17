"use client";

import { Check, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { oneClickFor } from "@/lib/exec";
import { forgetPending, listPending, runningVaults } from "@/lib/pending-withdrawals";
import { useAuth } from "./auth-provider";

const EVERY = 5 * 60_000;
/** After a failed attempt, wait this long before trying that vault again. */
const BACKOFF = 30 * 60_000;

type Notice = { kind: "working" | "done" | "error"; text: string };

/**
 * Finishes queued withdrawals by itself. While the app is open (on load, then every 5 minutes) it checks each vault
 * the user has a pending withdrawal in; once the protocol has paid out, it brings the funds back to USDG with the
 * user's own session, like the second Withdraw press would, so there's nothing left to press.
 */
export function AutoWithdraw() {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const [notice, setNotice] = useState<Notice | null>(null);
  const failedAt = useRef(new Map<string, number>());
  const owner = auth.signedIn ? auth.evmAddress : undefined;

  useEffect(() => {
    if (!owner) return;
    let stopped = false;
    const tick = async () => {
      const a = authRef.current;
      if (!a.evmAddress) return;
      for (const o of listPending(a.evmAddress)) {
        if (stopped || runningVaults.has(o.id)) continue;
        if (Date.now() - (failedAt.current.get(o.id) ?? 0) < BACKOFF) continue;
        const adapter = oneClickFor(o);
        if (!adapter?.queue || !adapter.bringHome) {
          forgetPending(a.evmAddress, o.id);
          continue;
        }
        const who = { address: a.evmAddress, solanaAddress: a.solanaAddress, suiAddress: a.suiAddress };
        const q = await adapter.queue(who).catch(() => null);
        if (!q) continue;
        if (q.arrived <= 0) {
          if (q.pending <= 0) forgetPending(a.evmAddress, o.id); // nothing queued or waiting: done
          continue;
        }
        runningVaults.add(o.id);
        const amount = `${q.arrived.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${q.symbol}`;
        setNotice({ kind: "working", text: `${o.name ?? o.protocol} paid out ${amount}. Bringing it back to your wallet…` });
        try {
          const signer = {
            address: a.evmAddress,
            solanaAddress: a.solanaAddress,
            suiAddress: a.suiAddress,
            sendEvmTransaction: a.sendEvmTransaction,
            sendSolanaTransaction: a.sendSolanaTransaction,
            sendSuiTransaction: a.sendSuiTransaction,
            signEvmDigest: a.signEvmDigest,
            signAccountsRequest: a.signAccountsRequest,
          };
          const result = await adapter.bringHome(signer, () => {});
          if (result) setNotice({ kind: "done", text: `${result} from ${o.name ?? o.protocol} is back in your wallet.` });
          const left = await adapter.queue(who).catch(() => null);
          if (left && left.pending <= 0 && left.arrived <= 0) forgetPending(a.evmAddress, o.id);
          window.dispatchEvent(new Event("pecun:balances-changed"));
        } catch (e) {
          failedAt.current.set(o.id, Date.now());
          console.error("[pecun] auto-withdraw failed:", e);
          setNotice({ kind: "error", text: `Couldn't bring back the ${o.name ?? o.protocol} payout yet. Pecun will try again shortly, or press Withdraw on that vault.` });
        } finally {
          runningVaults.delete(o.id);
        }
      }
    };
    void tick();
    const t = setInterval(() => void tick(), EVERY);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [owner]);

  // Success and error notices fade after a while; the working one stays until it finishes.
  useEffect(() => {
    if (!notice || notice.kind === "working") return;
    const t = setTimeout(() => setNotice(null), 20_000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice || typeof document === "undefined") return null;
  return createPortal(
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm shadow-lg">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
        {notice.kind === "working" ? (
          <Loader2 className="size-4 animate-spin text-muted" />
        ) : notice.kind === "done" ? (
          <Check className="size-4 text-accent" strokeWidth={3} />
        ) : (
          <X className="size-4 text-red-300" strokeWidth={3} />
        )}
      </span>
      <p className="flex-1 leading-snug">{notice.text}</p>
      {notice.kind !== "working" && (
        <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-muted hover:text-ink">
          <X className="size-4" />
        </button>
      )}
    </div>,
    document.body,
  );
}
