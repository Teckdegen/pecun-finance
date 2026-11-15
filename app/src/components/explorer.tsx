"use client";

import {
  ArrowUpDown,
  CircleDollarSign,
  Check,
  ChevronDown,
  ChevronRight,
  Landmark,
  Layers,
  Lock,
  Search,
  SlidersHorizontal,
  Gift,
  LayoutGrid,
  Star,
  Waves,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, Opportunity } from "@/lib/types.ts";
import { ChainIcon, Logo, PlatformLogos, VaultMark, display, pct, subtitle, usd } from "./ui";

/* ---------- categories, sorting, filters ---------- */

type Cat = "all" | "featured" | "stable" | "lending" | "vaults" | "fixed" | "staking" | "perps";
const CATS: { id: Cat; label: string; icon: React.ElementType; test: (o: Opportunity) => boolean }[] = [
  { id: "all", label: "All Products", icon: LayoutGrid, test: () => true },
  { id: "featured", label: "Featured", icon: Star, test: (o) => !!o.featured },
  { id: "stable", label: "Stablecoin", icon: CircleDollarSign, test: (o) => o.stablecoin },
  { id: "lending", label: "Lending", icon: Landmark, test: (o) => o.kind === "Lending" },
  { id: "vaults", label: "Vaults", icon: Layers, test: (o) => o.kind === "Vault" || o.kind === "Liquidity" },
  { id: "fixed", label: "Fixed Yield", icon: Lock, test: (o) => o.kind === "Fixed yield" },
  { id: "staking", label: "Staking", icon: Waves, test: (o) => o.kind === "Liquid staking" },
  { id: "perps", label: "Perps", icon: ArrowUpDown, test: (o) => o.kind === "Perp vault" },
];

type ApyMode = "7d" | "30d";
const apyOf = (o: Opportunity, m: ApyMode) => (m === "7d" ? (o.apy7d ?? o.apy) : (o.apy30d ?? o.apy));
type SortKey = "tvl" | "apy" | "name";

const REDEMPTION_GROUPS = ["Instant", "Queued / async", "Lock-up", "At maturity"] as const;
function redemptionGroup(r: string): (typeof REDEMPTION_GROUPS)[number] {
  if (/^instant/i.test(r)) return "Instant";
  if (/maturity/i.test(r)) return "At maturity";
  if (/lock/i.test(r)) return "Lock-up";
  return "Queued / async";
}

type Filters = { cat: Cat; chain: string; asset: string; manager: string; redemption: string; apyMode: ApyMode };
const DEFAULTS: Filters = { cat: "all", chain: "", asset: "", manager: "", redemption: "", apyMode: "30d" };

/* ---------- one row per vault (deployments on several chains merged) ---------- */

type Row = Opportunity & { deployments: Opportunity[] };
function mergeDeployments(list: Opportunity[]): Row[] {
  const byKey = new Map<string, Opportunity[]>();
  for (const o of list) {
    const k = `${o.protocol}::${o.name}`;
    const arr = byKey.get(k);
    if (arr) arr.push(o);
    else byKey.set(k, [o]);
  }
  return [...byKey.values()].map((ds) => {
    const best = [...ds].sort((a, b) => (apyOf(b, "30d") ?? -1) - (apyOf(a, "30d") ?? -1) || b.tvlUsd - a.tvlUsd)[0];
    return { ...best, deployments: [best] };
  });
}

function applyFilters(all: Opportunity[], f: Filters, query: string): Row[] {
  const q = query.trim().toLowerCase();
  const test = CATS.find((c) => c.id === f.cat)!.test;
  return mergeDeployments(
    all.filter(
      (o) =>
        test(o) &&
        (!f.chain || o.chain === f.chain) &&
        (!f.asset || o.asset === f.asset) &&
        (!f.manager || o.manager === f.manager || !!o.managers?.some((m) => m.name === f.manager)) &&
        (!f.redemption || redemptionGroup(o.redemption) === f.redemption) &&
        (!q || `${o.ticker ?? ""} ${o.name} ${o.asset} ${o.protocol} ${o.manager} ${o.chain} ${o.category ?? ""}`.toLowerCase().includes(q)),
    ),
  );
}

/** One vault card: name, APY, manager, TVL, redemption, chevron. Chain stays in Filters. */
const COLS = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.7fr)_92px_72px_104px_20px] lg:grid-cols-[minmax(0,1.7fr)_92px_72px_104px_128px_20px]";
const ROW = `grid ${COLS} items-center gap-3 rounded-2xl bg-card px-4 py-3.5 transition hover:bg-white/[0.045] md:px-5`;

