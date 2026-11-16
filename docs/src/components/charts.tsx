"use client";

import { ArrowDown, ArrowRight } from "lucide-react";
import { useState, type ReactNode } from "react";

export type Slice = { label: string; value: number; color: string; note?: string };

const usd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

/** A frame for every chart: white card, title, optional caption under it. */
export function ChartCard({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-3xl border border-line bg-white p-5 sm:p-7">
      <figcaption className="font-tight text-[1.1rem] font-medium tracking-[-0.02em] text-ink">{title}</figcaption>
      <div className="mt-5">{children}</div>
      {caption && <p className="mt-5 text-sm leading-relaxed text-[#8a8a83]">{caption}</p>}
    </figure>
  );
}

/** Donut chart with a legend. Hover or tap a slice or a legend row to bring it forward. */
export function Donut({ data, center, sub }: { data: Slice[]; center: string; sub: string }) {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shown = active === null ? null : data[active];
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[220px_1fr] sm:gap-8">
      <div className="relative mx-auto size-[220px]">
        <svg viewBox="0 0 180 180" className="size-full -rotate-90" role="img" aria-label={data.map((d) => `${d.label} ${d.value}%`).join(", ")}>
          <circle cx="90" cy="90" r={r} fill="none" stroke="#f1f1ec" strokeWidth="26" />
          {data.map((d, i) => {
            const len = (d.value / total) * c;
            const el = (
              <circle
                key={d.label}
                cx="90"
                cy="90"
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={active === i ? 32 : 26}
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                strokeDashoffset={-offset}
                className="cursor-pointer transition-all duration-200"
                opacity={active === null || active === i ? 1 : 0.35}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-tight text-[2rem] font-medium leading-none tracking-[-0.04em] text-ink">{shown ? `${shown.value}%` : center}</span>
          <span className="mt-1.5 max-w-[8rem] text-[13px] leading-tight text-[#8a8a83]">{shown ? shown.label : sub}</span>
        </div>
      </div>
      <ul className="flex flex-col gap-1">
        {data.map((d, i) => (
          <li key={d.label}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${active === i ? "bg-[#f1f5ea]" : ""}`}
            >
              <span className="mt-1.5 size-3 shrink-0 rounded-[4px]" style={{ background: d.color }} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-tight font-medium text-ink">{d.label}</span>
                  <span className="tabular font-tight font-medium text-ink">{d.value}%</span>
                </span>
                {d.note && <span className="mt-0.5 block text-[13px] leading-snug text-[#8a8a83]">{d.note}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One horizontal bar split into labelled segments that add up to 100%. */
export function SplitBar({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div>
      <div className="flex h-12 overflow-hidden rounded-2xl">
        {data.map((d) => (
          <div
            key={d.label}
            className="flex items-center justify-center font-tight text-sm font-medium"
            style={{ width: `${(d.value / total) * 100}%`, background: d.color, color: d.color === "#0a0a0a" || d.color === "#1c3a28" || d.color === "#2f7d1c" ? "#fff" : "#0a0a0a" }}
          >
            {d.value / total >= 0.08 ? `${d.value}%` : ""}
          </div>
        ))}
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {data.map((d) => (
          <li key={d.label} className="flex items-start gap-2.5 text-[15px]">
            <span className="mt-1.5 size-3 shrink-0 rounded-[4px]" style={{ background: d.color }} />
            <span>
              <span className="font-medium text-ink">{d.label}</span> <span className="tabular text-[#5e5e58]">{d.value}%</span>
              {d.note && <span className="block text-[13px] text-[#8a8a83]">{d.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Boxes joined by arrows: across on wide screens, down on phones. */
/**
 * Numbered steps joined by arrows. Every card is the same height; the tone darkens along the way to show where the
 * money ends up. Arrows sit on the seam between cards (right on desktop, below on phones).
 */
export function Flow({ steps }: { steps: { title: string; body: string; tone?: "lime" | "dark" | "plain" }[] }) {
  const tone = (t?: string) =>
    t === "lime" ? "bg-lime text-ink" : t === "dark" ? "bg-[#122018] text-white" : "bg-[#f5f8ef] text-ink ring-1 ring-inset ring-black/[0.04]";
  return (
    <ol className="grid gap-4 md:auto-cols-fr md:grid-flow-col md:gap-5">
      {steps.map((s, i) => {
        const dark = s.tone === "dark";
        return (
          <li key={s.title} className={`relative flex flex-col rounded-[1.4rem] p-5 md:min-h-[11.5rem] ${tone(s.tone)}`}>
            <span
              className={`tabular inline-flex size-7 items-center justify-center rounded-full text-[11px] font-semibold ${
                dark ? "bg-lime text-ink" : s.tone === "lime" ? "bg-ink text-lime" : "bg-white text-ink ring-1 ring-black/10"
              }`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <p className="mt-auto pt-6 font-tight text-[1.15rem] font-medium leading-tight tracking-[-0.025em]">{s.title}</p>
            <p className={`mt-1.5 text-[13.5px] leading-snug ${dark ? "text-white/65" : "text-[#5e5e58]"}`}>{s.body}</p>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="absolute -bottom-[1.15rem] left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-line bg-white text-ink shadow-[0_2px_8px_rgba(10,10,10,0.08)] md:-right-[1.4rem] md:bottom-auto md:left-auto md:top-1/2 md:-translate-y-1/2 md:translate-x-0"
              >
                <ArrowDown className="size-4 md:hidden" />
                <ArrowRight className="hidden size-4 md:block" />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${strong ? "bg-[#122018] text-white" : "bg-[#f5f8ef]"}`}>
      <p className={`text-[13px] ${strong ? "text-white/60" : "text-[#8a8a83]"}`}>{label}</p>
      <p className={`tabular mt-1 font-tight text-[1.6rem] font-medium leading-none tracking-[-0.03em] ${strong ? "text-lime" : "text-ink"}`}>{value}</p>
    </div>
  );
}

const VOLUMES = [100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];

/** Pick a daily trading volume and see what the Fund's 70% of the 3% tax adds, before any yield. */
export function TaxCalculator() {
  const [i, setI] = useState(3);
  const volume = VOLUMES[i];
  // 3% tax on each trade; 70% of it goes to the Fund, 30% to running costs.
  const day = volume * 0.03 * 0.7;
  const months = [1, 3, 6, 12];
  const max = day * 365;
  return (
    <div>
      <label className="flex items-baseline justify-between gap-3 text-[15px]">
        <span className="text-[#5e5e58]">Daily $PEN trading volume</span>
        <span className="tabular font-tight text-[1.3rem] font-medium text-ink">{usd(volume)}</span>
      </label>
      <input
        type="range"
        min={0}
        max={VOLUMES.length - 1}
        step={1}
        value={i}
        onChange={(e) => setI(Number(e.target.value))}
        aria-label="Daily trading volume"
        className="mt-3 w-full accent-[#2f7d1c]"
      />
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat label="Into the Fund each day" value={usd(day)} />
        <Stat label="Each month" value={usd(day * 30)} />
        <Stat label="Each year" value={usd(day * 365)} strong />
      </div>
      <div className="mt-6 flex h-40 items-end gap-3">
        {months.map((m) => {
          const v = day * 30 * m;
          return (
            <div key={m} className="flex flex-1 flex-col items-center gap-2">
              <span className="tabular text-[12px] text-[#5e5e58]">{usd(v)}</span>
              <div className="w-full rounded-t-xl bg-[#2f7d1c] transition-all duration-300" style={{ height: `${Math.max(4, (v / max) * 110)}px`, opacity: 0.45 + m / 24 }} />
              <span className="text-[12px] text-[#8a8a83]">{m === 12 ? "1 year" : `${m} mo`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SUPPLY = 1_000_000_000;
const TOKEN_PRESETS = [100_000, 1_000_000, 10_000_000];
const FUND_PRESETS = [100_000, 500_000, 2_000_000];
const shortNum = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);
const toNum = (v: string) => Math.max(0, Number(v.replace(/[^0-9.]/g, "")) || 0);

/** One number input with its unit and a few quick picks under it. */
function CalcField({ label, unit, value, onChange, presets, fmt }: {
  label: string; unit: string; value: number; onChange: (n: number) => void; presets: number[]; fmt: (n: number) => string;
}) {
  return (
    <div>
      <label className="text-[13px] font-medium text-[#5e5e58]">
        {label}
        <span className="mt-2 flex items-center gap-1 rounded-2xl border border-line bg-white px-4 transition focus-within:border-ink/40 focus-within:shadow-[0_0_0_4px_rgba(184,255,157,0.45)]">
          {unit === "$" && <span className="font-tight text-[1.25rem] text-[#8a8a83]">$</span>}
          <input
            inputMode="numeric"
            value={value.toLocaleString("en-US")}
            onChange={(e) => onChange(toNum(e.target.value))}
            className="tabular min-w-0 flex-1 bg-transparent py-3 font-tight text-[1.25rem] font-medium tracking-[-0.02em] text-ink outline-none"
          />
          {unit !== "$" && <span className="text-[12px] font-medium text-[#8a8a83]">{unit}</span>}
        </span>
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`tabular rounded-full px-3 py-1 text-[12px] transition ${value === p ? "bg-ink text-lime" : "bg-[#f5f8ef] text-[#5e5e58] hover:bg-[#eaf0df]"}`}
          >
            {fmt(p)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Enter how many tokens you hold and what the Fund is worth; see your share, with the sum written out. */
export function ShareCalculator() {
  const [tokens, setTokens] = useState(1_000_000);
  const [fund, setFund] = useState(500_000);
  const pct = tokens / SUPPLY;
  const share = pct * fund;
  const money = `$${share.toLocaleString("en-US", { minimumFractionDigits: share < 100 ? 2 : 0, maximumFractionDigits: share < 100 ? 2 : 0 })}`;
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-stretch">
      <div className="flex flex-col gap-5">
        <CalcField label="$PEN you hold" unit="PEN" value={tokens} onChange={(n) => setTokens(Math.min(SUPPLY, n))} presets={TOKEN_PRESETS} fmt={shortNum} />
        <CalcField label="Fund value" unit="$" value={fund} onChange={setFund} presets={FUND_PRESETS} fmt={(n) => `$${shortNum(n)}`} />
      </div>

      <div className="relative flex flex-col overflow-hidden rounded-[1.4rem] bg-[#122018] p-6 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-lime/20 blur-3xl" />
        <p className="relative text-[13px] text-white/60">Your share of the Fund</p>
        <p className="tabular relative mt-2 font-tight text-[2.75rem] font-medium leading-none tracking-[-0.04em] text-lime">{money}</p>

        <div className="relative mt-6">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-white/60">Your share of the supply</span>
            <span className="tabular font-medium">{(pct * 100).toFixed(pct < 0.0001 ? 6 : 4)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            {/* Scaled ×20 so a typical holding is visible; a 5% holder fills the bar. */}
            <div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, Math.max(pct * 2000, pct > 0 ? 1.5 : 0))}%` }} />
          </div>
        </div>

        <p className="tabular relative mt-auto pt-6 text-[12px] leading-relaxed text-white/45">
          {tokens.toLocaleString("en-US")} ÷ {SUPPLY.toLocaleString("en-US")} × ${fund.toLocaleString("en-US")} = {money}
        </p>
      </div>
    </div>
  );
}

export type Range = { label: string; low: number; high: number; weight?: string; highlight?: boolean; /** Show one value (the high) instead of a range. */ single?: boolean };

/** Horizontal low-to-high ranges on one shared scale, for estimated yields. */
export function RangeBars({ rows, max }: { rows: Range[]; max: number }) {
  const ticks = Array.from({ length: Math.floor(max / 5) + 1 }, (_, i) => i * 5);
  return (
    <div>
      <ul className="flex flex-col gap-3.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[1fr] gap-1.5 sm:grid-cols-[11rem_1fr] sm:items-center sm:gap-4">
            <span className={`flex items-baseline justify-between gap-2 text-[15px] sm:block ${r.highlight ? "font-tight font-medium text-ink" : "text-[#3a3a36]"}`}>
              {r.label}
              {r.weight && <span className="text-[13px] text-[#8a8a83] sm:block">{r.weight}</span>}
            </span>
            <div className="relative h-7 rounded-full bg-[#f1f1ec]">
              {r.high > 0 ? (
                <span
                  className={`absolute inset-y-1 flex items-center justify-center rounded-full text-[12px] font-medium ${r.highlight ? "bg-[#122018] text-lime" : "bg-[#2f7d1c] text-white"}`}
                  style={{ left: `${(r.low / max) * 100}%`, width: `${Math.max(9, ((r.high - r.low) / max) * 100)}%` }}
                >
                  {r.single ? `${r.high}%` : `${r.low}–${r.high}%`}
                </span>
              ) : (
                <span className="absolute inset-y-0 left-3 flex items-center text-[12px] text-[#8a8a83]">No yield</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 hidden grid-cols-[11rem_1fr] gap-4 sm:grid">
        <span />
        <div className="flex justify-between text-[11px] text-[#8a8a83]">
          {ticks.map((t) => (
            <span key={t}>{t}%</span>
          ))}
        </div>
      </div>
    </div>
  );
}
