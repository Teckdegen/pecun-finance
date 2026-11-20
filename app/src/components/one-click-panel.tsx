"use client";

import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronsUpDown, Clock, Loader2, Plus, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { budgetLegs, feeBps, MAX_ROUTE_COST_PCT, oneClickFor, type Adapter, resetLegSlippage, routeCostPct, type Preview, type QueueState, type StepStatus } from "@/lib/exec";
import { firstNumber, recordActivity, slimVault } from "@/lib/activity";
import { rememberPending, runningVaults } from "@/lib/pending-withdrawals";
import type { Opportunity } from "@/lib/types";
import { daysText, lockupDays, newMoney, steadyApy, switchMove, type Payback } from "@/lib/payback";
import { readPositions, type Position } from "@/lib/positions";
import { getBalances, HOME_LOGO } from "@/lib/wallet";
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

  // Payback: what a deposit costs against what it earns, as new money or as a switch from a vault the user holds.
  const [held, setHeld] = useState<Position[] | null>(null);
  const [from, setFrom] = useState("");
  const [exitQ, setExitQ] = useState<{ key: string; pct?: number } | null>(null);
  useEffect(() => {
    if (!evmAddress || side !== "add" || held) return;
    readPositions(evmAddress, { address: evmAddress, solanaAddress, suiAddress }, signAccountsRequest)
      .then((r) => setHeld(r.filter((x) => x.o.id !== o.id && (x.usd ?? 0) > 0.5)))
      .catch(() => setHeld([]));
  }, [evmAddress, solanaAddress, suiAddress, side, held, o.id, signAccountsRequest]);
  const source = held?.find((x) => x.o.id === from) ?? null;
  const moveUsd = source ? Math.min(n, source.usd ?? 0) : n;
  const exitKey = `${from}:${moveUsd.toFixed(2)}`;
  useEffect(() => {
    if (!evmAddress || !source || !(moveUsd > 0)) return;
    const t = setTimeout(() => {
      const a: Adapter | null = oneClickFor(source.o as Opportunity);
      const units = Math.min(source.amount, (moveUsd / (source.usd ?? moveUsd)) * source.amount);
      if (!a) return setExitQ({ key: exitKey });
      a.previewWithdraw({ address: evmAddress, solanaAddress, suiAddress }, units.toFixed(8))
        .then((q) => setExitQ({ key: exitKey, pct: routeCostPct(q) }))
        .catch(() => setExitQ({ key: exitKey }));
    }, 500);
    return () => clearTimeout(t);
  }, [exitKey, evmAddress, solanaAddress, suiAddress, source, moveUsd]);
  const entryPct = cost === null ? null : cost + feeBps / 100;
  // Withdrawals carry no Pecun fee: leaving costs only the route.
  const exitPct = exitQ?.key === exitKey && exitQ.pct !== undefined ? exitQ.pct : null;
  const payback: Payback | null =
    side !== "add" || !(n > 0) || entryPct === null || tooCostly
      ? null
      : source
        ? exitPct === null
          ? null
          : switchMove(moveUsd, exitPct, entryPct, steadyApy(source.o), steadyApy(o), lockupDays((source.o as Opportunity).redemption))
        : newMoney(n, entryPct, steadyApy(o));

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
      }, signAccountsRequest);
      setAmount("");
      if (side === "withdraw" && adapter.queue) rememberPending(evmAddress, o);
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[pecun] one-click failed:", msg);
      recordActivity(evmAddress, { vault: slimVault(o), side, amount, error: msg, status: "failed", at: Date.now() }, signAccountsRequest);
      setRun((r) => (r ? { ...r, error: msg, steps: r.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)) } : r));
      void load();
    } finally {
      runningVaults.delete(o.id);
      resetLegSlippage();
    }
  };

  // The amount sheet: opened from the page card, the phone bar, or anywhere that fires pecun:open-deposit.
  const [open, setOpen] = useState(false);
  const openSheet = useCallback(
    (t: Side) => {
      if (!signedIn) return window.dispatchEvent(new Event("pecun:open-signin"));
      if (!busy && t !== side) (setSide(t), setAmount(""), setRun((r) => (r && (r.result || r.error) ? null : r)));
      setOpen(true);
    },
    [signedIn, busy, side],
  );
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ side?: Side; handled?: boolean }>).detail;
      if (d) d.handled = true;
      openSheet(d?.side ?? "add");
    };
    window.addEventListener("pecun:open-deposit", f);
    return () => window.removeEventListener("pecun:open-deposit", f);
  }, [openSheet]);
  const fmtPos = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v !== 0 && v < 1 ? 6 : 4 });
  // "You get": the vault token on a deposit, USDC on a withdrawal (no fee on withdrawals).
  const youGet = shown?.p ? Number(shown.p.out) : 0;
  const getSymbol = shown?.p?.outSymbol ?? (side === "add" ? symbol : "USDC");
  const closed = o.status && o.status !== "open";

  return (
    <aside id="deposit" className="scroll-mt-24 lg:sticky lg:top-20 lg:self-start">
      <div className="rounded-xl bg-card p-4">
        {signedIn && (
          <div className="mb-4">
            <p className="text-xs text-muted">Your position</p>
            <p className="tabular mt-1 text-2xl font-medium text-ink">
              {pos === null ? "—" : fmtPos(pos)} <span className="text-base text-muted">{symbol}</span>
            </p>
          </div>
        )}
        {queue && (queue.pending > 0 || queue.arrived > 0) && <PendingBox q={queue} />}
        {busy ? (
          <button type="button" onClick={() => setOpen(true)} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line text-[15px] font-medium hover:bg-card-2">
            <Loader2 className="size-4 animate-spin" /> {run!.side === "add" ? "Depositing…" : "Withdrawing…"}
          </button>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!!closed}
              onClick={() => openSheet("add")}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-medium text-on-accent hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-muted"
            >
              <ArrowDownToLine className="size-4" /> Deposit
            </button>
            <button
              type="button"
              onClick={() => openSheet("withdraw")}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white/10 text-[15px] font-medium text-ink hover:bg-white/15"
            >
              <ArrowUpFromLine className="size-4" /> Withdraw
            </button>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {signedIn ? "One click: Pecun moves, swaps and deposits for you, and brings it back as USDC when you withdraw." : "Sign in to deposit in one click."}
          {signedIn && !live && " Demo mode: connect Turnkey to run it for real."}
        </p>
      </div>

      <Sheet open={open && signedIn} onClose={() => setOpen(false)}>
        <div className="relative px-16 pt-6 pb-2 text-center">
          <button
            type="button"
            disabled={busy}
            onClick={() => (setSide(side === "add" ? "withdraw" : "add"), setAmount(""), setRun(null))}
            className="inline-flex items-center gap-1 text-2xl font-semibold text-ink disabled:opacity-100"
            aria-label={`Switch to ${side === "add" ? "withdraw" : "deposit"}`}
          >
            {side === "add" ? "Deposit" : "Withdraw"}
            {!busy && <ChevronsUpDown className="size-5 text-muted" />}
          </button>
          <p className="mt-1 truncate text-[15px] text-muted">
            {o.name} on {o.chain}
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute top-5 right-4 grid size-11 place-items-center rounded-full bg-white/10 text-ink hover:bg-white/15"
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5">
          {run ? (
            <RunView run={run} onRetry={() => void go()} onDone={() => (setRun(null), run.result && setOpen(false))} />
          ) : (
            <>
              <div className="flex flex-1 flex-col items-center justify-center py-8">
                <label className="flex max-w-full items-baseline justify-center gap-3 font-semibold tracking-tight">
                  <input
                    autoFocus
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    aria-label="Amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))}
                    style={{ width: `${Math.max(1, amount.length) - (amount.match(/[.,1]/g)?.length ?? 0) * 0.45 + 0.1}ch` }}
                    className={`tabular min-w-[1ch] bg-transparent text-right text-ink outline-none placeholder:text-faint ${amount.length > 9 ? "text-4xl" : amount.length > 6 ? "text-5xl" : "text-6xl sm:text-7xl"}`}
                  />
                  <span className={`shrink-0 ${n ? "text-ink" : "text-faint"} ${amount.length > 9 ? "text-4xl" : amount.length > 6 ? "text-5xl" : "text-6xl sm:text-7xl"}`}>
                    {side === "add" ? "USDC" : symbol}
                  </span>
                </label>
                <p className="mt-4 flex h-6 items-center gap-2 text-[17px] text-muted">
                  {n > 0 && !shown ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Finding the best route…
                    </>
                  ) : (
                    <>
                      You get {fmtPos(n > 0 ? youGet : 0)} {getSymbol}
                    </>
                  )}
                </p>
                <div className="mt-6 flex items-center gap-2">
                  <span className="flex h-12 items-center gap-2.5 rounded-full bg-white/[0.06] pr-5 pl-1.5 text-[15px]">
                    {side === "add" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={HOME_LOGO} alt="" className="size-9 rounded-full" />
                    ) : o.logoUrl || o.protocolLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.logoUrl || o.protocolLogo} alt="" className="size-9 rounded-full bg-white object-contain" />
                    ) : (
                      <span className="size-9 rounded-full bg-white/10" />
                    )}
                    <span className="text-muted">{side === "add" ? "Balance" : "In vault"}</span>
                    <span className="tabular text-ink">
                      {side === "add" ? (usdg ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtPos(pos ?? 0)} {side === "add" ? "USDC" : symbol}
                    </span>
                  </span>
                  <button type="button" onClick={() => setAmount(String(max))} className="h-11 rounded-full bg-white/[0.06] px-5 text-[15px] font-medium text-muted hover:text-ink">
                    Max
                  </button>
                </div>
                {side === "add" && (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent("pecun:open-wallet", { detail: { view: "receive" } }))}
                    className="mt-6 inline-flex h-12 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-5 text-[17px] font-semibold text-ink hover:bg-white/10"
                  >
                    <Plus className="size-5" /> Add USDC
                  </button>
                )}
                {n > max && <p className="mt-4 text-sm text-white">That&apos;s more than you have.</p>}
              </div>
              {side === "add" && n > 0 && !tooCostly && (
                <PaybackCard payback={payback} held={held} from={from} onFrom={setFrom} sourceName={source?.o.name} loading={!!source && exitPct === null} />
              )}
              {queue && (queue.pending > 0 || queue.arrived > 0) && <PendingBox q={queue} />}
              {n > 0 && shown && <Breakdown q={shown} side={side} amount={n} inSymbol={side === "add" ? "USDC" : symbol} />}
            </>
          )}
        </div>

        {!run && (
          <div className="px-5 pt-3" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
            <button
              type="button"
              onClick={() => void go()}
              disabled={!ok}
              className="flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-on-accent transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-accent/25 disabled:text-white/45"
            >
              {!n ? "Enter an amount" : n > max ? "Not enough balance" : tooCostly ? "Route costs too much right now" : side === "add" ? `Deposit ${n.toLocaleString("en-US")} USDC` : `Withdraw ${n.toLocaleString("en-US")} ${symbol}`}
            </button>
          </div>
        )}
      </Sheet>
    </aside>
  );
}