/* ---------- page ---------- */

export function Explorer({ catalog, initialQuery = "", initialEarn }: { catalog: Catalog; initialQuery?: string; initialEarn?: string }) {
  const all = catalog.opportunities;
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>(() => ({ ...DEFAULTS, cat: CATS.some((c) => c.id === initialEarn) ? (initialEarn as Cat) : "all" }));
  const [modalOpen, setModalOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "tvl", dir: -1 });
  const [limit, setLimit] = useState(40);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setLimit(40), [query, filters, sort]);

  // Manager logo: the manager's own logo when the protocol gives one, otherwise the protocol's logo.
  const managerLogo = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const o of all) for (const x of o.managers?.length ? o.managers : [{ name: o.manager, logoUrl: undefined }]) {
      if (x.logoUrl) m.set(x.name, x.logoUrl);
      else if (!m.get(x.name)) m.set(x.name, o.protocolLogo);
    }
    return m;
  }, [all]);

  const rows = useMemo(() => {
    const list = applyFilters(all, filters, query);
    const v = (o: Opportunity) => (sort.key === "tvl" ? o.tvlUsd : (apyOf(o, filters.apyMode) ?? -1));
    return list.sort((a, b) => (sort.key === "name" ? a.name.localeCompare(b.name) * sort.dir : (v(a) - v(b)) * sort.dir));
  }, [all, filters, query, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" ? 1 : -1 }));
  // Category is chosen in the sidebar or the Filters modal, so it does not count as an extra filter.
  const active = (Object.keys(DEFAULTS) as (keyof Filters)[]).filter((k) => k !== "cat" && filters[k] !== DEFAULTS[k]).length;
  const catMeta = CATS.find((c) => c.id === filters.cat)!;


  return (
    <div className="w-full">
      {/* Page title, Hood style: left-aligned, tight, with a one-line description */}
      <header>
        <h1 className="text-[1.65rem] font-medium tracking-[-0.03em] md:text-[2rem]">{catMeta.label === "All Products" ? "Explore yields" : catMeta.label}</h1>
        {CAT_TEXT[filters.cat] && <p className="mt-1 font-sans text-sm text-muted">{CAT_TEXT[filters.cat]}</p>}
      </header>

      <YieldBanner />

      <div className="mt-5 flex items-center gap-2">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
          <input
            id="search"
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vaults, assets, protocols"
            className="h-[52px] w-full scroll-mt-24 rounded-2xl bg-card pl-11 pr-11 text-[15px] placeholder:text-faint focus:bg-white/[0.045] focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-white/5">
              <X className="size-4" />
            </button>
          )}
        </label>
        <button
          onClick={() => setModalOpen(true)}
          aria-label={active ? `Filters, ${active} active` : "Filters"}
          className={`flex h-[52px] shrink-0 items-center gap-2 rounded-2xl px-4 text-sm transition ${active ? "bg-accent text-on-accent" : "bg-card text-ink hover:bg-white/[0.045]"}`}
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {active > 0 && <span className="grid size-5 place-items-center rounded-full bg-on-accent text-[11px] text-accent">{active}</span>}
        </button>
      </div>

      <div className={`mt-4 hidden items-center gap-3 px-5 text-xs text-muted md:grid ${COLS}`}>
        <SortHead label="Vault" onClick={() => toggleSort("name")} on={sort.key === "name"} />
        <SortHead label={`APY ${filters.apyMode}`} onClick={() => toggleSort("apy")} on={sort.key === "apy"} />
        <span>Manager</span>
        <SortHead label="TVL" onClick={() => toggleSort("tvl")} on={sort.key === "tvl"} />
        <span className="hidden lg:block">Redemption</span>
        <span />
      </div>
      <div className="mt-1 flex items-center justify-between px-1 text-xs text-muted md:hidden">
        <SortHead label="Vault" onClick={() => toggleSort("name")} on={sort.key === "name"} />
        <span className="flex items-center gap-4">
          <SortHead label="APY" onClick={() => toggleSort("apy")} on={sort.key === "apy"} />
          <SortHead label="TVL" onClick={() => toggleSort("tvl")} on={sort.key === "tvl"} />
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {rows.slice(0, limit).map((o) => (
          <Link key={o.id} href={`/earn/${o.slug}`} className={ROW}>
            <div className="flex min-w-0 items-center gap-3">
              <VaultMark o={o} size={42} />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium tracking-[-0.01em]">{display(o)}</div>
                <div className="mt-0.5 truncate text-[13px] text-muted">{subtitle(o)}</div>
              </div>
            </div>
            <span className="flex flex-col items-end md:hidden">
              <span className="tabular flex items-center gap-1 text-[15px] font-medium text-accent" title={o.apyNote}>
                {pct(apyOf(o, filters.apyMode))}
                {!!o.rewardApy && <Gift className="size-3.5" aria-label="Includes rewards" />}
              </span>
              <span className="tabular mt-0.5 text-xs text-muted">{usd(o.tvlUsd)}</span>
            </span>
            <span className="tabular hidden items-center gap-1 text-[15px] font-medium text-accent md:flex" title={o.apyNote}>
              {pct(apyOf(o, filters.apyMode))}
              {!!o.rewardApy && <Gift className="size-3.5" aria-label="Includes rewards" />}
            </span>
            <span className="hidden md:block"><SmallStack items={managerItems(o, managerLogo)} /></span>
            <span className="tabular hidden text-sm md:block">{usd(o.tvlUsd)}</span>
            <span className="hidden truncate text-sm text-muted lg:block" title={o.redemption || undefined}>{o.redemption}</span>
            <ChevronRight className="hidden size-4 text-muted md:block" />
          </Link>
        ))}

        {rows.length === 0 && (
          <div className="rounded-2xl bg-card py-14 text-center text-sm text-muted">
            Nothing matches.{" "}
            <button onClick={() => { setFilters(DEFAULTS); setQuery(""); }} className="font-medium text-accent underline">Reset</button>
          </div>
        )}
      </div>
      {rows.length > limit && (
        <div className="flex justify-center pt-5">
          <button onClick={() => setLimit((l) => l + 40)} className="eyebrow flex h-10 items-center gap-1.5 rounded-lg border border-line bg-card px-4 text-ink hover:border-white/30">
            Show more · {(rows.length - limit).toLocaleString()} left <ChevronDown className="size-4" />
          </button>
        </div>
      )}

      {modalOpen && (
        <FilterModal
          all={all}
          query={query}
          initial={filters}
          managerLogo={managerLogo}
          onClose={() => setModalOpen(false)}
          onApply={(f) => { setFilters(f); setModalOpen(false); }}
        />
      )}
    </div>
  );
}

