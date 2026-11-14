"use client";

import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import type { AllocationRow, History, Opportunity } from "@/lib/types.ts";
import { LineChart } from "./line-chart";
import { AddressPill, ChainIcon, Logo, pct, usd } from "./ui";

/**
 * Morpho vault layout, modelled on Morpho's own vault page:
 * header chips → key numbers → Overview (config, deposits, APY) → Allocation → Performance (unit price, returns, fees) → Risk (roles, allocators, timelocks).
 * Every block renders only when Morpho's API returned data for it.
 */

type Win = "7d" | "30d" | "90d";
const DAYS: Record<Win, number> = { "7d": 7, "30d": 30, "90d": 90 };
const cut = (s: [number, number][] | undefined, w: Win) => {
  if (!s?.length) return [];
  const from = s[s.length - 1][0] - DAYS[w] * 86_400_000;
  return s.filter(([t]) => t >= from);
};
/** One point per calendar day (the day's last reading) so mixed hourly/daily history is weighted evenly. */
const daily = (s: [number, number][]) => {
  const m = new Map<string, [number, number]>();
  for (const p of s) m.set(new Date(p[0]).toDateString(), p);
  return [...m.values()];
};
/** 7D shows every hourly point; 30D/90D show one point per day plus the latest reading. */
const view = (s: [number, number][] | undefined, w: Win) => {
  const c = cut(s, w);
  if (w === "7d" || c.length < 2) return c;
  const d = daily(c);
  return d[d.length - 1] === c[c.length - 1] ? d : [...d, c[c.length - 1]];
};
const avg = (s: [number, number][]) => (s.length ? s.reduce((a, p) => a + p[1], 0) / s.length : null);
const winAvg = (s: [number, number][] | undefined, w: Win) => avg(daily(cut(s, w)));
/** Axis money labels without trailing zeros ($530M, $532.5M). */
const usdAxis = (v: number) => usd(v).replace(/\.0+(?=[A-Z]?$)/, "").replace(/(\.\d*?)0+(?=[A-Z]?$)/, "$1");
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function duration(sec: number) {
  if (sec >= 86_400) return `${Math.round(sec / 86_400)} days`;
  if (sec >= 3600) return `${Math.round(sec / 3600)} hours`;
  return `${Math.round(sec / 60)} minutes`;
}