/** How long the deposit takes to earn back its cost: as new money, or as a switch from a vault the user holds. */
function PaybackCard({
  payback: p,
  held,
  from,
  onFrom,
  sourceName,
  loading,
}: {
  payback: Payback | null;
  held: Position[] | null;
  from: string;
  onFrom: (id: string) => void;
  sourceName?: string;
  loading: boolean;
}) {
  const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pc = (v: number) => `${(v * 100).toFixed(2)}%`;
  return (
    <div className="mt-2 rounded-2xl border border-line p-4">
      {!!held?.length && (
        <label className="mb-3 flex items-center justify-between gap-3 text-xs text-muted">
          <span className="shrink-0">Compare with</span>
          <select
            value={from}
            onChange={(e) => onFrom(e.target.value)}
            className="min-w-0 flex-1 truncate rounded-lg border border-line bg-bg px-2 py-1.5 text-right text-xs text-ink outline-none"
          >
            <option value="">New money</option>
            {held.map((h) => (
              <option key={h.o.id} value={h.o.id}>
                {h.o.name} · {pc(steadyApy(h.o))} · {money(h.usd ?? 0)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!p || loading ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Working out the payback…
        </p>
      ) : p.days === null ? (
        <>
          <p className="text-[17px] font-semibold text-ink">Doesn&apos;t pay back</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {p.kind === "switch"
              ? `This vault earns ${pc(Math.abs(p.gain))} a year less than ${sourceName}, so moving only costs you ${money(p.costUsd)}.`
              : "This vault isn't earning right now."}
          </p>
        </>
      ) : (
        <>
          <p className="text-[17px] font-semibold text-ink">
            Pays back in <span className="text-accent">{daysText(p.days)}</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {p.kind === "switch"
              ? `Moving from ${sourceName} costs ${money(p.costUsd)} and earns ${pc(p.gain)} a year more${p.lockDays > 0 ? `, including ${daysText(p.lockDays)} waiting to exit` : ""}.`
              : `Costs ${money(p.costUsd)} (${p.costPct.toFixed(2)}%), earned back at ${pc(p.apy)} APY.`}
          </p>
        </>
      )}
    </div>
  );
}

/** A panel that slides in from the right (from the bottom edge on phones), over a dimmed page. */
function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div onClick={onClose} className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`} />
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute inset-x-2 top-2 bottom-2 flex flex-col overflow-hidden rounded-[28px] border border-line bg-bg shadow-[0_24px_80px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:inset-x-auto sm:right-3 sm:top-3 sm:bottom-3 sm:w-[440px] ${
          shown ? "translate-x-0" : "translate-x-[calc(100%+24px)]"
        }`}
      >
        {children}
      </div>
    </div>,
    document.body,
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
  if (q.error || !q.p) return <p className="mt-3 break-words text-xs text-white">{q.error ?? "No route right now."}</p>;
  const p = q.p;
  if (routeCostPct(p) > MAX_ROUTE_COST_PCT)
    return (
      <p className="mt-3 rounded-xl border border-accent/30 bg-accent/[0.08] px-3 py-2 text-xs leading-relaxed text-white">
        Moving this amount would cost {routeCostPct(p).toFixed(2)}% in bridge and swap fees and price impact, above Pecun&apos;s {MAX_ROUTE_COST_PCT}% limit, so it won&apos;t run. Fixed
        fees weigh less on larger amounts: try a bigger amount, or try again later.
      </p>
    );
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 6 : 4 });
  const pct = feeBps / 100;
  const out = Number(p.out);
  const min = Number(p.minOut);
  // Deposit: the fee comes off the USDC before routing. Withdraw: it comes off the USDC that arrives back.
  // Pecun's fee is taken once, on the deposit. Withdrawals are free.
  const fee = side === "add" ? (amount * feeBps) / 10_000 : 0;
  const receive = out;
  // Worst case Pecun lets through: the whole route never costs more than MAX_ROUTE_COST_PCT (legs are sized to it).
  const floor = out * (1 - Math.max(0, MAX_ROUTE_COST_PCT - routeCostPct(p)) / 100);
  const worst = Math.max(Math.min(min, out), floor);
  const receiveMin = worst;
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
    ...(side === "withdraw" ? ([["Pecun fee", "None on withdrawals"]] as [string, string][]) : []),
  ];
  return (
    <div className="mt-3 rounded-xl border border-line px-3 py-2.5 text-xs">
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={k === "Price impact" && p.impactPct < -1 ? "text-white" : "text-ink"}>{v}</dd>
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
          <X className="size-5 shrink-0 text-accent" strokeWidth={3} />
        ) : (
          <Loader2 className="size-5 shrink-0 animate-spin text-muted" />
        )}
        <p className="text-[15px] font-medium">
          {run.result ? (run.side === "add" ? "Deposited" : "Withdrawn") : run.error ? "Didn't finish" : run.side === "add" ? "Depositing…" : "Withdrawing…"}
        </p>
      </div>
      {run.result && <p className="mt-3 text-sm text-muted">{run.side === "add" ? `${run.result} is now earning.` : `${run.result} is back in your wallet.`}</p>}
      {run.error && <p className="mt-3 break-words rounded-xl border border-accent/30 bg-accent/[0.08] px-3 py-2 text-sm text-white">{run.error}</p>}
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
