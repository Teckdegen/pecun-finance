"use client";

import { ArrowLeft, Calculator, ChevronRight, Copy, ExternalLink, Info, Leaf, ShieldCheck, Sparkles, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { History, Opportunity } from "@/lib/types.ts";
import { LineChart } from "./line-chart";
import { LendingLayout } from "./lending-layout";
import { MorphoLayout } from "./morpho-layout";
import { AddressPill, display, Logo, pct, short, usd, VaultMark } from "./ui";

type Win = "7d" | "30d" | "60d" | "90d";
const WINS: Win[] = ["7d", "30d", "60d", "90d"];
const DAYS: Record<Win, number> = { "7d": 7, "30d": 30, "60d": 60, "90d": 90 };
const BLANK = /^(—|-|–|n\/a|na|none|unknown|null)$/i;

const sliceWin = (s: [number, number][] | undefined, w: Win) => {
  if (!s?.length) return [];
  const cut = s[s.length - 1][0] - DAYS[w] * 86_400_000;
  return s.filter(([t]) => t >= cut);
};

const text = (v?: string | null) => {
  const s = v?.trim();
  if (!s || BLANK.test(s) || /^featured$/i.test(s)) return undefined;
  return s;
};

const detail = (o: Opportunity, label: string) => text(o.details?.find((d) => d.label.toLowerCase() === label.toLowerCase())?.value);

/** Curated vaults with a written dossier use the performance layout. Thinner markets use the overview layout. */
function isDossier(o: Opportunity) {
  return Boolean(
    text(o.description) ||
      o.integrations?.length ||
      o.capUsd ||
      o.instantExit ||
      o.ref?.source === "ember" ||
      detail(o, "Performance fee") ||
      detail(o, "Deployment date") ||
      detail(o, "Price updates"),
  );
}

function windowsFor(series: [number, number][] | undefined, averages?: History["averages"]) {
  const fromAvg = WINS.filter((w) => averages?.[w]);
  if (!series || series.length < 2) return fromAvg;
  const span = series[series.length - 1][0] - series[0][0];
  const fromSeries = WINS.filter((w) => span >= DAYS[w] * 86_400_000 * 0.5);
  const have = new Set([...fromAvg, ...fromSeries]);
  const list = WINS.filter((w) => have.has(w));
  return list.length ? list : (["30d"] as Win[]);
}

function useHistory(o: Opportunity) {
  const [history, setHistory] = useState<History>({});
  const [loading, setLoading] = useState(!!o.ref);
  useEffect(() => {
    if (!o.ref) return;
    let alive = true;
    fetch(`/api/history?slug=${encodeURIComponent(o.slug ?? "")}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((h: History) => alive && setHistory(h))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [o.ref, o.slug]);
  return { history, loading };
}

export function VaultView({ o, deployments }: { o: Opportunity; deployments: Opportunity[] }) {
  const { history, loading } = useHistory(o);
  const rich = isDossier(o);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <nav className="flex items-center gap-2 text-sm text-muted" aria-label="Breadcrumb">
          <Link href="/" aria-label="Back" className="grid size-7 place-items-center rounded-full bg-card hover:bg-card-2">
            <ArrowLeft className="size-4" />
          </Link>
          <Link href="/" className="hover:text-ink">Earn</Link>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-ink">{display(o)}</span>
        </nav>
        {o.ref?.source.startsWith("morpho") ? (
          <MorphoLayout o={o} history={history} loading={loading} />
        ) : o.kind === "Lending" && o.lending ? (
          <LendingLayout o={o} />
        ) : rich ? (
          <Dossier o={o} deployments={deployments} history={history} loading={loading} />
        ) : (
          <Overview o={o} deployments={deployments} history={history} loading={loading} />
        )}
        <section className="mt-10 text-xs leading-relaxed text-muted">
          <h3 className="text-sm font-semibold text-ink">Risk disclosure</h3>
          <p className="mt-2">
            This position is run by {o.manager === o.protocol ? o.protocol : `${o.manager} on ${o.protocol}`}, not by PECUN. PECUN lists it and will route
            your transaction; it does not manage the strategy or hold your funds. Risks include smart-contract bugs, oracle or pricing errors, strategy
            losses and assets losing their peg
            {text(o.redemption) && !/^instant/i.test(o.redemption) ? ` and delayed withdrawals (${o.redemption.toLowerCase()})` : ""}. APY is variable and
            past results do not guarantee future returns.
          </p>
        </section>
      </div>
      <DepositPanel o={o} />
      <PhoneDepositBar o={o} />
    </div>
  );
}

/** Phones: takes the tab bar's place on vault pages and jumps to the deposit panel. Hidden once the panel is on screen. */
function PhoneDepositBar({ o }: { o: Opportunity }) {
  const [panelVisible, setPanelVisible] = useState(false);
  useEffect(() => {
    const el = document.getElementById("deposit");
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPanelVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (panelVisible) return null;
  return (
    <div className="fixed inset-x-3 z-30 lg:hidden" style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}>
      <a href="#deposit" className="flex h-[60px] items-center justify-between rounded-full bg-ink pl-5 pr-2 text-white shadow-[0_12px_30px_rgba(20,30,60,0.3)]">
        <span className="text-sm">
          Earn <b className="tabular">{pct(o.apy30d ?? o.apy7d ?? o.apy)}</b> <span className="text-white/60">on {o.asset}</span>
        </span>
        <span className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink">Deposit</span>
      </a>
    </div>
  );
}

/* ---------------- Dossier: performance, reserves, vault facts ---------------- */

function Dossier({ o, deployments, history, loading }: { o: Opportunity; deployments: Opportunity[]; history: History; loading: boolean }) {
  const [statWin, setStatWin] = useState<Win>("30d");
  const [perfWin, setPerfWin] = useState<Win>("30d");
  const [tvlWin, setTvlWin] = useState<Win>("30d");
  const [spTab, setSpTab] = useState<"price" | "yield">("price");
  const [more, setMore] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcAmt, setCalcAmt] = useState("1000");

  const managers = o.managers?.length ? o.managers : o.manager ? [{ name: o.manager, logoUrl: o.protocolLogo }] : [];
  const description = text(o.description);
  const totalTvl = deployments.reduce((s, d) => s + d.tvlUsd, 0) || o.tvlUsd;
  const statOptions = WINS.filter((w) => history.averages?.[w] || (w === "7d" && o.apy7d != null) || (w === "30d" && o.apy30d != null));
  const statChoice = statOptions.includes(statWin) ? statWin : statOptions[0];
  const statApy = (statChoice && (history.averages?.[statChoice]?.total ?? (statChoice === "7d" ? o.apy7d : statChoice === "30d" ? o.apy30d : null))) || o.apy;

  const perfOptions = windowsFor(history.apy, history.averages);
  const perfChoice = perfOptions.includes(perfWin) ? perfWin : perfOptions[perfOptions.length - 1] ?? "30d";
  const perfSeries = useMemo(() => {
    const sliced = sliceWin(history.apy, perfChoice);
    return sliced.length >= 2 ? sliced : (history.apy?.length ?? 0) >= 2 ? history.apy! : [];
  }, [history.apy, perfChoice]);
  const perfApy = history.averages?.[perfChoice]?.total ?? (perfSeries.length ? perfSeries.reduce((s, p) => s + p[1], 0) / perfSeries.length : null);

  const tvlOptions = windowsFor(history.tvl);
  const tvlChoice = tvlOptions.includes(tvlWin) ? tvlWin : tvlOptions[tvlOptions.length - 1] ?? "30d";
  const tvlSeries = useMemo(() => {
    const sliced = sliceWin(history.tvl, tvlChoice);
    return sliced.length >= 2 ? sliced : (history.tvl?.length ?? 0) >= 2 ? history.tvl! : [];
  }, [history.tvl, tvlChoice]);

  const spSeries = (history.sharePrice?.length ?? 0) >= 2 ? history.sharePrice! : [];
  const yieldSeries: [number, number][] = spSeries.length ? spSeries.map(([t, v]) => [t, v / spSeries[0][1] - 1]) : [];
  const spLast = spSeries.at(-1)?.[1] ?? o.sharePrice;
  const spPrev = spSeries.length > 1 ? [...spSeries].reverse().find(([, v]) => v !== spSeries.at(-1)?.[1])?.[1] : undefined;
  const sinceUpdate = spLast !== undefined && spPrev ? spLast / spPrev - 1 : null;

  const perfFeeText = detail(o, "Performance fee");
  const perfFee = perfFeeText ? Number.parseFloat(perfFeeText) / 100 : 0;
  const reward = o.rewardApy && o.rewardApy > 0 ? o.rewardApy : 0;
  const depositYield = history.averages?.[perfChoice]?.deposit ?? null;
  const feeCost = depositYield !== null && perfFee > 0 ? -Math.max(0, depositYield) * perfFee : null;
  const afterFees = perfApy !== null && feeCost !== null ? perfApy + feeCost : perfApy;
  const showComposition = depositYield !== null || reward > 0 || feeCost !== null;
  const showChart = perfSeries.length >= 2 || (loading && !!o.ref);
  const showPerformance = showChart || showComposition;

  const showTvlCard = tvlSeries.length >= 2 || !!o.capUsd || (loading && !!o.ref);
  const showShareCard = spLast !== undefined || spSeries.length >= 2 || (loading && o.ref?.source === "ember");
  const showEarnings = showTvlCard || showShareCard;

  const reserves = history.reserves;
  const showTransparency = !!reserves?.groups.length || (loading && o.ref?.source === "ember");

  const facts = dossierFacts(o);
  const showOverview = !!description || !!o.integrations?.length;

  const nav = [
    showOverview ? { id: "overview", label: "Overview" } : null,
    showTransparency ? { id: "transparency", label: "Transparency" } : null,
    facts.length ? { id: "details", label: "Details" } : null,
  ].filter((x): x is { id: string; label: string } => !!x);

  const capPct = o.capUsd ? Math.min(1, totalTvl / o.capUsd) : null;
  const calcYear = (Number.parseFloat(calcAmt) || 0) * (afterFees ?? 0);

  return (
    <>
      <div className="mt-5 flex items-center gap-4">
        <VaultMark o={o} size={60} />
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight">{display(o)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {text(o.category) && <span className="text-xs text-muted">{text(o.category)}</span>}
            {managers.map((m) => (
              <Chip key={m.name} logo={m.logoUrl} label={m.name} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-x-16 gap-y-5">
        {statApy !== null && (
          <div>
            <div className="flex items-center gap-2 text-sm text-muted">
              Avg. APY
              {statOptions.length > 1 && statChoice && <Seg value={statChoice} options={statOptions} onChange={(v) => setStatWin(v as Win)} />}
            </div>
            <div className="tabular mt-1.5 text-[32px] font-semibold text-accent">{pct(statApy)}</div>
            {o.apyNote && <div className="mt-1 text-xs text-muted">{o.apyNote}</div>}
          </div>
        )}
        {totalTvl > 0 && (
          <div>
            <div className="text-sm text-muted">TVL</div>
            <div className="tabular mt-1.5 text-[32px] font-semibold">{usd(totalTvl)}</div>
          </div>
        )}
        {o.sharePrice !== undefined && (
          <div>
            <div className="text-sm text-muted">Share price</div>
            <div className="tabular mt-1.5 text-[32px] font-semibold">{formatShare(o.sharePrice)}</div>
          </div>
        )}
      </div>

      <SectionNav items={nav} />

      {showOverview && (
        <section id="overview" className="scroll-mt-6 pt-5">
          {description && (
            <>
              <p className={`max-w-3xl text-sm leading-relaxed text-ink/80 ${more ? "" : "line-clamp-2"}`}>{description}</p>
              {description.length > 170 && (
                <button onClick={() => setMore((m) => !m)} className="mt-2 text-sm font-medium underline underline-offset-4">
                  {more ? "Show less" : "Show more"}
                </button>
              )}
            </>
          )}
          <div className={`flex flex-wrap gap-10 text-sm ${description ? "mt-6" : ""}`}>
            {!!o.integrations?.length && (
              <div>
                <div className="text-xs text-muted">Integrations</div>
                <div className="mt-2 flex rounded-full border border-line bg-card px-2 py-1">
                  {o.integrations.slice(0, 5).map((i, k) => (
                    <span key={i.name + k} className={k ? "-ml-1" : ""}>
                      <Logo src={i.logoUrl} label={i.name} size={18} ring title={i.name} />
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {showPerformance && (
        <>
          <h2 className="mt-12 text-lg font-semibold">Vault performance</h2>
          <section className={`mt-4 grid gap-5 rounded-[22px] bg-card p-5 ${showChart && showComposition ? "md:grid-cols-[minmax(0,1.5fr)_minmax(240px,1fr)]" : ""}`}>
            {showChart && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-muted">
                    <Leaf className="size-4" /> Performance
                  </span>
                  {perfOptions.length > 1 && <Seg value={perfChoice} options={perfOptions} onChange={(v) => setPerfWin(v as Win)} />}
                </div>
                {perfApy !== null && <div className="tabular mt-3 text-2xl font-semibold">{pct(perfApy)}</div>}
                {perfSeries.length >= 2 && <div className="text-xs text-muted">{DAYS[perfChoice]} day avg. APY</div>}
                <div className="mt-3">
                  <LineChart data={perfSeries} format={(v) => pct(v)} height={180} color="var(--accent)" loading={loading && perfSeries.length < 2} />
                </div>
              </div>
            )}
            {showComposition && (
              <div className="flex flex-col text-sm">
                <div className="font-medium">Yield composition</div>
                <dl className="mt-3 grid gap-2.5">
                  {depositYield !== null && <Line icon={<Leaf className="size-3.5" />} label="Deposit yield" value={pct(depositYield)} tone="pos" />}
                  {reward > 0 && <Line icon={<Sparkles className="size-3.5" />} label="Rewards" value={pct(reward)} />}
                  {feeCost !== null && perfFeeText && (
                    <Line icon={<TrendingUp className="size-3.5" />} label={`Performance fee (${perfFeeText})`} value={pct(feeCost)} />
                  )}
                </dl>
                {afterFees !== null && (
                  <>
                    <div className="my-3 border-t border-line" />
                    <Line icon={<Sparkles className="size-3.5" />} label="APY after fees" value={pct(afterFees)} strong />
                  </>
                )}
                {afterFees !== null && (
                  <button onClick={() => setCalcOpen((c) => !c)} className="mt-4 flex h-9 items-center justify-center gap-2 rounded-xl bg-card-2 text-sm font-medium hover:bg-line">
                    <Calculator className="size-4" /> Estimate earnings
                  </button>
                )}
                {calcOpen && afterFees !== null && (
                  <div className="mt-3 rounded-xl border border-line p-3">
                    <label htmlFor="calc" className="text-xs text-muted">Deposit (USD)</label>
                    <input
                      id="calc"
                      inputMode="decimal"
                      value={calcAmt}
                      onChange={(e) => setCalcAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                      className="mt-1 h-9 w-full rounded-lg border border-line bg-card-2 px-3 text-sm focus:outline-none"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-muted">Per month</div>
                        <div className="tabular text-sm font-medium">{usd(calcYear / 12)}</div>
                      </div>
                      <div>
                        <div className="text-muted">Per year</div>
                        <div className="tabular text-sm font-medium">{usd(calcYear)}</div>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-muted">At the current APY after fees. APY changes, so this is an estimate.</p>
                  </div>
                )}
                {depositYield !== null && (
                  <p className="mt-auto pt-4 text-[11px] leading-relaxed text-muted">Deposit yield is the change in share value over the window. Fees apply to deposit yield only.</p>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {showEarnings && (
        <>
          <h2 className="mt-12 text-lg font-semibold">{showShareCard && showTvlCard ? "TVL and earnings" : showShareCard ? "Share price" : "TVL"}</h2>
          <section className={`mt-4 grid gap-4 ${showTvlCard && showShareCard ? "md:grid-cols-2" : ""}`}>
            {showTvlCard && (
              <div className="rounded-[22px] bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-muted">
                    <ShieldCheck className="size-4" /> TVL
                  </span>
                  {tvlSeries.length >= 2 && tvlOptions.length > 1 && <Seg value={tvlChoice} options={tvlOptions} onChange={(v) => setTvlWin(v as Win)} />}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  {capPct !== null && <Ring pct={capPct} />}
                  <div>
                    <div className="tabular text-2xl font-semibold">{usd(totalTvl)}</div>
                    {o.capUsd && <div className="text-xs text-muted">Out of {usd(o.capUsd)} cap</div>}
                  </div>
                </div>
                {(tvlSeries.length >= 2 || loading) && (
                  <div className="mt-4">
                    <Bars data={tvlSeries} loading={loading && tvlSeries.length < 2} />
                  </div>
                )}
              </div>
            )}
            {showShareCard && (
              <div className="rounded-[22px] bg-card p-5">
                {spSeries.length >= 2 && (
                  <div className="flex rounded-full bg-card-2 p-0.5 text-xs" style={{ width: "fit-content" }}>
                    {(
                      [
                        ["price", "Share price"],
                        ["yield", "Yield earned"],
                      ] as const
                    ).map(([k, l]) => (
                      <button key={k} onClick={() => setSpTab(k)} className={`h-7 rounded-full px-3 ${spTab === k ? "bg-card font-medium shadow-sm" : "text-muted"}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                )}
                {spLast !== undefined && (spTab === "price" || spSeries.length < 2) && (
                  <div className={`tabular text-2xl font-semibold ${spSeries.length >= 2 ? "mt-4" : ""}`}>{formatShare(spLast)}</div>
                )}
                {spTab === "yield" && spSeries.length >= 2 && yieldSeries.at(-1) && (
                  <div className="tabular mt-4 text-2xl font-semibold">{pct(yieldSeries.at(-1)![1])}</div>
                )}
                {(spLast !== undefined || (spTab === "yield" && spSeries.length >= 2)) && (
                  <div className="text-xs">
                    {spTab === "price" && sinceUpdate !== null ? (
                      <span className={sinceUpdate >= 0 ? "text-mint" : "text-neg"}>
                        {sinceUpdate >= 0 ? "+" : ""}
                        {(sinceUpdate * 100).toFixed(4)}% <span className="text-muted">· since last update</span>
                      </span>
                    ) : (
                      <span className="text-muted">{spTab === "yield" && spSeries.length >= 2 ? "Since the start of the chart" : "Value of one share"}</span>
                    )}
                  </div>
                )}
                {spSeries.length >= 2 && (
                  <div className="mt-3">
                    <LineChart
                      data={spTab === "price" ? spSeries : yieldSeries}
                      format={(v) => (spTab === "price" ? formatShare(v) : pct(v))}
                      height={170}
                      color="var(--accent)"
                      loading={loading && spSeries.length < 2}
                    />
                  </div>
                )}
                {loading && spSeries.length < 2 && o.ref?.source === "ember" && <div className="mt-3"><LineChart data={[]} format={(v) => formatShare(v)} height={170} loading /></div>}
              </div>
            )}
          </section>
        </>
      )}

      {showTransparency && <Transparency o={o} history={history} loading={loading} deployments={[]} totalTvl={totalTvl} />}

      {facts.length > 0 && (
        <>
          <h2 id="details" className="mt-12 scroll-mt-6 text-lg font-semibold">Vault details</h2>
          <FactGrid rows={facts} />
        </>
      )}
    </>
  );
}

