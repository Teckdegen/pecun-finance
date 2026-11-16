"use client";

import { Check, Loader2, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { DEPOSIT_STEPS, depositBaseVault, feeBps, vaultInfo, vaultPosition, WITHDRAW_STEPS, withdrawBaseVault, type StepStatus } from "@/lib/execute";
import type { Opportunity } from "@/lib/types";
import { getBalances } from "@/lib/wallet";
import { useAuth } from "./auth-provider";

type Side = "add" | "withdraw";
type Run = { side: Side; steps: { id: string; label: string; status: StepStatus; detail?: string }[]; error?: string; result?: string };

/**
 * One-click Add / Withdraw for a Base ERC-4626 vault. One press runs every step (fee, bridge + swap, gas, deposit or
 * withdrawal) in the background with the user's own session; there's nothing to approve along the way.
 */
export function OneClickPanel({ o }: { o: Opportunity }) {
  const { signedIn, live, evmAddress, sendEvmTransaction, signAccountsRequest } = useAuth();
  const vault = o.ref!.id as Address;
  const [side, setSide] = useState<Side>("add");
  const [amount, setAmount] = useState("");
  const [usdg, setUsdg] = useState<number | null>(null);
  const [pos, setPos] = useState<{ assets: number; symbol: string; decimals: number } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const busy = !!run && !run.error && !run.result;

  const load = useCallback(async () => {
    if (!evmAddress) return;
    const [b, info, p] = await Promise.all([
      getBalances(evmAddress).catch(() => null),
      vaultInfo(vault).catch(() => null),
      vaultPosition(vault, evmAddress).catch(() => null),
    ]);
    if (b) setUsdg(b.usdg);
    if (info && p) setPos({ assets: Number(formatUnits(p.assets, info.decimals)), symbol: info.symbol, decimals: info.decimals });
  }, [evmAddress, vault]);
  useEffect(() => void load(), [load]);

  const n = Number(amount) || 0;
  const max = side === "add" ? usdg ?? 0 : pos?.assets ?? 0;
  const ok = n > 0 && n <= max;

  const go = async () => {
    if (!evmAddress || (!ok && side === "add")) return;
    const template = side === "add" ? DEPOSIT_STEPS : WITHDRAW_STEPS;
    setRun({ side, steps: template.map((s) => ({ ...s, status: "pending" })) });
    const on = (id: string, status: StepStatus, detail?: string) =>
      setRun((r) => (r ? { ...r, steps: r.steps.map((s) => (s.id === id ? { ...s, status, detail: detail ?? s.detail } : s)) } : r));
    const signer = { address: evmAddress, sendEvmTransaction, signAccountsRequest };
    try {
      const result =
        side === "add"
          ? await depositBaseVault(signer, vault, amount, on)
          : await withdrawBaseVault(signer, vault, n >= (pos?.assets ?? 0) - 1e-9 ? "max" : amount, on);
      setRun((r) => (r ? { ...r, result } : r));
      setAmount("");
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[pecun] one-click failed:", msg);
      setRun((r) => (r ? { ...r, error: msg, steps: r.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)) } : r));
      void load();
    }
  };

  return (
    <aside id="deposit" className="scroll-mt-24 lg:sticky lg:top-20 lg:self-start">
      <div className="rounded-xl bg-card p-4">
        <div className="flex rounded-full bg-card-2 p-0.5 text-sm" style={{ width: "fit-content" }}>
          {(["add", "withdraw"] as const).map((t) => (
            <button
              key={t}
              disabled={busy}
              onClick={() => (setSide(t), setAmount(""), setRun(null))}
              className={`h-8 rounded-full px-4 capitalize ${side === t ? "bg-white/15 font-medium text-ink" : "text-muted"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {!signedIn ? (
          <div className="mt-4 text-sm text-muted">
            Sign in to add to this vault in one click.
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("pecun:open-signin"))}
              className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-accent text-[15px] font-medium text-on-accent hover:bg-accent-deep"
            >
              Sign up / Sign in
            </button>
          </div>
        ) : run ? (
          <RunView run={run} onRetry={() => void go()} onDone={() => setRun(null)} />
        ) : (
          <>
            <div className="mt-3 rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{side === "add" ? "Add" : "Withdraw"}</span>
                <button type="button" onClick={() => setAmount(String(max))} className="hover:text-ink">
                  {side === "add" ? `Wallet: ${(usdg ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDG` : `In vault: ${(pos?.assets ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${pos?.symbol ?? o.asset}`}
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))}
                  className="w-1/2 bg-transparent text-3xl text-ink outline-none placeholder:text-faint"
                />
                <span className="text-base font-medium">{side === "add" ? "USDG" : pos?.symbol ?? o.asset}</span>
              </div>
            </div>
            {n > max && <p className="mt-2 text-xs text-red-300">That&apos;s more than you have.</p>}
            <button
              type="button"
              onClick={() => void go()}
              disabled={!ok}
              className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-accent text-[15px] font-medium text-on-accent transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-muted"
            >
              {!n ? "Enter an amount" : side === "add" ? `Add ${n.toLocaleString("en-US")} USDG` : `Withdraw ${n.toLocaleString("en-US")} ${pos?.symbol ?? ""}`}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              One click: {side === "add" ? "moves your USDG to Base and deposits it" : "withdraws and returns USDG to your wallet"}. Network fees are covered by Pecun
              {feeBps ? `; Pecun's fee is ${(feeBps / 100).toFixed(2)}%` : ""}.
              {!live && " Demo mode: connect Turnkey to run it for real."}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

function RunView({ run, onRetry, onDone }: { run: Run; onRetry: () => void; onDone: () => void }) {
  return (
    <div className="mt-4" role="status" aria-live="polite">
      <p className="text-[15px] font-medium">
        {run.result ? (run.side === "add" ? "Added" : "Withdrawn") : run.error ? "Didn't finish" : run.side === "add" ? "Adding…" : "Withdrawing…"}
      </p>
      <ul className="mt-3 space-y-2">
        {run.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
            <span className="grid size-5 shrink-0 place-items-center">
              {s.status === "done" ? (
                <Check className="size-4 text-accent" strokeWidth={3} />
              ) : s.status === "running" ? (
                <Loader2 className="size-4 animate-spin text-muted" />
              ) : s.status === "failed" ? (
                <X className="size-4 text-red-300" strokeWidth={3} />
              ) : (
                <span className={`size-1.5 rounded-full ${s.status === "skipped" ? "bg-transparent" : "bg-white/25"}`} />
              )}
            </span>
            <span className={`flex-1 ${s.status === "skipped" ? "text-faint line-through" : ""}`}>{s.label}</span>
            {s.detail && <span className="text-xs text-muted">{s.detail}</span>}
          </li>
        ))}
      </ul>
      {run.result && <p className="mt-3 text-sm text-muted">{run.side === "add" ? `${run.result} is now earning.` : `${run.result} is back in your wallet.`}</p>}
      {run.error && <p className="mt-3 break-words rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-white/85">{run.error}</p>}
      {(run.result || run.error) && (
        <div className="mt-3 flex gap-2">
          {run.error && (
            <button type="button" onClick={onRetry} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-medium text-on-accent hover:bg-accent-deep">
              <RotateCw className="size-4" /> Try again
            </button>
          )}
          <button type="button" onClick={onDone} className="flex h-11 flex-1 items-center justify-center rounded-xl border border-line text-sm font-medium hover:bg-card-2">
            {run.result ? "Done" : "Back"}
          </button>
        </div>
      )}
    </div>
  );
}
