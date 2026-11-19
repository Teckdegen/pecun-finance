"use client";

import { Check, Clock, Loader2, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { budgetLegs, feeBps, MAX_ROUTE_COST_PCT, oneClickFor, resetLegSlippage, routeCostPct, type Preview, type QueueState, type StepStatus } from "@/lib/exec";
import { firstNumber, recordActivity, slimVault } from "@/lib/activity";
import { rememberPending, runningVaults } from "@/lib/pending-withdrawals";
import type { Opportunity } from "@/lib/types";
import { getBalances } from "@/lib/wallet";
import { useAuth } from "./auth-provider";

type Side = "add" | "withdraw";
type Run = { side: Side; steps: { id: string; label: string; status: StepStatus; detail?: string }[]; error?: string; result?: string };

/**
 * One-click Add / Withdraw. One press runs every step (fee, bridge + swap, gas, deposit or withdrawal) in the background
 * with the user's own session; there's nothing to approve along the way. Before pressing, the user sees the expected
 * amount, the minimum after slippage, price impact, fees and time.
 */
export function OneClickPanel({ o }: { o: Opportunity }) {
  const { signedIn, live, evmAddress, solanaAddress, sendEvmTransaction, sendSolanaTransaction, signEvmDigest, suiAddress, sendSuiTransaction, signAccountsRequest } = useAuth();
  const adapter = useMemo(() => oneClickFor(o)!, [o]);
  const [side, setSide] = useState<Side>("add");
  const [amount, setAmount] = useState("");
  const [usdg, setUsdg] = useState<number | null>(null);
  const [pos, setPos] = useState<number | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [preview, setPreview] = useState<{ key: string; p?: Preview; error?: string } | null>(null);
  const busy = !!run && !run.error && !run.result;
  const symbol = adapter.positionSymbol;

  const load = useCallback(async () => {
    if (!evmAddress) return;
    const who = { address: evmAddress, solanaAddress, suiAddress };
    const [b, p, q] = await Promise.all([
      getBalances(evmAddress).catch(() => null),
      adapter.position(who).catch(() => null),
      adapter.queue ? adapter.queue(who).catch(() => null) : Promise.resolve(null),
    ]);
    if (b) setUsdg(b.usdg);
    if (p !== null) setPos(p);
    setQueue(q);
    // A withdrawal still in the queue (or paid out) is remembered so Pecun finishes it in the background.
    if (q && (q.pending > 0 || q.arrived > 0)) rememberPending(evmAddress, o);
  }, [evmAddress, solanaAddress, suiAddress, adapter, o]);
  useEffect(() => void load(), [load]);
  // The background check brings payouts home on its own; refresh when it does.
  useEffect(() => {
    const f = () => void load();
    window.addEventListener("pecun:balances-changed", f);
    return () => window.removeEventListener("pecun:balances-changed", f);
  }, [load]);

  const n = Number(amount) || 0;
  const max = side === "add" ? usdg ?? 0 : pos ?? 0;

  // Live quote, debounced while typing.
  const key = `${side}:${amount}`;
  useEffect(() => {
    if (!evmAddress || !(n > 0) || run) return;
    const t = setTimeout(() => {
      const who = { address: evmAddress, solanaAddress, suiAddress };
      (side === "add" ? adapter.previewDeposit(who, amount) : adapter.previewWithdraw(who, amount))
        .then((p) => setPreview({ key, p }))
        .catch((e) => setPreview({ key, error: e instanceof Error ? e.message : String(e) }));
    }, 500);
    return () => clearTimeout(t);
  }, [key, n, side, amount, evmAddress, solanaAddress, suiAddress, adapter, run]);
  const shown = preview?.key === key ? preview : null;
  // Only run on a fresh quote whose whole route costs at most MAX_ROUTE_COST_PCT.
  const cost = shown?.p ? routeCostPct(shown.p) : null;
  const tooCostly = cost !== null && cost > MAX_ROUTE_COST_PCT;
  const ok = n > 0 && n <= max && !!shown?.p && !tooCostly;

  const go = async () => {
    if (!evmAddress || !ok) return;
    if (runningVaults.has(o.id)) {
      setRun({ side, steps: [], error: "Pecun is bringing this vault's payout back to your wallet right now. Try again in a minute." });
      return;
    }
    runningVaults.add(o.id);
    // Size every leg's slippage so even the worst fill keeps the whole route within the limit.
    budgetLegs(shown!.p!);
    const template = side === "add" ? adapter.depositSteps : adapter.withdrawSteps;
    setRun({ side, steps: template.map((s) => ({ ...s, status: "pending" })) });
    const on = (id: string, status: StepStatus, detail?: string) =>
      setRun((r) => (r ? { ...r, steps: r.steps.map((s) => (s.id === id ? { ...s, status, detail: detail ?? s.detail } : s)) } : r));
    const signer = { address: evmAddress, solanaAddress, sendEvmTransaction, sendSolanaTransaction, signEvmDigest, suiAddress, sendSuiTransaction, signAccountsRequest };
    try {
      const result =
        side === "add" ? await adapter.deposit(signer, amount, on) : await adapter.withdraw(signer, n >= (pos ?? 0) - 1e-9 ? "max" : amount, on);
      setRun((r) => (r ? { ...r, result } : r));
      const all = side === "withdraw" && n >= (pos ?? 0) - 1e-9;
      recordActivity(evmAddress, {
        vault: slimVault(o),
        side,
        amount: side === "withdraw" && all ? "max" : amount,
        // Position units moved: what arrived in the vault, or what was taken out of it.
        units: side === "add" ? firstNumber(result) : all ? pos ?? n : n,
        result,
        status: "done",
        at: Date.now(),
      });
      setAmount("");
      if (side === "withdraw" && adapter.queue) rememberPending(evmAddress, o);
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[pecun] one-click failed:", msg);
      recordActivity(evmAddress, { vault: slimVault(o), side, amount, error: msg, status: "failed", at: Date.now() });
      setRun((r) => (r ? { ...r, error: msg, steps: r.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)) } : r));
      void load();
    } finally {
      runningVaults.delete(o.id);
      resetLegSlippage();
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
            {queue && (queue.pending > 0 || queue.arrived > 0) && <PendingBox q={queue} />}
            <div className="mt-3 rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{side === "add" ? "Add" : "Withdraw"}</span>
                <button type="button" onClick={() => setAmount(String(max))} className="hover:text-ink">
                  {side === "add" ? `Wallet: ${(usdg ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC` : `In vault: ${(pos ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${symbol}`}
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
                <span className="text-base font-medium">{side === "add" ? "USDC" : symbol}</span>
              </div>
            </div>
            {n > max && <p className="mt-2 text-xs text-red-300">That&apos;s more than you have.</p>}
            <button
              type="button"
              onClick={() => void go()}
              disabled={!ok}
              className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-accent text-[15px] font-medium text-on-accent transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-muted"
            >
              {!n ? "Enter an amount" : tooCostly ? "Route costs too much right now" : side === "add" ? `Add ${n.toLocaleString("en-US")} USDC` : `Withdraw ${n.toLocaleString("en-US")} ${symbol}`}
            </button>
            {n > 0 && <Breakdown q={shown} side={side} amount={n} inSymbol={side === "add" ? "USDC" : symbol} />}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              One click: {side === "add" ? `swaps your USDC into ${symbol} and deposits it` : "withdraws and returns USDC to your wallet"}.
              {!live && " Demo mode: connect Turnkey to run it for real."}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * What the user gets, before pressing anything: the platform fee (taken in USDC on Base and sent straight
 * to Pecun's fee wallet), bridge and swap fees, price impact and slippage, then the amount received.
 */
function Breakdown({ q, side, amount, inSymbol }: { q: { p?: Preview; error?: string } | null; side: "add" | "withdraw"; amount: number; inSymbol: string }) {
  if (!q)
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" /> Finding the best route…
      </p>
    );
  if (q.error || !q.p) return <p className="mt-3 break-words text-xs text-red-300">{q.error ?? "No route right now."}</p>;
  const p = q.p;
  if (routeCostPct(p) > MAX_ROUTE_COST_PCT)
    return (
      <p className="mt-3 rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-white/85">
        Moving this amount would cost {routeCostPct(p).toFixed(2)}% in bridge and swap fees and price impact, above Pecun&apos;s {MAX_ROUTE_COST_PCT}% limit, so it won&apos;t run. Fixed
        fees weigh less on larger amounts: try a bigger amount, or try again later.
      </p>
    );
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 6 : 4 });
  const pct = feeBps / 100;
  const out = Number(p.out);
  const min = Number(p.minOut);
  // Deposit: the fee comes off the USDC before routing. Withdraw: it comes off the USDC that arrives back.
  const fee = side === "add" ? (amount * feeBps) / 10_000 : (out * feeBps) / 10_000;
  const receive = side === "add" ? out : out - fee;
  // Worst case Pecun lets through: the whole route never costs more than MAX_ROUTE_COST_PCT (legs are sized to it).
  const floor = out * (1 - Math.max(0, MAX_ROUTE_COST_PCT - routeCostPct(p)) / 100);
  const worst = Math.max(Math.min(min, out), floor);
  const receiveMin = side === "add" ? worst : worst - (worst * feeBps) / 10_000;
  const feeRow: [string, string] = [`Platform fee (${pct}%)`, `−${fmt(fee)} USDC`];
  const cost = routeCostPct(p);
  const route: [string, string][] = [
    ["Bridge & swap fees", `≈ $${p.feesUsd.toFixed(2)}`],
    ...(side === "add" && p.gasReserveUsd ? ([["Kept in the chain's own coin, for transactions", `≈ $${p.gasReserveUsd.toFixed(2)}`]] as [string, string][]) : []),
    ["Price impact", `${p.impactPct.toFixed(2)}%`],
    ["Total route cost", `${cost.toFixed(2)}% (limit ${MAX_ROUTE_COST_PCT}%)`],
    ["Time", p.seconds ? `~${p.seconds < 60 ? `${p.seconds}s` : `${Math.round(p.seconds / 60)} min`}` : "Under a minute"],
  ];
  const rows: [string, string][] = [
    [side === "add" ? "You pay" : "You withdraw", `${fmt(amount)} ${inSymbol}`],
    ...(side === "add" && feeBps ? [feeRow] : []),
    ...route,
    ...(side === "withdraw" && feeBps ? [feeRow] : []),
  ];
  return (
    <div className="mt-3 rounded-xl border border-line px-3 py-2.5 text-xs">
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={k === "Price impact" && p.impactPct < -1 ? "text-red-300" : "text-ink"}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 space-y-1.5 border-t border-line pt-2">
        <div className="flex justify-between gap-3 text-[13px]">
          <span className="text-muted">You receive</span>
          <span className="font-medium text-accent">
            {fmt(receive)} {p.outSymbol}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Minimum (worst case)</span>
          <span className="text-ink">
            {fmt(receiveMin)} {p.outSymbol}
          </span>
        </div>
      </div>
    </div>
  );
}

