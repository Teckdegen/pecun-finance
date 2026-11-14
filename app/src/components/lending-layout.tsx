"use client";

import { Activity, ExternalLink, Gauge, Info, Landmark, ShieldCheck, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LendingInfo, Opportunity } from "@/lib/types.ts";
import { AddressPill, ChainIcon, Logo, pct, usd } from "./ui";

/**
 * Lending-market layout, laid out as a tiled dashboard in the same rhythm as the vault dossier:
 * Rates (chart + composition) → Supply & Borrow (cap rings) → Risk (collateral rules + liquidity donut) → Market.
 * Every tile only renders the numbers the protocol actually publishes.
 */
export function LendingLayout({ o }: { o: Opportunity }) {
  const l = o.lending as LendingInfo;
  const coll = l.collateral;
  const supplyApy = l.supplyApy ?? o.apy;
  const supplied = l.totalSuppliedUsd ?? o.tvlUsd;
  const borrowed = l.totalBorrowedUsd;
  const available = l.liquidityUsd ?? (borrowed !== undefined ? Math.max(0, supplied - borrowed) : undefined);
  const util = l.utilization ?? (borrowed !== undefined && supplied ? borrowed / supplied : undefined);
  const ratio = (a?: number, b?: number) => (a !== undefined && b ? Math.min(1, a / b) : undefined);
  const supplyUse = ratio(supplied, l.supplyCapUsd);
  const borrowUse = ratio(borrowed, l.borrowCapUsd);
  const price = l.priceUsd === undefined ? undefined : l.priceUsd >= 1 ? `$${l.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `$${l.priceUsd.toPrecision(4)}`;
  const hasCurve = (l.rateCurve?.length ?? 0) > 1;
  const hasRisk = l.maxLtv !== undefined || l.liquidationThreshold !== undefined || l.liquidationPenalty !== undefined || !!coll;

  // Where the supply rate comes from: what borrowers pay, spread over all suppliers, minus the protocol's cut.
  const paid = l.borrowApy !== undefined && util !== undefined ? l.borrowApy * util : undefined;
  const cut = paid !== undefined && l.reserveFactor ? paid * l.reserveFactor : undefined;

  return (
    <div className="mt-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        {coll ? (
          <span className="flex shrink-0">
            <Logo src={coll.logo} label={coll.symbol} size={48} />
            <span className="-ml-3 rounded-full ring-4 ring-white/70"><Logo src={o.assetLogo} label={o.asset} size={48} /></span>
          </span>
        ) : (
          <Logo src={o.assetLogo} label={o.asset} size={52} />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight">
            {coll ? <>{coll.symbol} <span className="text-faint">/</span> {o.asset}</> : o.asset}
            <span className="ml-2 text-base font-normal text-muted">{coll ? "market" : "lending"}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <Chip><Logo src={o.protocolLogo} label={o.protocol} size={14} /> {o.protocol}{o.manager !== o.protocol && <span className="text-muted">· {o.manager}</span>}</Chip>
            <Chip><ChainIcon chain={o.chain} logo={o.chainLogo} size={14} /> {o.chain}</Chip>
            {o.address && <Chip tight><AddressPill address={o.address} chain={o.chain} /></Chip>}
          </div>
        </div>
      </div>

      {/* Rates */}
      <Heading>Market Rates</Heading>
      <Tile className="grid gap-0 p-0 md:grid-cols-[minmax(0,1fr)_270px]">
        <div className="min-w-0 p-5">
          <Label icon={<TrendingUp className="size-3.5" />}>Interest rate model</Label>
          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <div className="tabular text-[26px] font-semibold leading-none text-accent">{pct(supplyApy)}</div>
              <div className="mt-1.5 text-xs text-muted">Supply APY</div>
            </div>
            {l.borrowApy !== undefined && (
              <div>
                <div className="tabular text-[26px] font-semibold leading-none">{pct(l.borrowApy)}</div>
                <div className="mt-1.5 text-xs text-muted">Borrow APY</div>
              </div>
            )}
          </div>
          {hasCurve ? (
            <>
              <RateCurve points={l.rateCurve!} current={util} reserveFactor={l.reserveFactor ?? 0} />
              <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
                <Key color="var(--accent)">Borrow rate</Key>
                <Key color="var(--mint)">Supply rate</Key>
                <span>x-axis: share of supplied funds borrowed</span>
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm text-muted">{o.protocol} doesn&apos;t publish this market&apos;s rate curve. Rates move with how much of the pool is borrowed.</p>
          )}
        </div>

        <div className="flex flex-col border-t border-line p-5 md:border-l md:border-t-0">
          <div className="text-sm font-medium">Yield Composition</div>
          <div className="mt-3 space-y-2.5 text-sm">
            {l.borrowApy !== undefined && <Line icon={<Landmark className="size-3.5" />} k="Borrow APY" v={pct(l.borrowApy)} />}
            {util !== undefined && <Line icon={<Gauge className="size-3.5" />} k="× Utilization" v={pct(util)} />}
            {paid !== undefined && <Line icon={<Activity className="size-3.5" />} k="Paid to suppliers" v={pct(paid)} tone="pos" />}
            {cut !== undefined && <Line icon={<ShieldCheck className="size-3.5" />} k={`Reserve factor (${pct(l.reserveFactor!).replace(".00", "")})`} v={`-${pct(cut)}`} tone="neg" />}
          </div>
          <div className="my-4 h-px bg-line" />
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5"><TrendingUp className="size-3.5 text-accent" /> Supply APY</span>
            <b className="tabular">{pct(supplyApy)}</b>
          </div>
          {o.apyNote && <p className="mt-1 text-xs text-muted">{o.apyNote}</p>}
          <p className="mt-auto pt-5 text-[11px] leading-relaxed text-muted">
            *Supply APY is the protocol&apos;s live rate. The breakdown above is an estimate; compounding and incentives can move it slightly.
          </p>
        </div>
      </Tile>

      {/* Supply & borrow */}
      <Heading>Supply and Borrow</Heading>
      <div className="grid gap-4 md:grid-cols-2">
        <Tile>
          <Label icon={<Landmark className="size-3.5" />}>Total supplied</Label>
          <CapFigure use={supplyUse} value={usd(supplied)} cap={l.supplyCapUsd} />
          {borrowed !== undefined && available !== undefined && (
            <div className="mt-5">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-card-2">
                <div style={{ width: `${(util ?? 0) * 100}%`, background: "var(--accent)" }} />
                <div style={{ width: `${(1 - (util ?? 0)) * 100}%`, background: "var(--mint)", opacity: 0.55 }} />
              </div>
              <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-xs">
                <Key color="var(--accent)">Borrowed <b className="tabular ml-1 text-ink">{usd(borrowed)}</b></Key>
                <Key color="var(--mint)">Available <b className="tabular ml-1 text-ink">{usd(available)}</b></Key>
              </div>
            </div>
          )}
        </Tile>
        {(borrowed !== undefined || l.borrowApy !== undefined) && (
          <Tile>
            <Label icon={<Activity className="size-3.5" />}>Total borrowed</Label>
            <CapFigure use={borrowUse} value={borrowed !== undefined ? usd(borrowed) : "—"} cap={l.borrowCapUsd} />
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
              {l.borrowApy !== undefined && <Mini label="Borrow APY" value={pct(l.borrowApy)} />}
              {util !== undefined && <Mini label="Utilization" value={pct(util)} />}
              {!!l.reserveFactor && <Mini label="Reserve factor" value={pct(l.reserveFactor)} />}
              {price && <Mini label="Oracle price" value={price} />}
            </div>
          </Tile>
        )}
      </div>

      {/* Risk */}
      {hasRisk && (
        <>
          <Heading>Risk Parameters</Heading>
          <Tile className="grid gap-0 p-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="p-5">
              <Label icon={<ShieldCheck className="size-3.5" />}>{coll ? "Isolated market" : "Collateral rules"}</Label>
              <p className="mt-4 text-[15px] leading-relaxed">
                {coll ? (
                  <>Lenders supply <b>{o.asset}</b>. Borrowers post <b>{coll.symbol}</b> as collateral{l.liquidationThreshold !== undefined && <> and are liquidated once their loan passes <b>{pct(l.liquidationThreshold)}</b> of its value</>}. Your {o.asset} is only lent against {coll.symbol}.</>
                ) : (
                  <>
                    {l.canBeCollateral === false ? <><b>{o.asset}</b> can&apos;t be used as collateral here; it only earns supply interest.</> : <>Suppliers can use <b>{o.asset}</b> as collateral{l.maxLtv ? <> to borrow up to <b>{pct(l.maxLtv)}</b> of its value</> : ""}.</>}
                    {l.liquidationThreshold ? <> Positions are liquidated at <b>{pct(l.liquidationThreshold)}</b> loan-to-value</> : ""}
                    {l.liquidationPenalty ? <> with a <b>{pct(l.liquidationPenalty)}</b> penalty.</> : l.liquidationThreshold ? "." : ""}
                  </>
                )}
              </p>
              <div className="mt-5 grid grid-cols-3 gap-4">
                {!coll && l.maxLtv !== undefined && <Mini label="Max LTV" value={pct(l.maxLtv)} />}
                {l.liquidationThreshold !== undefined && <Mini label={coll ? "LLTV" : "Liq. threshold"} value={pct(l.liquidationThreshold)} />}
                {l.liquidationPenalty !== undefined && <Mini label="Liq. penalty" value={pct(l.liquidationPenalty)} />}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-line p-5 md:border-l md:border-t-0">
              <div className="min-w-0">
                <div className="text-xs text-muted">Total value supplied</div>
                <div className="tabular mt-1 text-[26px] font-semibold leading-none">{usd(supplied)}</div>
                <p className="mt-3 text-xs leading-relaxed text-muted">What lenders have deposited, split by what&apos;s lent out and what can be withdrawn right now.</p>
                {borrowed !== undefined && available !== undefined && (
                  <div className="mt-3 space-y-1 text-xs">
                    <Key color="var(--accent)">Borrowed {pct(util ?? 0)}</Key>
                    <Key color="var(--mint)">Available {pct(1 - (util ?? 0))}</Key>
                  </div>
                )}
              </div>
              {util !== undefined && <Donut share={util} center={usd(supplied)} />}
            </div>
          </Tile>
        </>
      )}

      {/* Market */}
      <Heading>Market</Heading>
      <Tile>
        <dl className="grid gap-x-8 text-sm sm:grid-cols-2">
          {([
            ["Protocol", o.protocol],
            ...(o.manager !== o.protocol ? [["Market", o.manager]] : []),
            ["Chain", o.chain],
            ["Supply asset", o.asset],
            ...(coll ? [["Collateral", coll.symbol]] : []),
            ["Withdrawals", o.redemption],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 border-b border-line py-2.5">
              <dt className="text-muted">{k}</dt>
              <dd className="truncate text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <a href={o.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          <Logo src={o.protocolLogo} label={o.protocol} size={16} /> Open on {o.protocol} <ExternalLink className="size-3.5 opacity-70" />
        </a>
      </Tile>
    </div>
  );
}

/* ---------- pieces ---------- */

const Heading = ({ children }: { children: ReactNode }) => <h2 className="mb-3 mt-9 text-base font-semibold">{children}</h2>;

function Tile({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-[22px] border border-line bg-card p-5 ${className}`}>{children}</section>;
}

