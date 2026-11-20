"use client";

import { ArrowLeft, Clock, Info, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadActivity, type ActivityItem } from "@/lib/activity";
import { listPending } from "@/lib/pending-withdrawals";
import { readPositions, type Position as Row } from "@/lib/positions";
import type { Opportunity } from "@/lib/types";
import { useAuth } from "./auth-provider";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const units = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 6 });
const pct = (a: number | null | undefined) => (a === null || a === undefined ? "—" : `${(a * 100).toFixed(2)}%`);

const DEFI_KINDS = new Set(["Lending", "Liquid staking"]);

/** Portfolio overview: the user's live positions across every chain, with value and estimated yield earned. */
export function PortfolioView() {
  const { signedIn, evmAddress, solanaAddress, suiAddress, signAccountsRequest } = useAuth();
  const [book, setBook] = useState<"vaults" | "defi">("vaults");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!evmAddress) return;
    setError(false);
    try {
      setRows(await readPositions(evmAddress, { address: evmAddress, solanaAddress, suiAddress }, signAccountsRequest));
    } catch (e) {
      console.error("[pecun] portfolio:", e);
      setError(true);
      setRows((r) => r ?? []);
    }
  }, [evmAddress, solanaAddress, suiAddress, signAccountsRequest]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const f = () => void load();
    window.addEventListener("pecun:balances-changed", f);
    window.addEventListener("pecun:activity-changed", f);
    return () => {
      window.removeEventListener("pecun:balances-changed", f);
      window.removeEventListener("pecun:activity-changed", f);
    };
  }, [load]);

  const split = useMemo(() => {
    const v = (rows ?? []).filter((r) => !DEFI_KINDS.has(r.o.kind));
    const d = (rows ?? []).filter((r) => DEFI_KINDS.has(r.o.kind));
    const sum = (l: Row[]) => l.reduce((t, r) => t + (r.usd ?? 0), 0);
    return { vaults: v, defi: d, vaultsUsd: sum(v), defiUsd: sum(d) };
  }, [rows]);
  const supplied = split.vaultsUsd + split.defiUsd;
  const earned = (rows ?? []).reduce((t, r) => t + (r.earnedUsd ?? 0), 0);
  const shown = book === "vaults" ? split.vaults : split.defi;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2rem]">Your Capital. At A Glance.</h1>
        <Link
          href="/portfolio/activity"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-line px-3.5 text-sm text-ink hover:bg-card"
        >
          <Clock className="size-4 text-muted" />
          Activity
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-5">
        <Money label="Supplied" value={usd(supplied)} />
        <Money label="Yield earned" value={usd(earned)} hint="Estimated from what you've put in through Pecun and what each position is worth now." />
        <Money label="Positions" value={rows ? String(rows.length) : "—"} />
      </div>

      <div role="tablist" aria-label="Holdings" className="mt-8 flex gap-6 border-b border-line">
        {(
          [
            ["vaults", "Vaults", split.vaultsUsd],
            ["defi", "Lending & staking", split.defiUsd],
          ] as const
        ).map(([id, label, amount]) => (
          <button
            key={id}
            role="tab"
            aria-selected={book === id}
            onClick={() => setBook(id)}
            className={`-mb-px border-b-2 pb-3 text-sm ${book === id ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label} <span className="tabular">{usd(amount)}</span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        <div className="grid grid-cols-[2fr_1fr_1fr_1.4fr] gap-2 px-3 text-xs text-muted sm:text-sm">
          {["Vault", "APY", "Yield earned", "Your position"].map((h) => (
            <div key={h} className="truncate py-2">
              {h}
            </div>
          ))}
        </div>
        {!signedIn ? (
          <Empty text="Sign in to see your positions." />
        ) : rows === null ? (
          <div className="mt-2 flex min-h-[180px] items-center justify-center gap-2 rounded-2xl bg-card text-sm text-muted sm:min-h-[320px]">
            <Loader2 className="size-4 animate-spin" /> Loading your positions…
          </div>
        ) : shown.length === 0 ? (
          <Empty text={error ? "Couldn't load your positions right now." : "No active positions yet."} />
        ) : (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl bg-card">
            {shown.map((r) => (
              <li key={r.o.id}>
                <Link href={r.o.slug ? `/earn/${r.o.slug}` : "/"} className="grid grid-cols-[2fr_1fr_1fr_1.4fr] items-center gap-2 px-3 py-3 text-sm hover:bg-card-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.o.protocolLogo && <img src={r.o.protocolLogo} alt="" className="size-7 shrink-0 rounded-full bg-white/10" />}
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{r.o.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {r.o.protocol} · {r.o.chain}
                      </span>
                    </span>
                  </span>
                  <span className="tabular text-ink">{pct(r.o.apy)}</span>
                  <span className="tabular text-accent">{r.earnedUsd !== null ? usd(r.earnedUsd) : r.earned !== null ? `${units(r.earned)} ${r.symbol}` : "—"}</span>
                  <span className="min-w-0">
                    <span className="tabular block truncate text-ink">{r.usd !== null ? usd(r.usd) : `${units(r.amount)} ${r.symbol}`}</span>
                    {r.usd !== null && r.symbol !== "USD" && !r.symbol.startsWith("USD of ") && (
                      <span className="tabular block truncate text-xs text-muted">
                        {units(r.amount)} {r.symbol}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const ACTIVITY = ["History", "Pending Withdrawals"] as const;
const ACTION: Record<ActivityItem["side"], string> = { add: "Deposit", withdraw: "Withdraw", send: "Sent", receive: "Received" };

/** Activity reached from the portfolio Activity button. */
export function ActivityView() {
  const { signedIn, evmAddress, signAccountsRequest } = useAuth();
  const [tab, setTab] = useState<(typeof ACTIVITY)[number]>("History");
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [pending, setPending] = useState<ReturnType<typeof listPending>>([]);

  useEffect(() => {
    if (!evmAddress) return;
    const f = () => {
      setPending(listPending(evmAddress));
      void loadActivity(evmAddress, signAccountsRequest).then((r) => setItems(r.items));
    };
    f();
    window.addEventListener("pecun:activity-changed", f);
    window.addEventListener("pecun:balances-changed", f);
    return () => {
      window.removeEventListener("pecun:activity-changed", f);
      window.removeEventListener("pecun:balances-changed", f);
    };
  }, [evmAddress, signAccountsRequest]);

  const date = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div>
      <Link href="/portfolio" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink">
        <span className="grid size-7 place-items-center rounded-full border border-line">
          <ArrowLeft className="size-3.5" />
        </span>
        Portfolio <span className="text-faint">&gt;</span> <span className="text-ink">Activity</span>
      </Link>
      <h1 className="mt-4 text-[1.7rem] font-medium tracking-[-0.03em] md:text-[2rem]">Activity</h1>

      <div role="tablist" aria-label="Activity" className="mt-6 flex gap-6 overflow-x-auto border-b border-line">
        {ACTIVITY.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`-mb-px shrink-0 border-b-2 pb-3 text-sm ${tab === name ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {name}
            {name === "Pending Withdrawals" && pending.length > 0 && <span className="ml-1.5 text-accent">{pending.length}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <div className="grid grid-cols-[1.2fr_2fr_1fr_1fr] gap-2 px-3 text-xs text-muted sm:text-sm">
          {["Action", "Vault", "Network", tab === "History" ? "Date" : "Status"].map((h) => (
            <div key={h} className="truncate py-2">
              {h}
            </div>
          ))}
        </div>
        {!signedIn ? (
          <Empty text="Sign in to see your activity." />
        ) : tab === "History" ? (
          items.length === 0 ? (
            <Empty text="No activity yet." />
          ) : (
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl bg-card">
              {items.map((a, i) => (
                <li key={`${a.at}-${i}`}>
                  <Link
                    href={a.txHash && (a.side === "send" || a.side === "receive") ? `https://basescan.org/tx/${a.txHash}` : a.vault.slug ? `/earn/${a.vault.slug}` : "/portfolio"}
                    target={a.txHash && (a.side === "send" || a.side === "receive") ? "_blank" : undefined}
                    className="grid grid-cols-[1.2fr_2fr_1fr_1fr] items-center gap-2 px-3 py-3 text-sm hover:bg-card-2"
                  >
                    <span className="min-w-0">
                      <span className={`block font-medium ${a.status === "failed" ? "text-white" : "text-ink"}`}>
                        {ACTION[a.side]}
                        {a.status === "failed" ? " · didn't finish" : ""}
                      </span>
                      <span className="tabular block truncate text-xs text-muted">
                        {a.status === "failed" ? "Nothing charged" : a.result ?? (a.side === "add" ? `${a.amount} USDC` : a.amount)}
                      </span>
                    </span>
                    <span className="min-w-0">
                      {a.side === "send" || a.side === "receive" ? (
                        <>
                          <span className="tabular block truncate text-ink">
                            {a.side === "send" ? "To " : "From "}
                            {a.counterparty ? `${a.counterparty.slice(0, 6)}…${a.counterparty.slice(-4)}` : "—"}
                          </span>
                          <span className="block truncate text-xs text-muted">{a.onchain ? "Found on chain" : "Wallet"}</span>
                        </>
                      ) : (
                        <>
                          <span className="block truncate text-ink">{a.vault.name}</span>
                          <span className="block truncate text-xs text-muted">{a.vault.protocol}</span>
                        </>
                      )}
                    </span>
                    <span className="truncate text-muted">{a.vault.chain}</span>
                    <span className="tabular truncate text-muted">{date(a.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : pending.length === 0 ? (
          <Empty text="No pending withdrawals." />
        ) : (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl bg-card">
            {pending.map((p) => (
              <li key={p.id} className="grid grid-cols-[1.2fr_2fr_1fr_1fr] items-center gap-2 px-3 py-3 text-sm">
                <span className="font-medium text-ink">Withdraw</span>
                <span className="min-w-0 truncate text-ink">{p.name ?? p.protocol}</span>
                <span className="truncate text-muted">{p.chain}</span>
                <span className="truncate text-muted">{p.redemption ?? "In the queue"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="mt-2 flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl bg-card text-center sm:min-h-[320px]">
      <p className="text-sm text-muted">{text}</p>
      <Link href="/?earn=vaults" className="inline-flex h-9 items-center rounded-full border border-line px-4 text-sm font-medium text-accent hover:border-accent">
        Explore Vaults
      </Link>
    </div>
  );
}

function Money({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-sm text-muted">
        {label}
        {hint && (
          <span title={hint} className="text-faint">
            <Info className="size-3.5" />
          </span>
        )}
      </div>
      <div className="tabular mt-1 text-lg font-medium tracking-[-0.02em]">{value}</div>
    </div>
  );
}