/** A withdrawal waiting in the protocol's queue, and what happens next (nothing for the user to do). */
function PendingBox({ q }: { q: QueueState }) {
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 6 : 4 });
  const since = q.requestedAt ? new Date(q.requestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return (
    <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5 text-xs" role="status">
      {q.pending > 0 && (
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 size-3.5 shrink-0 text-accent" />
          <p className="leading-relaxed">
            <span className="font-medium text-ink">
              Withdrawal pending: {fmt(q.pending)} {q.symbol}
            </span>
            <span className="text-muted">
              {since ? ` · requested ${since}` : ""}
              {q.wait ? ` · pays out in ${q.wait}` : " · pays out once the queue clears"}. Pecun brings it back to your wallet as USDC automatically while the app is open.
            </span>
          </p>
        </div>
      )}
      {q.arrived > 0 && (
        <div className={`flex items-start gap-2 ${q.pending > 0 ? "mt-2" : ""}`}>
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent" />
          <p className="leading-relaxed">
            <span className="font-medium text-ink">
              Paid out: {fmt(q.arrived)} {q.symbol}
            </span>
            <span className="text-muted"> · bringing it back to your wallet as USDC.</span>
          </p>
        </div>
      )}
    </div>
  );
}

function RunView({ run, onRetry, onDone }: { run: Run; onRetry: () => void; onDone: () => void }) {
  return (
    <div className="mt-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-xl border border-line px-4 py-3.5">
        {run.result ? (
          <Check className="size-5 shrink-0 text-accent" strokeWidth={3} />
        ) : run.error ? (
          <X className="size-5 shrink-0 text-red-300" strokeWidth={3} />
        ) : (
          <Loader2 className="size-5 shrink-0 animate-spin text-muted" />
        )}
        <p className="text-[15px] font-medium">
          {run.result ? (run.side === "add" ? "Deposited" : "Withdrawn") : run.error ? "Didn't finish" : run.side === "add" ? "Depositing…" : "Withdrawing…"}
        </p>
      </div>
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