function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="flex items-center gap-1.5 text-xs font-medium text-muted">{icon}{children}</div>;
}

function Chip({ children, tight }: { children: ReactNode; tight?: boolean }) {
  return <span className={`flex items-center gap-1.5 rounded-full bg-card-2 ${tight ? "py-0.5 pl-2.5 pr-1" : "px-2.5 py-1"}`}>{children}</span>;
}

function Key({ color, children }: { color: string; children: ReactNode }) {
  return <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: color }} />{children}</span>;
}

function Line({ icon, k, v, tone }: { icon: ReactNode; k: string; v: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-muted">{icon}{k}</span>
      <span className={`tabular font-medium ${tone === "pos" ? "text-mint" : tone === "neg" ? "text-neg" : ""}`}>{v}</span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs leading-tight text-muted">{label}</div>
      <div className="tabular mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

/** Ring + figure, "out of cap" when the protocol sets one. */
function CapFigure({ use, value, cap }: { use?: number; value: string; cap?: number }) {
  return (
    <div className="mt-4 flex items-center gap-4">
      {use !== undefined && <Ring value={use} />}
      <div>
        <div className="tabular text-[26px] font-semibold leading-none">{value}</div>
        <div className="mt-1.5 text-xs text-muted">{cap ? `Out of ${usd(cap)} cap` : "No cap set"}</div>
      </div>
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const color = value >= 0.99 ? "var(--neg)" : value >= 0.9 ? "var(--amber)" : "var(--accent)";
  return (
    <svg viewBox="0 0 54 54" className="size-[54px] shrink-0" role="img" aria-label={`${(value * 100).toFixed(1)}% of cap used`}>
      <circle cx="27" cy="27" r={r} fill="none" stroke="var(--card-2)" strokeWidth="4.5" />
      <circle cx="27" cy="27" r={r} fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 27 27)" />
      <text x="27" y="31" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink)">{Math.round(value * 100)}%</text>
    </svg>
  );
}

/** Borrowed vs available, with total supplied in the middle. */
function Donut({ share, center }: { share: number; center: string }) {
  const r = 52, c = 2 * Math.PI * r, s = Math.min(1, Math.max(0, share));
  return (
    <svg viewBox="0 0 140 140" className="size-[132px] shrink-0 sm:size-[150px]" role="img" aria-label={`${(s * 100).toFixed(1)}% borrowed`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--mint)" strokeOpacity="0.55" strokeWidth="18" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--accent)" strokeWidth="18" strokeDasharray={`${c * s} ${c}`} transform="rotate(-90 70 70)" />
      <text x="70" y="75" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)">{center}</text>
    </svg>
  );
}