/* ---------- filter modal ---------- */

function FilterModal({ all, query, initial, managerLogo, onClose, onApply }: {
  all: Opportunity[]; query: string; initial: Filters; managerLogo: Map<string, string | undefined>; onClose: () => void; onApply: (f: Filters) => void;
}) {
  const [f, setF] = useState<Filters>(initial);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const chains = useMemo(() => countBy(all, (o) => o.chain), [all]);
  const assets = useMemo(() => countBy(all, (o) => o.asset), [all]);
  const managers = useMemo(() => countBy(all.flatMap((o) => (o.managers?.length ? o.managers.map((m) => m.name) : [o.manager])), (m) => m), [all]);
  const chainLogo = useMemo(() => new Map(all.map((o) => [o.chain, o.chainLogo])), [all]);
  const assetLogo = useMemo(() => new Map(all.map((o) => [o.asset, o.assetLogo])), [all]);
  const protocolLogo = useMemo(() => new Map(all.map((o) => [o.protocol, o.protocolLogo])), [all]);
  const tvlByProtocol = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of all) m.set(o.protocol, (m.get(o.protocol) ?? 0) + o.tvlUsd);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const listedTvl = useMemo(() => all.reduce((s, o) => s + o.tvlUsd, 0), [all]);
  const resultCount = useMemo(() => applyFilters(all, f, query).length, [all, f, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="filters-title"
        className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-2xl glass-strong outline-none sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="filters-title" className="text-lg font-medium">Filters</h2>
          <button onClick={onClose} aria-label="Close filters" className="grid size-8 place-items-center rounded-full hover:bg-card"><X className="size-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Listed stat */}
          <div className="flex items-center justify-between rounded-2xl bg-card px-4 py-3">
            <div>
              <div className="tabular text-xl font-medium text-accent">{usd(listedTvl)}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                listed across
                <span className="flex">
                  {tvlByProtocol.slice(0, 7).map(([p], i) => (
                    <span key={p} className={`rounded-full ring-2 ring-card ${i ? "-ml-1.5" : ""}`}><Logo src={protocolLogo.get(p)} label={p} size={16} title={p} /></span>
                  ))}
                </span>
              </div>
            </div>
            <div className="flex h-10 items-end gap-1" aria-hidden>
              {tvlByProtocol.slice(0, 6).map(([p, v]) => (
                <span key={p} className="w-2 rounded-sm bg-accent/40" style={{ height: `${Math.max(16, (v / tvlByProtocol[0][1]) * 100)}%` }} />
              ))}
            </div>
          </div>

          <div className="mt-5 divide-y divide-line">
            <FilterRow label="Category">
              <OneLine
                anyLabel="All"
                value={f.cat === "all" ? "" : f.cat}
                onChange={(v) => set("cat", (v || "all") as Cat)}
                shown={4}
                items={CATS.filter((c) => c.id !== "all").map((c) => ({ value: c.id, label: c.label, icon: <c.icon className="size-4" /> }))}
                withLabels
              />
            </FilterRow>
            <FilterRow label="Chain">
              <OneLine anyLabel="Any Chain" value={f.chain} onChange={(v) => set("chain", v)} shown={6}
                items={chains.map(([c, n]) => ({ value: c, label: c, count: n, icon: <ChainIcon chain={c} logo={chainLogo.get(c)} size={20} /> }))} />
            </FilterRow>
            <FilterRow label="Asset">
              <OneLine anyLabel="Any Asset" value={f.asset} onChange={(v) => set("asset", v)} shown={6}
                items={assets.map(([a, n]) => ({ value: a, label: a, count: n, icon: <Logo src={assetLogo.get(a)} label={a} size={20} /> }))} />
            </FilterRow>
            <FilterRow label="Manager">
              <OneLine anyLabel="Any Manager" value={f.manager} onChange={(v) => set("manager", v)} shown={6}
                items={managers.map(([m, n]) => ({ value: m, label: m, count: n, icon: <Logo src={managerLogo.get(m)} label={m} size={20} /> }))} />
            </FilterRow>
            <FilterRow label="Redemption">
              <OneLine anyLabel="Any Time" value={f.redemption} onChange={(v) => set("redemption", v)} shown={4} withLabels
                items={REDEMPTION_GROUPS.map((r) => ({ value: r, label: r }))} />
            </FilterRow>
            <FilterRow label="APY avg.">
              <div className="flex rounded-full border border-line bg-card p-1">
                {(["7d", "30d"] as ApyMode[]).map((m) => (
                  <button key={m} onClick={() => set("apyMode", m)} aria-pressed={f.apyMode === m}
                    className={`h-8 rounded-full px-4 text-[13px] ${f.apyMode === m ? "bg-card-2 font-medium text-ink" : "text-muted hover:text-ink"}`}>{m.toUpperCase()}</button>
                ))}
              </div>
            </FilterRow>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          <button onClick={() => setF(DEFAULTS)} className="text-sm text-muted hover:text-ink">Reset all</button>
          <button onClick={() => onApply(f)} className="eyebrow h-11 rounded-lg bg-accent px-5 text-on-accent hover:bg-accent-deep">
            Show {resultCount.toLocaleString()} {resultCount === 1 ? "yield" : "yields"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <div className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

type MenuItem = { value: string; label: string; count?: number; icon?: React.ReactNode };

/**
 * One line: "Any X" + the first few options as logo buttons (or chips) + a "+N" menu for the rest.
 * A pick from the menu shows inline as a chip with its logo.
 */
function OneLine({ anyLabel, value, onChange, items, shown, withLabels }: {
  anyLabel: string; value: string; onChange: (v: string) => void; items: MenuItem[]; shown: number; withLabels?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const top = items.slice(0, shown);
  const rest = items.slice(shown);
  const pickedFromRest = rest.find((i) => i.value === value);
  const list = q ? rest.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())) : rest;
  return (
    <div ref={ref} className="relative flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-card p-1">
      <button onClick={() => onChange("")} aria-pressed={!value}
        className={`h-8 shrink-0 rounded-full px-3 text-[13px] ${!value ? "bg-card-2 font-medium text-ink" : "text-muted hover:text-ink"}`}>
        {anyLabel}
      </button>
      {top.map((i) => (
        <button key={i.value} onClick={() => onChange(value === i.value ? "" : i.value)} aria-pressed={value === i.value} title={i.label} aria-label={i.label}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full transition ${withLabels ? "px-3 text-[13px]" : "w-8 justify-center"} ${
            value === i.value ? "bg-accent-soft font-medium text-accent ring-1 ring-accent/50" : "text-ink hover:bg-card-2"}`}>
          {i.icon}{withLabels && i.label}
        </button>
      ))}
      {pickedFromRest && (
        <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-[13px] font-medium text-accent ring-1 ring-accent/40">
          {pickedFromRest.icon} <span className="max-w-[100px] truncate">{pickedFromRest.label}</span>
        </span>
      )}
      {rest.length > 0 && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox"
          className="flex h-8 shrink-0 items-center gap-0.5 rounded-full px-2.5 text-[13px] text-muted hover:bg-card-2 hover:text-ink">
          +{rest.length} <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {open && (
        <div className="fixed z-[60] w-64 rounded-2xl glass-strong p-1.5"
          style={{ top: (ref.current?.getBoundingClientRect().bottom ?? 0) + 6, left: Math.min(ref.current?.getBoundingClientRect().left ?? 0, window.innerWidth - 272) }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search"
            className="mb-1 h-8 w-full rounded-xl border border-line bg-card-2 px-2.5 text-sm placeholder:text-faint focus:outline-none" />
          <ul role="listbox" className="max-h-60 overflow-y-auto">
            {list.map((i) => (
              <li key={i.value}>
                <button role="option" aria-selected={i.value === value} onClick={() => { onChange(i.value); setOpen(false); setQ(""); }}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm hover:bg-card-2 ${i.value === value ? "bg-card-2 font-medium" : ""}`}>
                  {i.icon}
                  <span className="min-w-0 flex-1 truncate">{i.label}</span>
                  {i.value === value ? <Check className="size-3.5 text-accent" /> : i.count !== undefined && <span className="tabular text-xs text-faint">{i.count}</span>}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-1.5 text-sm text-muted">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- small pieces ---------- */

function SortHead({ label, onClick, on }: { label: string; onClick: () => void; on?: boolean }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 text-left text-xs hover:text-ink ${on ? "text-ink" : ""}`}>
      {label} <ArrowUpDown className={`size-3 ${on ? "text-accent" : ""}`} />
    </button>
  );
}

const CAT_TEXT: Record<Cat, string> = {
  all: "",
  featured: "Hand-picked vaults with deep liquidity and a clean track record.",
  stable: "Dollar-pegged yields. Your balance stays in stablecoins.",
  lending: "Supply an asset to a lending market and earn what borrowers pay.",
  vaults: "Curated strategies that allocate your deposit across markets for you.",
  fixed: "Lock a rate today and hold to maturity.",
  staking: "Stake to secure a network and keep a liquid token that grows.",
  perps: "Provide liquidity to perpetuals exchanges and earn from trading.",
};

/** Lime banner, Hood "Savings" style: a short headline and the platforms PECUN integrates. No yields, no button. */
function YieldBanner() {
  return (
    <section className="lime-banner mt-5 overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between md:gap-8 md:px-8 md:py-7">
        <div className="min-w-0">
          <span className="lb-pill inline-flex rounded-full px-3 py-1 font-sans text-sm">Earn</span>
          <h2 className="mt-3 text-[1.45rem] font-medium leading-tight tracking-[-0.035em] md:text-[1.9rem]">Put your money to work.</h2>
          <p className="lb-muted mt-1.5 font-sans text-sm">Vaults, lending and staking from the platforms below, in one place.</p>
        </div>
        <PlatformLogos max={7} size={30} />
      </div>
    </section>
  );
}

function managerItems(o: Opportunity, logos: Map<string, string | undefined>) {
  const names = o.managers?.length ? o.managers.map((m) => m.name) : [o.manager];
  return names.map((n) => ({ key: n, label: n, node: <Logo src={o.managers?.find((m) => m.name === n)?.logoUrl ?? logos.get(n) ?? o.protocolLogo} label={n} size={18} /> }));
}

/** Up to three small overlapping icons, then +N. */
function SmallStack({ items }: { items: { key: string; label: string; node: React.ReactNode }[] }) {
  const seen = new Set<string>();
  const uniq = items.filter((i) => (seen.has(i.label) ? false : (seen.add(i.label), true)));
  return (
    <span className="flex items-center" title={uniq.map((i) => i.label).join(", ")}>
      {uniq.slice(0, 3).map((i, k) => (
        <span key={i.key} className={`rounded-full ring-2 ring-card ${k ? "-ml-1" : ""}`}>{i.node}</span>
      ))}
      {uniq.length > 3 && <span className="ml-1 text-[11px] text-muted">+{uniq.length - 3}</span>}
    </span>
  );
}

function countBy<T>(list: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