function dossierFacts(o: Opportunity): { label: string; value: ReactNode }[] {
  const managers = o.managers?.length ? o.managers : o.manager ? [{ name: o.manager, logoUrl: o.protocolLogo }] : [];
  const rows: { label: string; value: ReactNode }[] = [];
  const used = new Set<string>();
  const add = (label: string, value: ReactNode | undefined) => {
    if (value === undefined || value === null || value === false || value === "") return;
    used.add(label.toLowerCase());
    rows.push({ label, value });
  };
  if (o.address) add("Vault ID", <AddressPill address={o.address} chain={o.chain} />);
  const vaultType = text(detail(o, "Vault type"));
  if (vaultType && !/^(lending|vault|liquidity|fixed yield|liquid staking|perp vault)$/i.test(vaultType)) add("Vault type", vaultType);
  used.add("vault type");
  add("Deployment date", detail(o, "Deployment date"));
  used.add("deployment date");
  const strategy = [detail(o, "Strategy"), text(o.category)].find((s) => s && !/^(lending|vault|liquidity|fixed yield|liquid staking|perp vault)$/i.test(s));
  add("Strategy", strategy);
  used.add("strategy");
  add("Performance fee", detail(o, "Performance fee"));
  used.add("performance fee");
  add("Management fee", detail(o, "Management fee"));
  used.add("management fee");
  if (text(o.redemption)) add("Withdrawal", o.redemption);
  used.add("withdrawal duration");
  if (managers.length) {
    add(
      "Manager",
      <span className="flex flex-wrap justify-end gap-1.5">
        {managers.map((m) => (
          <Chip key={m.name} logo={m.logoUrl} label={m.name} />
        ))}
      </span>,
    );
  }
  if (text(o.asset) && o.asset !== "?") add("Deposit asset", <Chip logo={o.assetLogo} label={o.asset} />);
  used.add("deposit asset");
  if (o.ticker) add("Vault token", <Chip logo={o.logoUrl} label={o.ticker} />);
  used.add("vault token");
  add("Price updates", detail(o, "Price updates"));
  used.add("price updates");
  add("Yield type", detail(o, "Yield type"));
  used.add("yield type");
  add("Protocol", <Chip logo={o.protocolLogo} label={o.protocol} />);
  for (const x of o.details ?? []) {
    if (used.has(x.label.toLowerCase())) continue;
    const value = text(x.value);
    if (value) add(x.label, value);
  }
  return rows;
}

