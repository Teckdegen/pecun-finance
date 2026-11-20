"use client";

import { ArrowLeft, Clock, Info, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadActivity, netUnits, type ActivityItem, type ActivityVault, type SignRequest } from "@/lib/activity";
import { oneClickFor } from "@/lib/exec";
import { chainIdByName } from "@/lib/exec-chains";
import { listPending } from "@/lib/pending-withdrawals";
import type { Catalog, Opportunity } from "@/lib/types";
import { useAuth } from "./auth-provider";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const units = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 6 });
const pct = (a: number | null | undefined) => (a === null || a === undefined ? "—" : `${(a * 100).toFixed(2)}%`);

const STABLE = /^(USD|USDC|USDT|USDT0|USD₮0|DAI|USDS|USDE|GHO|PYUSD|USDG|FRXUSD|CRVUSD|USD0|AUSD|USD1|RLUSD|LUSD|FRAX|USDC\.E|USDBC)$/i;
const LIFI_CHAIN: Record<string, number> = { Solana: 1151111081099710, Sui: 9270000000000000 };
const prices = new Map<string, Promise<number | null>>();

/** USD per position unit: 1 for dollar-denominated positions and stablecoins, else LI.FI's open price by symbol. */
function usdPerUnit(chain: string, symbol: string): Promise<number | null> {
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

type Row = { o: Opportunity | ActivityVault; amount: number; symbol: string; usd: number | null; earned: number | null; earnedUsd: number | null };
const DEFI_KINDS = new Set(["Lending", "Liquid staking"]);

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

async function readRows(owner: string, who: { address: `0x${string}`; solanaAddress?: string; suiAddress?: string }, sign: SignRequest): Promise<Row[]> {
  const log = await loadActivity(owner, sign);
  const vaults = await findVaults(owner, log);
  const rows: Row[] = [];
  // A few at a time, so public RPCs don't rate-limit.
  for (let i = 0; i < vaults.length; i += 6) {
    const batch = await Promise.all(
      vaults.slice(i, i + 6).map(async (o): Promise<Row | null> => {
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
      setRows(await readRows(evmAddress, { address: evmAddress, solanaAddress, suiAddress }, signAccountsRequest));
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