export function MorphoLayout({ o, history, loading }: { o: Opportunity; history: History; loading: boolean }) {
  const p = history.profile;
  const [depWin, setDepWin] = useState<Win>("7d");
  const [apyWin, setApyWin] = useState<Win>("7d");
  const [spWin, setSpWin] = useState<Win>("7d");
  const [allocTab, setAllocTab] = useState<"markets" | "collateral">("markets");

  const [depHover, setDepHover] = useState<[number, number] | null>(null);
  const [apyHover, setApyHover] = useState<[number, number] | null>(null);
  const [spHover, setSpHover] = useState<[number, number] | null>(null);

  const depSeries = useMemo(() => view(history.tvl, depWin), [history.tvl, depWin]);
  const apySeries = useMemo(() => view(history.apy, apyWin), [history.apy, apyWin]);
  const spSeries = useMemo(() => view(history.sharePrice, spWin), [history.sharePrice, spWin]);
  const change = (s: [number, number][]) => (s.length > 1 && s[0][1] ? s[s.length - 1][1] / s[0][1] - 1 : null);
  const spChange = change(spSeries);
  const depChange = change(depSeries);

  const parts = p?.apy;
  const netApy = parts?.net ?? o.apy;
  const apyAvg = winAvg(history.apy, apyWin);
  const returns = [
    { label: "Instant APY", value: netApy },
    { label: "7D APY", value: winAvg(history.apy, "7d") },
    { label: "30D APY", value: winAvg(history.apy, "30d") ?? o.apy30d },
    { label: "90D APY", value: winAvg(history.apy, "90d") },
  ].filter((r) => r.value !== null && r.value !== undefined);
  const breakdown = parts?.native !== undefined
    ? [
        { label: "Native APY", value: pct(parts.native) },
        ...(parts.rewards ?? []).map((r) => ({ label: `${r.symbol} rewards`, value: `+${pct(r.apr)}`, logo: r.logo, tone: "pos" as const })),
        ...(parts.performanceFee ? [{ label: `Performance fee (${fmtFeePct(parts.performanceFee)})`, value: `-${pct(parts.native * parts.performanceFee)}`, tone: "neg" as const }] : []),
        ...(parts.managementFee ? [{ label: `Management fee (${fmtFeePct(parts.managementFee)})`, value: `-${pct(parts.managementFee)}`, tone: "neg" as const }] : []),
      ]
    : [{ label: "Native APY", value: pct(o.apy) }];

  const alloc = p?.allocation ?? [];
  const collaterals = useMemo(() => {
    const m = new Map<string, { symbol: string; logo?: string; usd: number }>();
    for (const a of alloc) {
      const k = a.collateral?.symbol ?? "Idle";
      const e = m.get(k) ?? { symbol: k, logo: a.collateral?.logo, usd: 0 };
      e.usd += a.allocationUsd;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.usd - a.usd);
  }, [alloc]);
  const exposure = collaterals.filter((c) => c.symbol !== "Idle");
  const curator = o.managers?.[0];

  return (
    <div className="mt-5">
      {/* Title */}
      <h1 className="text-[34px] font-medium leading-tight tracking-tight">
        {o.name.replace(new RegExp(`\\s*${o.asset}$`, "i"), "")} <span className="text-faint">{o.asset}</span>
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {o.address && <span className="rounded-full bg-card py-0.5 pl-2.5 pr-1"><AddressPill address={o.address} chain={o.chain} /></span>}
        <span className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1"><ChainIcon chain={o.chain} logo={o.chainLogo} size={14} /> {o.chain}</span>
        {curator && <span className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1"><Logo src={curator.logoUrl} label={curator.name} size={14} /> {curator.name}</span>}
        <span className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1"><Logo src={o.assetLogo} label={o.asset} size={14} /> {o.asset}</span>
      </div>
      {p?.description && <p className="mt-5 max-w-3xl text-sm leading-relaxed text-ink/75">{p.description}</p>}

      {/* Key numbers */}
      <div className="mt-7 grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-4">
        <Stat label="Total Deposits" value={usd(o.tvlUsd)} />
        {p?.liquidityUsd !== undefined && <Stat label="Liquidity" value={usd(p.liquidityUsd)} hint="Can be withdrawn right now" />}
        {exposure.length > 0 && (
          <div>
            <div className="text-xs text-muted">Exposure</div>
            <div className="mt-2 flex items-center">
              {exposure.slice(0, 5).map((c, i) => (
                <span key={c.symbol} className={`rounded-full ring-2 ring-bg ${i ? "-ml-1.5" : ""}`} title={c.symbol}><Logo src={c.logo} label={c.symbol} size={26} /></span>
              ))}
              {exposure.length > 5 && <span className="ml-1.5 text-xs text-muted">+{exposure.length - 5}</span>}
            </div>
          </div>
        )}
        <Stat label="Net APY" value={pct(netApy)} accent />
      </div>

      <nav className="mt-8 flex gap-6 border-b border-line text-sm">
        {[["overview", "Overview"], ["allocation", "Allocation"], ["performance", "Performance"], ["risk", "Risk"]].map(([id, label], i) => (
          <a key={id} href={`#${id}`} className={`-mb-px border-b-2 pb-2.5 ${i === 0 ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</a>
        ))}
      </nav>

      {/* Overview */}
      <section id="overview" className="scroll-mt-20">
        <H2>Overview</H2>
        <Table rows={[
          ["Morpho vault version", p?.version ?? "—"],
          ...(p?.createdAt ? [["Vault deployment date", new Date(p.createdAt).toISOString().slice(0, 10)] as [string, string]] : []),
          ...(curator ? [["Curator", curator.name] as [string, string]] : []),
        ]} title="Vault Configuration" />

        {(loading || depSeries.length > 1) && (
          <Card className="mt-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted">Total Deposits (USD)</div>
                <div className="tabular mt-1 flex items-center gap-2 text-2xl font-medium">
                  {usd(depHover?.[1] ?? o.tvlUsd)}
                  {!depHover && depChange !== null && <Delta v={depChange} />}
                </div>
                <div className="mt-0.5 text-xs text-muted">{depHover ? when(depHover[0]) : `Now · ${depWin.toUpperCase()} change`}</div>
              </div>
              <WinPick value={depWin} onChange={setDepWin} />
            </div>
            <div className="mt-4"><LineChart data={depSeries} format={usdAxis} height={200} color="var(--accent)" axis loading={loading} onHover={setDepHover} /></div>
          </Card>
        )}

        {(loading || apySeries.length > 1) && (
          <Card className="mt-6 grid gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(200px,1fr)]">
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted">Net APY</div>
                  <div className="tabular mt-1 text-2xl font-medium">{pct(apyHover?.[1] ?? netApy)}</div>
                  <div className="mt-0.5 text-xs text-muted">{apyHover ? when(apyHover[0]) : apyAvg !== null ? `Now · ${apyWin.toUpperCase()} avg ${pct(apyAvg)}` : "Now"}</div>
                </div>
                <WinPick value={apyWin} onChange={setApyWin} />
              </div>
              <div className="mt-4"><LineChart data={apySeries} format={(v) => pct(v)} height={180} color="var(--accent)" axis loading={loading} onHover={setApyHover} /></div>
            </div>
            <div className="flex flex-col p-1 text-sm md:border-l md:border-line md:pl-5">
              <div className="font-medium">APY Breakdown</div>
              <dl className="mt-3 grid gap-2.5">
                {breakdown.map((b) => (
                  <div key={b.label} className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-muted">{"logo" in b && <Logo src={b.logo} label={b.label} size={14} />}{b.label}</dt>
                    <dd className={`tabular ${"tone" in b ? (b.tone === "pos" ? "text-mint" : "text-neg") : ""}`}>{b.value}</dd>
                  </div>
                ))}
                <div className="mt-1 border-t border-line pt-2.5"><Row label="Net APY" value={pct(netApy)} strong /></div>
              </dl>
              <p className="mt-auto pt-4 text-[11px] leading-relaxed text-muted">Live rates from Morpho. The chart plots Morpho&apos;s recorded {o.ref?.source === "morpho-v2" ? "average " : ""}net APY.</p>
            </div>
          </Card>
        )}
      </section>

      {/* Allocation */}
      {alloc.length > 0 && (
        <section id="allocation" className="scroll-mt-20">
          <H2>Allocation</H2>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Exposure</div>
            <div className="flex rounded-full bg-card-2 p-0.5 text-xs">
              {([["markets", "Markets"], ["collateral", "Collateral"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setAllocTab(k)} className={`h-7 rounded-full px-3 ${allocTab === k ? "bg-white/15 font-medium text-ink" : "text-muted"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-line bg-card">
            {allocTab === "markets" ? <MarketsTable rows={alloc} asset={o.asset} /> : (
              <table className="w-full min-w-[480px] text-left text-[13px]">
                <thead className="text-xs text-muted"><tr><th className="px-4 py-2.5 font-normal">Collateral</th><th className="px-4 py-2.5 text-right font-normal">Allocation (%)</th><th className="px-4 py-2.5 text-right font-normal">Allocation (USD)</th></tr></thead>
                <tbody>
                  {collaterals.map((c) => (
                    <tr key={c.symbol} className="border-t border-line">
                      <td className="px-4 py-2.5"><span className="flex items-center gap-2"><Logo src={c.logo} label={c.symbol} size={18} /> {c.symbol}</span></td>
                      <td className="tabular px-4 py-2.5 text-right">{fmtPct(o.tvlUsd ? c.usd / o.tvlUsd : 0)}</td>
                      <td className="tabular px-4 py-2.5 text-right">{usd(c.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* Performance */}
      {(loading || spSeries.length > 1 || returns.length > 0 || p?.fees?.length) && (
        <section id="performance" className="scroll-mt-20">
          <H2>Performance</H2>
          {(loading || spSeries.length > 1) && (
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted">Position Unit Price ({o.asset}) <Info className="size-3" /></div>
                  <div className="tabular mt-1 flex items-center gap-2 text-2xl font-medium">
                    {(spHover ?? spSeries.at(-1))?.[1].toFixed(6) ?? "—"}
                    {!spHover && spChange !== null && <span className={`rounded-full px-1.5 py-0.5 text-xs ${spChange >= 0 ? "bg-accent-soft text-accent" : "bg-neg/15 text-neg"}`}>{spChange >= 0 ? "+" : ""}{(spChange * 100).toFixed(2)}%</span>}
                  </div>
                </div>
                <WinPick value={spWin} onChange={setSpWin} />
              </div>
              <div className="mt-4"><LineChart data={spSeries} format={(v) => v.toFixed(4)} height={180} color="var(--accent)" axis loading={loading} onHover={setSpHover} /></div>
            </Card>
          )}
          {returns.length > 0 && <Table className="mt-6" title="Returns" rows={returns.map((r) => [r.label, pct(r.value ?? null)] as [string, string])} />}
          {!!p?.fees?.length && <Table className="mt-6" title="Fees" rows={p.fees.map((f) => [f.label, f.value] as [string, string])} />}
        </section>
      )}

      {/* Risk */}
      {(p?.roles?.length || p?.allocators?.length || p?.timelocks?.length) && (
        <section id="risk" className="scroll-mt-20">
          <H2>Risk</H2>
          {!!p?.roles?.length && <AddrTable title="Vault Roles" chain={o.chain} rows={p.roles.map((r) => [r.label, r.address])} />}
          {!!p?.allocators?.length && <AddrTable className="mt-6" title="Allocators" chain={o.chain} rows={p.allocators.map((a, i) => [`Allocator ${i + 1}`, a])} />}
          {!!p?.timelocks?.length && (
            <div className="mt-6">
              <div className="mb-1 text-sm font-medium">Timelocks</div>
              <p className="mb-3 text-xs text-muted">How long lenders have to review a change before it takes effect.</p>
              <Table rows={p.timelocks.map((t) => [t.label, duration(t.seconds)] as [string, string])} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

const fmtPct = (f: number) => `${(f * 100).toFixed(f >= 0.1 ? 1 : 2)}%`;

function MarketsTable({ rows, asset }: { rows: AllocationRow[]; asset: string }) {
  return (
    <table className="w-full min-w-[680px] text-left text-[13px]">
      <thead className="text-xs text-muted">
        <tr>
          <th className="px-4 py-2.5 font-normal">Market</th>
          <th className="px-4 py-2.5 text-right font-normal">Allocation (%)</th>
          <th className="px-4 py-2.5 text-right font-normal">Allocation (USD)</th>
          <th className="px-4 py-2.5 text-right font-normal">Liquidity (USD)</th>
          <th className="px-4 py-2.5 text-right font-normal">Utilization</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-line">
            <td className="px-4 py-2.5">
              {r.id === "idle" ? (
                <span className="flex items-center gap-2 text-muted">{asset} · Idle liquidity</span>
              ) : (
                <span className="flex items-center gap-2">
                  <Logo src={r.loan.logo} label={r.loan.symbol} size={18} /> {r.loan.symbol}
                  <span className="text-faint">|</span>
                  {r.collateral ? <><Logo src={r.collateral.logo} label={r.collateral.symbol} size={18} /> {r.collateral.symbol}</> : <span className="text-muted">Idle</span>}
                  {r.lltv ? <span className="rounded-full bg-card-2 px-1.5 text-[11px] text-muted">{(r.lltv * 100).toFixed(1)}%</span> : null}
                </span>
              )}
            </td>
            <td className="tabular px-4 py-2.5 text-right">{fmtPct(r.pct)}</td>
            <td className="tabular px-4 py-2.5 text-right">{usd(r.allocationUsd)}</td>
            <td className="tabular px-4 py-2.5 text-right text-ink/75">{r.liquidityUsd !== undefined ? usd(r.liquidityUsd) : "—"}</td>
            <td className="tabular px-4 py-2.5 text-right text-ink/75">{r.utilization !== undefined ? fmtPct(r.utilization) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 mt-12 text-lg font-medium">{children}</h2>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-card p-5 ${className}`}>{children}</div>;
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-muted" title={hint}>{label}{hint && <Info className="size-3" />}</div>
      <div className={`tabular mt-1.5 text-[30px] font-medium leading-none ${accent ? "text-accent" : ""}`}>{value}</div>
    </div>
  );
}

function WinPick({ value, onChange }: { value: Win; onChange: (w: Win) => void }) {
  return (
    <div className="flex rounded-full bg-card-2 p-0.5 text-xs">
      {(Object.keys(DAYS) as Win[]).map((w) => (
        <button key={w} onClick={() => onChange(w)} aria-pressed={value === w}
          className={`h-7 rounded-full px-2.5 ${value === w ? "bg-white/15 font-medium text-ink" : "text-muted hover:text-ink"}`}>{w.toUpperCase()}</button>
      ))}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular ${strong ? "font-medium" : ""}`}>{value}</dd>
    </div>
  );
}

function Table({ rows, title, className = "" }: { rows: [string, string][]; title?: string; className?: string }) {
  if (!rows.length) return null;
  return (
    <div className={className}>
      {title && <div className="mb-3 text-sm font-medium">{title}</div>}
      <dl className="rounded-2xl border border-line bg-card">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between px-4 py-3 text-[13px] ${i ? "border-t border-line" : ""}`}>
            <dt className="text-muted">{k}</dt>
            <dd className="tabular font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AddrTable({ title, rows, chain, className = "" }: { title: string; rows: [string, string][]; chain: string; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-3 text-sm font-medium">{title}</div>
      <dl className="rounded-2xl border border-line bg-card">
        {rows.map(([k, a], i) => (
          <div key={k + a} className={`flex items-center justify-between px-4 py-3 text-[13px] ${i ? "border-t border-line" : ""}`}>
            <dt className="text-muted">{k}</dt>
            <dd><AddressPill address={a} chain={chain} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Delta({ v }: { v: number }) {
  return <span className={`rounded-full px-1.5 py-0.5 text-xs ${v >= 0 ? "bg-accent-soft text-accent" : "bg-neg/15 text-neg"}`}>{v >= 0 ? "+" : ""}{(v * 100).toFixed(2)}%</span>;
}

const fmtFeePct = (f: number) => `${Number((f * 100).toFixed(2))}%`;