/* ---------------- Overview: composition, charts, allocation ---------------- */

function Overview({ o, deployments, history, loading }: { o: Opportunity; deployments: Opportunity[]; history: History; loading: boolean }) {
  const [apyWin, setApyWin] = useState<Win>("30d");
  const [tvlWin, setTvlWin] = useState<Win>("30d");
  const totalTvl = deployments.reduce((s, d) => s + d.tvlUsd, 0) || o.tvlUsd;
  const facts = overviewFacts(o);
  const apyOptions = windowsFor(history.apy);
  const apyChoice = apyOptions.includes(apyWin) ? apyWin : apyOptions[apyOptions.length - 1] ?? "30d";
  const apySeries = useMemo(() => {
    const sliced = sliceWin(history.apy, apyChoice);
    return sliced.length >= 2 ? sliced : (history.apy?.length ?? 0) >= 2 ? history.apy! : [];
  }, [history.apy, apyChoice]);
  const tvlOptions = windowsFor(history.tvl);
  const tvlChoice = tvlOptions.includes(tvlWin) ? tvlWin : tvlOptions[tvlOptions.length - 1] ?? "30d";
  const tvlSeries = useMemo(() => {
    const sliced = sliceWin(history.tvl, tvlChoice);
    return sliced.length >= 2 ? sliced : (history.tvl?.length ?? 0) >= 2 ? history.tvl! : [];
  }, [history.tvl, tvlChoice]);

  const showApyChart = apySeries.length >= 2 || (loading && !!o.ref);
  const showTvlChart = tvlSeries.length >= 2 || (loading && !!o.ref);
  const allocation = allocationRows(history);
  const showAllocation = allocation.length > 0 || (loading && !!o.ref && (o.ref.source === "ember" || o.ref.source.startsWith("morpho")));
  const description = text(o.description);
  const nav = [
    facts.length || showTvlChart || showApyChart ? { id: "overview", label: "Overview" } : null,
    showAllocation ? { id: "allocation", label: "Allocation" } : null,
  ].filter((x): x is { id: string; label: string } => !!x);

  const factsTitle = o.kind === "Lending" ? "Market" : o.kind === "Fixed yield" || o.kind === "Liquidity" ? "Terms" : o.kind === "Liquid staking" || o.kind === "Perp vault" ? "Position" : "Vault composition";
  const headlineApy = o.apy30d ?? o.apy7d ?? o.apy;
  const liquidity = detail(o, "Available liquidity");
  const yieldWindows = (
    [
      o.apy != null ? ["Current", o.apy] : null,
      o.apy7d != null ? ["7 day", o.apy7d] : null,
      o.apy30d != null ? ["30 day", o.apy30d] : null,
    ] as ([string, number] | null)[]
  ).filter((x): x is [string, number] => !!x);

  return (
    <>
      <div className="mt-5 flex items-center gap-4">
        <VaultMark o={o} size={52} />
        <div className="min-w-0">
          <h1 className="truncate text-[32px] font-semibold leading-tight tracking-tight">{display(o)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {text(o.asset) && o.asset !== "?" && <Chip logo={o.assetLogo} label={o.asset} />}
            <Chip logo={o.protocolLogo} label={o.protocol} />
            {o.manager && o.manager !== o.protocol && <Chip logo={o.managers?.[0]?.logoUrl} label={o.manager} />}
          </div>
        </div>
      </div>

      {description && <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>}

      <div className="mt-7 flex flex-wrap gap-x-14 gap-y-5">
        {totalTvl > 0 && (
          <div>
            <div className="text-sm text-muted">Total value</div>
            <div className="tabular mt-1 text-[32px] font-semibold">{usd(totalTvl)}</div>
          </div>
        )}
        {liquidity && (
          <div>
            <div className="text-sm text-muted">Available liquidity</div>
            <div className="tabular mt-1 text-[32px] font-semibold">{liquidity.replace(/^\$/, "$")}</div>
          </div>
        )}
        {o.sharePrice !== undefined && (
          <div>
            <div className="text-sm text-muted">Share price</div>
            <div className="tabular mt-1 text-[32px] font-semibold">{formatShare(o.sharePrice)}</div>
          </div>
        )}
        {headlineApy !== null && (
          <div>
            <div className="text-sm text-muted">APY</div>
            <div className="tabular mt-1 text-[32px] font-semibold text-accent">{pct(headlineApy)}</div>
            {o.apyNote && <div className="mt-1 text-xs text-muted">{o.apyNote}</div>}
          </div>
        )}
      </div>

      <SectionNav items={nav} />

      {(facts.length > 0 || yieldWindows.length > 1 || showTvlChart || showApyChart) && (
        <section id="overview" className="scroll-mt-6 pt-8">
          <h2 className="text-lg font-semibold">Overview</h2>
          {yieldWindows.length > 1 && (
            <div className="mt-4 rounded-[22px] bg-card p-5">
              <div className="text-sm font-medium">Yield</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {yieldWindows.map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs text-muted">{label}</div>
                    <div className="tabular mt-1 text-2xl font-semibold text-accent">{pct(value)}</div>
                  </div>
                ))}
              </div>
              {o.apyNote && <p className="mt-3 text-xs text-muted">{o.apyNote}</p>}
            </div>
          )}

          {facts.length > 0 && (
            <div className="mt-4 rounded-[22px] bg-card p-5">
              <div className="text-sm font-medium">{factsTitle}</div>
              <dl className="mt-2">
                {facts.map((f) => (
                  <div key={f.label} className="flex items-center justify-between gap-4 border-b border-line py-3 text-sm last:border-0">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className="min-w-0 text-right font-medium">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {showTvlChart && (
            <div className="mt-4 rounded-[22px] bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted">Total value</div>
                  {totalTvl > 0 && <div className="tabular mt-1 text-2xl font-semibold">{usd(totalTvl)}</div>}
                </div>
                {tvlSeries.length >= 2 && tvlOptions.length > 1 && <Seg value={tvlChoice} options={tvlOptions} onChange={(v) => setTvlWin(v as Win)} />}
              </div>
              <div className="mt-3">
                <LineChart data={tvlSeries} format={(v) => usd(v)} height={200} color="var(--accent)" loading={loading && tvlSeries.length < 2} />
              </div>
            </div>
          )}

          {showApyChart && (
            <div className="mt-4 rounded-[22px] bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted">APY</div>
                  {headlineApy !== null && <div className="tabular mt-1 text-2xl font-semibold">{pct(headlineApy)}</div>}
                </div>
                {apySeries.length >= 2 && apyOptions.length > 1 && <Seg value={apyChoice} options={apyOptions} onChange={(v) => setApyWin(v as Win)} />}
              </div>
              <div className="mt-3">
                <LineChart data={apySeries} format={(v) => pct(v)} height={180} color="var(--accent)" loading={loading && apySeries.length < 2} />
              </div>
            </div>
          )}
        </section>
      )}

      {showAllocation && (
        <section id="allocation" className="scroll-mt-6 pt-8">
          <h2 className="text-lg font-semibold">Allocation</h2>
          {allocation.length > 0 ? <AllocationTable rows={allocation} /> : <div className="mt-4 h-40 animate-pulse rounded-[22px] bg-card" />}
        </section>
      )}
    </>
  );
}

function overviewFacts(o: Opportunity) {
  const rows: { label: string; value: ReactNode }[] = [];
  const used = new Set<string>();
  const add = (label: string, value: ReactNode | undefined) => {
    if (value === undefined || value === null || value === false || value === "") return;
    used.add(label.toLowerCase());
    rows.push({ label, value });
  };
  used.add("deposit asset");
  used.add("loan asset");
  used.add("available liquidity");
  used.add("chain");
  used.add("protocol");
  used.add("type");
  used.add("vault type");
  if (o.ticker) add("Vault token", <Chip logo={o.logoUrl} label={o.ticker} />);
  used.add("vault token");
  used.add("token");
  if (o.manager && o.manager !== o.protocol) add("Manager", o.manager);
  if (text(o.redemption)) add("Redemption", o.redemption);
  add("Address", o.address ? <AddressPill address={o.address} chain={o.chain} /> : undefined);
  used.add("mint");
  for (const x of o.details ?? []) {
    if (used.has(x.label.toLowerCase())) continue;
    const value = text(x.value);
    if (!value || value === o.asset || value === o.chain || value === o.protocol) continue;
    add(x.label, x.label.toLowerCase() === "mint" || x.label.toLowerCase() === "address" ? <AddressPill address={value} chain={o.chain} /> : value);
  }
  return rows;
}

type AllocRow = { key: string; asset: string; protocol?: string; pct?: number; usd?: number; url?: string; logo?: string };

function allocationRows(history: History): AllocRow[] {
  const reserves = history.reserves;
  if (reserves?.groups.length) {
    return reserves.groups.flatMap((g, gi) =>
      g.rows
        .filter((r) => r.usd > 0 || r.pct > 0)
        .map((r, i) => ({
          key: `${gi}-${i}-${r.asset}`,
          asset: r.asset,
          protocol: r.protocol,
          pct: r.pct,
          usd: r.usd,
          url: r.url,
          logo: undefined,
        })),
    );
  }
  return [];
}

function formatAllocPct(p: number) {
  const n = p * 100;
  if (n > 0 && n < 0.01) return "<0.01%";
  return `${n.toFixed(n >= 10 ? 1 : 2)}%`;
}

function AllocationTable({ rows }: { rows: AllocRow[] }) {
  const hasProtocol = rows.some((r) => r.protocol && r.protocol !== r.asset);
  const hasPct = rows.some((r) => r.pct !== undefined);
  const hasUsd = rows.some((r) => r.usd !== undefined && r.usd > 0);
  return (
    <div className="mt-4 overflow-x-auto rounded-[22px] bg-card">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="px-5 py-3 font-medium">Asset</th>
            {hasProtocol && <th className="px-3 py-3 font-medium">Protocol</th>}
            {hasPct && <th className="px-3 py-3 font-medium">Allocation</th>}
            {hasUsd && <th className="px-5 py-3 text-right font-medium">Value</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="px-5 py-3">
                <span className="flex items-center gap-2 font-medium">
                  <Logo src={r.logo} label={r.asset} size={18} />
                  {r.asset}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" aria-label={`View ${r.asset}`} className="text-muted hover:text-ink">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </span>
              </td>
              {hasProtocol && <td className="px-3 py-3 text-muted">{r.protocol}</td>}
              {hasPct && <td className="tabular px-3 py-3">{r.pct !== undefined ? formatAllocPct(r.pct) : ""}</td>}
              {hasUsd && <td className="tabular px-5 py-3 text-right font-medium">{r.usd !== undefined ? usd(r.usd) : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Transparency({ o, history, loading, deployments, totalTvl }: { o: Opportunity; history: History; loading: boolean; deployments: Opportunity[]; totalTvl: number }) {
  const r = history.reserves;
  const total = r ? r.totalUsd : totalTvl;
  const slices = (r
    ? r.groups.map((g) => ({ label: g.label, value: g.rows.reduce((s, x) => s + x.usd, 0), logo: g.logoUrl }))
    : deployments.map((d) => ({ label: d.chain, value: d.tvlUsd, logo: d.chainLogo }))
  ).filter((s) => s.value > 0 && total > 0 && s.value / total >= 0.005);
  const rows = r?.groups.flatMap((g) => g.rows).filter((x) => x.usd > 0).slice(0, 4) ?? [];
  if (!loading && slices.length === 0) return null;
  return (
    <>
      <h2 id="transparency" className="mt-12 scroll-mt-6 text-lg font-semibold">Transparency</h2>
      <section className="mt-4 grid gap-6 rounded-[22px] bg-card p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <ShieldCheck className="size-4" /> {r || loading ? "Proof of reserves" : "Where funds sit"}
          </div>
          {r ? (
            <p className="mt-3 text-[15px] leading-relaxed">
              Vault capital is tracked across its accounts and protocol positions. Wallets tied to this vault are listed with an explorer link.
            </p>
          ) : loading ? (
            <div className="mt-4 h-24 animate-pulse rounded-xl bg-card-2" />
          ) : (
            <p className="mt-3 text-[15px] leading-relaxed">Deposits sit in {o.protocol} on {deployments.map((d) => d.chain).join(", ")}.</p>
          )}
          {rows.length > 0 && (
            <ul className="mt-4 grid gap-1.5 text-xs">
              {rows.map((x, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-card-2 px-2.5 py-1.5">
                  <span className="truncate">
                    {x.asset} · {x.protocol}
                  </span>
                  <span className="tabular shrink-0 text-muted">
                    {usd(x.usd)}
                    {x.url && (
                      <a href={x.url} target="_blank" rel="noreferrer" aria-label="View on explorer" className="ml-1.5 inline-flex align-middle text-ink">
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {loading && !r && <div className="mt-4 h-16 animate-pulse rounded-xl bg-card-2" />}
        </div>
        {slices.length > 0 && (
          <div className="flex flex-wrap items-center gap-6 md:border-l md:border-line md:pl-6">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">Total value locked</div>
              {total > 0 && <div className="tabular mt-1 text-[28px] font-semibold">{usd(total)}</div>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {slices.map((s) => (
                  <span key={s.label} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
                    {s.logo && <Logo src={s.logo} label={s.label} size={12} />} {s.label}
                    {total > 0 && <b className="tabular font-medium">{Math.round((s.value / total) * 100)}%</b>}
                  </span>
                ))}
              </div>
              {r && <p className="mt-3 text-[11px] text-faint">Updated {new Date(r.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>}
            </div>
            <Donut slices={slices} total={total} />
          </div>
        )}
      </section>
    </>
  );
}

/* ---------------- Deposit / withdraw only ---------------- */

function DepositPanel({ o }: { o: Opportunity }) {
  const [side, setSide] = useState<"deposit" | "withdraw">("deposit");
  const [instant, setInstant] = useState(false);
  const apy = o.apy30d ?? o.apy7d ?? o.apy;
  const exit = side === "withdraw" && instant ? o.instantExit : undefined;
  return (
    <aside id="deposit" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-[22px] bg-card p-4">
        <div className="flex rounded-full bg-card-2 p-0.5 text-sm" style={{ width: "fit-content" }}>
          {(["deposit", "withdraw"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setSide(t);
                if (t === "deposit") setInstant(false);
              }}
              className={`h-8 rounded-full px-4 capitalize ${side === t ? "bg-card font-medium shadow-sm" : "text-muted"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {text(o.redemption) && o.redemption !== "Instant" && !exit && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-card-2 px-3 py-2 text-xs">
            <Info className="size-3.5 shrink-0 text-muted" /> Withdrawals: <b className="font-medium">{o.redemption}</b>
          </div>
        )}
        <div className="mt-3 rounded-2xl border border-line p-4">
          <div className="text-xs text-muted">{side === "deposit" ? "Deposit" : "Withdraw"}</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <input id="amount" inputMode="decimal" placeholder="0" disabled className="w-1/2 bg-transparent text-3xl text-faint outline-none" />
            <span className="flex items-center gap-1.5 text-base font-semibold">
              <Logo src={side === "deposit" ? o.assetLogo : o.logoUrl ?? o.assetLogo} label={o.asset} size={22} />
              {side === "deposit" ? o.asset : (o.ticker ?? o.asset)}
            </span>
          </div>
        </div>
        {side === "withdraw" && o.instantExit && (
          <div className="mt-3 rounded-2xl border border-line p-3 text-xs">
            <button
              type="button"
              role="switch"
              aria-checked={instant}
              onClick={() => setInstant((v) => !v)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="text-sm font-medium">Instant exit</span>
              <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${instant ? "bg-ink" : "bg-line"}`} aria-hidden>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white transition ${instant ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
            {instant ? (
              <>
                <p className="mt-2 leading-relaxed text-ink/80">
                  Get <b>{Math.round(o.instantExit.instantPct * 100)}%</b> now via {o.instantExit.via}, instead of waiting {o.instantExit.settlement.toLowerCase()}. The rest is released when the vault finishes processing.
                </p>
                <dl className={`mt-2 grid gap-2 ${o.instantExit.capacityUsd > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
                  <div>
                    <dt className="text-muted">Paid now</dt>
                    <dd className="tabular font-medium">{Math.round(o.instantExit.instantPct * 100)}%</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Fee</dt>
                    <dd className="tabular font-medium">{(o.instantExit.feePct * 100).toFixed(2)}%</dd>
                  </div>
                  {o.instantExit.capacityUsd > 0 && (
                    <div>
                      <dt className="text-muted">Capacity</dt>
                      <dd className="tabular font-medium">{usd(o.instantExit.capacityUsd)}</dd>
                    </div>
                  )}
                </dl>
              </>
            ) : (
              <p className="mt-2 leading-relaxed text-muted">Off. You wait out the vault schedule{text(o.redemption) ? ` (${o.redemption.toLowerCase()})` : ""}.</p>
            )}
          </div>
        )}
        <button disabled className="mt-3 h-11 w-full cursor-not-allowed rounded-xl bg-card-2 text-sm font-medium text-muted">
          Enter amount
        </button>
        <dl className="mt-4 grid gap-2.5 text-sm">
          {apy !== null && <Line label="APY" value={pct(apy)} accent />}
          {exit ? <Line label="Withdrawal" value={`Instant via ${exit.via}`} /> : text(o.redemption) ? <Line label="Withdrawal" value={o.redemption} /> : null}
        </dl>
        <p className="mt-4 border-t border-line pt-3 text-center text-[11px] text-muted">
          <Wallet className="mr-1 inline size-3" /> Deposits open with the execution release. You&apos;ll confirm the protocol&apos;s terms and risks before signing.
        </p>
      </div>
    </aside>
  );
}

/* ---------------- small pieces ---------------- */

function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  useEffect(() => {
    if (!items.some((i) => i.id === active)) setActive(items[0]?.id ?? "");
  }, [items, active]);
  if (items.length < 2) return null;
  return (
    <nav className="mt-7 flex gap-6 border-b border-line text-sm">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={() => setActive(item.id)}
          className={`-mb-px border-b-2 pb-2.5 ${active === item.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

function FactGrid({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  const mid = Math.ceil(rows.length / 2);
  const cols = rows.length > 3 ? [rows.slice(0, mid), rows.slice(mid)] : [rows];
  return (
    <section className={`mt-4 grid gap-x-10 ${cols.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {cols.map((col, ci) => (
        <dl key={ci}>
          {col.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 border-b border-line py-3 text-sm">
              <dt className="text-muted">{row.label}</dt>
              <dd className="min-w-0 text-right font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      ))}
    </section>
  );
}

function Seg({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <span className="inline-flex rounded-full bg-card-2 p-0.5 text-xs">
      {options.map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          aria-pressed={value === w}
          className={`h-6 rounded-full px-2.5 ${value === w ? "bg-card font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {w.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

function Chip({ logo, label }: { logo?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2 py-0.5 text-xs font-medium">
      <Logo src={logo} label={label} size={14} /> {label}
    </span>
  );
}

function Line({ label, value, icon, tone, strong, accent }: { label: string; value: ReactNode; icon?: ReactNode; tone?: "pos"; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="flex items-center gap-1.5 text-muted">
        {icon}
        {label}
      </dt>
      <dd className={`tabular text-right ${strong ? "font-semibold" : "font-medium"} ${tone === "pos" ? "text-mint" : accent ? "text-accent" : ""}`}>{value}</dd>
    </div>
  );
}

function Ring({ pct: p }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 44 44" className="size-12 shrink-0" role="img" aria-label={`${Math.round(p * 100)}% of cap`}>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 22 22)" />
      <text x="22" y="25.5" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--ink)">
        {Math.round(p * 100)}%
      </text>
    </svg>
  );
}

function Bars({ data, loading }: { data: [number, number][]; loading: boolean }) {
  if (data.length < 2) return loading ? <div className="h-40 animate-pulse rounded-xl bg-card-2" /> : null;
  const step = Math.ceil(data.length / 14);
  const pts = data.filter((_, i) => i % step === 0 || i === data.length - 1);
  const max = Math.max(...pts.map((p) => p[1]));
  if (!(max > 0)) return null;
  const fmt = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5">
        {pts.map(([t, v]) => (
          <div key={t} title={`${fmt(t)} · ${usd(v)}`} className="flex-1 rounded-t-md bg-ink/80 transition hover:bg-accent" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{fmt(pts[0][0])}</span>
        <span>{fmt(pts[pts.length - 1][0])}</span>
      </div>
    </div>
  );
}

const DONUT_COLORS = ["var(--ink)", "#7c5cf0", "#12976b", "#f0b45a", "#e2622e", "#8a90a2"];
function Donut({ slices, total }: { slices: { label: string; value: number }[]; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img" aria-label="Breakdown of value locked">
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--card-2)" strokeWidth="18" />
      {slices.map((s, i) => {
        const frac = total ? s.value / total : 0;
        const el = (
          <circle
            key={s.label}
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
            strokeWidth="18"
            strokeDasharray={`${Math.max(0, c * frac - (slices.length > 1 ? 2 : 0))} ${c}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
          />
        );
        offset += c * frac;
        return el;
      })}
      {total > 0 && (
        <text x="70" y="74" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">
          {usd(total)}
        </text>
      )}
    </svg>
  );
}


function formatShare(n: number) {
  if (!Number.isFinite(n)) return "";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toFixed(4);
}