/** Borrow rate (from the protocol's curve) and the supply rate it implies, against utilization. */
function RateCurve({ points, current, reserveFactor }: { points: [number, number][]; current?: number; reserveFactor: number }) {
  // Drawn at the container's real width so labels stay readable on phones.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 420 ? 170 : 200, P = { l: 40, r: 12, t: 14, b: 24 };
  const rateAt = (u: number) => {
    for (let i = 1; i < points.length; i++) {
      const [u0, v0] = points[i - 1], [u1, v1] = points[i];
      if (u <= u1) return v0 + ((u - u0) / (u1 - u0 || 1)) * (v1 - v0);
    }
    return points[points.length - 1][1];
  };
  const supplyAt = (u: number) => rateAt(u) * u * (1 - reserveFactor);
  const maxY = Math.max(...points.map((p) => p[1]), 0.01) * 1.08;
  const x = (u: number) => P.l + u * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / maxY) * (H - P.t - P.b);
  const borrowPath = points.map(([u, v], i) => `${i ? "L" : "M"}${x(u).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const us = Array.from({ length: 81 }, (_, i) => i / 80);
  const supplyPath = us.map((u, i) => `${i ? "L" : "M"}${x(u).toFixed(1)},${y(supplyAt(u)).toFixed(1)}`).join(" ");
  const area = `${borrowPath} L${x(points[points.length - 1][0]).toFixed(1)},${y(0)} L${x(points[0][0]).toFixed(1)},${y(0)} Z`;
  const fmt = (v: number) => `${(v * 100).toFixed(v * 100 >= 10 ? 0 : 1)}%`;
  return (
    <div ref={box} className="mt-4 w-full">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label="Interest rate model">
      <defs>
        <linearGradient id="irm-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={P.l} x2={W - P.r} y1={y(f * maxY)} y2={y(f * maxY)} stroke="var(--line)" strokeDasharray={f ? "3 4" : undefined} />
          <text x={P.l - 8} y={y(f * maxY) + 4} fontSize="11" fill="var(--faint)" textAnchor="end">{fmt(f * maxY)}</text>
        </g>
      ))}
      {(W < 420 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((u) => (
        <text key={u} x={x(u)} y={H - 5} fontSize="11" fill="var(--faint)" textAnchor={u === 0 ? "start" : u === 1 ? "end" : "middle"}>{`${u * 100}%`}</text>
      ))}
      <path d={area} fill="url(#irm-fill)" />
      <path d={borrowPath} fill="none" stroke="var(--accent)" strokeWidth="2.25" strokeLinejoin="round" />
      <path d={supplyPath} fill="none" stroke="var(--mint)" strokeWidth="2" strokeLinejoin="round" />
      {current !== undefined && (
        <>
          <line x1={x(current)} x2={x(current)} y1={P.t} y2={H - P.b} stroke="var(--ink)" strokeOpacity="0.25" strokeDasharray="2 3" />
          <circle cx={x(current)} cy={y(rateAt(current))} r="4.5" fill="#fff" stroke="var(--accent)" strokeWidth="2.5" />
          <circle cx={x(current)} cy={y(supplyAt(current))} r="4.5" fill="#fff" stroke="var(--mint)" strokeWidth="2.5" />
          <g transform={`translate(${Math.min(Math.max(x(current), P.l + 46), W - P.r - 46)}, ${P.t + 6})`}>
            <rect x="-44" y="-11" width="88" height="20" rx="10" fill="var(--ink)" />
            <text x="0" y="3" fontSize="11" fill="#fff" textAnchor="middle">{`Now · ${(current * 100).toFixed(1)}%`}</text>
          </g>
        </>
      )}
    </svg>
    </div>
  );
}
