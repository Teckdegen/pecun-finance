"use client";

import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUpRight,
  CalendarClock,
  Check,
  Clock,
  Coins,
  Leaf,
  PieChart,
  Search,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Logo, PecunMark } from "@/components/logo";
import { DOCS_URL, PARTNERS } from "@/lib/site";

export type StartRow = {
  name: string;
  protocol: string;
  asset: string;
  apy: number;
  redemption?: string;
  logo?: string;
  assetLogo?: string;
};

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/**
 * Cycles 0..n-1 every `ms` while `ref` is on screen. Stops when it scrolls away or the tab is hidden,
 * so the cards off screen don't keep re-rendering. Paused for reduced motion.
 */
function useTicker(n: number, ms: number, ref: RefObject<HTMLElement | null>) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (n < 2 || !el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id: number | undefined;
    const stop = () => {
      if (id) window.clearInterval(id);
      id = undefined;
    };
    const io = new IntersectionObserver(([e]) => {
      stop();
      if (e.isIntersecting) id = window.setInterval(() => !document.hidden && setI((x) => (x + 1) % n), ms);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, [n, ms, ref]);
  return i;
}

/**
 * Find, deposit, earn. Each one is two full screens: a big headline on its own, then three cards roll up over it,
 * each card with words on top and a graphic under them. Every screen stacks over the one before.
 */
export function GetStarted({ rows, lead = rows[0], children }: { rows: StartRow[]; lead?: StartRow; children?: ReactNode }) {
  const shown = rows.slice(0, 4);
  return (
    <div>
      {/* Anchors for the header links. Plain blocks in the flow, so a jump lands where each screen starts. */}
      <span id="explore" className="block" />
      <Headline z="z-10">
        Find the best rate,
        <br />
        <LogoCluster marks={PLATFORM_MARKS} /> in one list.
      </Headline>
      <CardScreen z="z-20" icon={Search} label="Explore">
        <PlatformsCard rows={shown} />
        <SortCard rows={shown} />
        <OpenCard rows={shown} />
      </CardScreen>
      <Hold />

      {lead && (
        <>
          <span id="deposit" className="block" />
          <Headline z="z-30">
            Deposit <LogoCluster marks={DEPOSIT_MARKS} />
            <br />
            in one tap.
          </Headline>
          <CardScreen z="z-40" icon={ArrowDownToLine} label="Deposit">
            <DepositCard lead={lead} />
            <FeesCard lead={lead} />
            <EstimateCard lead={lead} />
          </CardScreen>
          <Hold />

          <span id="earn" className="block" />
          <Headline z="z-50">
            Earn <LogoCluster marks={YIELD_MARKS} />
            <br />
            on every deposit.
          </Headline>
          <CardScreen z="z-[60]" icon={Coins} label="Earn">
            <PortfolioCard lead={lead} />
            <ActivityCard lead={lead} />
            <WithdrawCard lead={lead} />
          </CardScreen>
          <Hold />
        </>
      )}

      <span id="fund" className="block" />
      <Headline z="z-[62]">
        Every $PEN trade
        <br />
        grows the <FundTile /> Fund.
      </Headline>
      <CardScreen z="z-[64]" icon={PieChart} label="Pecun Fund">
        <FundTaxCard />
        <FundAllocationCard />
        <FundShareCard />
      </CardScreen>
      <Hold />

      <span id="faq" className="block" />
      {children}
    </div>
  );
}

/* ---------- screen pieces ---------- */

/** Keeps the cards in view for half a screen before the next screen rolls over them. */
function Hold() {
  return <div aria-hidden className="h-[50dvh]" />;
}

function Headline({ z, children }: { z: string; children: ReactNode }) {
  return (
    <section
      className={`sticky top-0 flex h-[100dvh] flex-col items-center justify-center rounded-t-[2rem] bg-[#f5f8ef] px-4 text-center text-ink shadow-[0_-12px_32px_rgba(10,10,10,0.08)] ${z}`}
    >
      <h2 className="max-w-5xl text-[2.6rem] font-medium leading-[1.1] tracking-[-0.045em] sm:text-[4rem] lg:text-[5.75rem]">{children}</h2>
    </section>
  );
}

const tw = (path: string) => `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${path}/logo.png`;
type Mark = { name: string; logo: string };
const pick = (names: string[]): Mark[] => names.map((n) => PARTNERS.find((p) => p.name === n)).filter((p): p is Mark => !!p);

/** Well-known platforms, for "find". */
const PLATFORM_MARKS = pick(["Aave", "Lido", "Pendle"]);
/** What you deposit with. */
const DEPOSIT_MARKS: Mark[] = [
  { name: "USDG", logo: tw("ethereum/assets/0xe343167631d89B6Ffc58B88d6b7fB0228795491D") },
  { name: "ETH", logo: tw("ethereum/info") },
];
/** The vault tokens you hold while earning: Lido stETH, Ethena sUSDe, JitoSOL. */
const YIELD_MARKS: Mark[] = [
  { name: "stETH", logo: tw("ethereum/assets/0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84") },
  { name: "sUSDe", logo: tw("ethereum/assets/0x9D39A5DE30e57443BfF2A8307A4256c8797A3497") },
  { name: "JitoSOL", logo: tw("solana/assets/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn") },
];

/** Logos overlapping inside a headline line, sized to the type and bobbing gently. */
function LogoCluster({ marks }: { marks: Mark[] }) {
  return (
    <span aria-hidden className="float-soft mx-[0.04em] inline-flex align-[-0.12em]">
      {marks.map((m, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- logos come from many hosts
        <img
          key={m.name}
          src={m.logo}
          alt=""
          referrerPolicy="no-referrer"
          className={`size-[0.9em] rounded-full bg-white object-cover ring-[0.06em] ring-[#f5f8ef] ${i ? "-ml-[0.28em]" : ""}`}
          style={{ transform: `rotate(${[-8, 4, 10][i % 3]}deg)` }}
        />
      ))}
    </span>
  );
}

function CardScreen({
  z,
  icon: Icon,
  label,
  link,
  children,
}: {
  z: string;
  icon: LucideIcon;
  label: string;
  /** Optional link shown at the right of the label, e.g. to the docs. */
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section
      className={`sticky top-0 flex h-[100dvh] flex-col rounded-t-[2rem] bg-[#f5f8ef] px-4 pt-[4.75rem] pb-6 text-ink shadow-[0_-12px_32px_rgba(10,10,10,0.08)] sm:px-8 md:pt-24 md:pb-10 lg:px-10 ${z}`}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-base font-medium shadow-[0_1px_2px_rgba(10,10,10,0.04)] sm:h-12 sm:text-lg">
            <Icon className="size-5" strokeWidth={2} /> {label}
          </span>
          {link && (
            <a
              href={link.href}
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-[#262626] sm:h-12 sm:px-5 sm:text-[15px]"
            >
              {link.label} <ArrowUpRight className="size-4" />
            </a>
          )}
        </div>
        {/* Phones: swipe sideways through the cards. From md up: three across. */}
        <div className="-mx-4 mt-5 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-8 sm:px-8 md:mx-0 md:my-auto md:grid md:max-h-[640px] md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      </div>
    </section>
  );
}

const TONE = {
  lime: "bg-[#c6efb0] text-ink",
  dark: "bg-[#122018] text-white",
  cream: "bg-[#efe9dc] text-ink",
};

function Card({ tone, title, children, cardRef }: { tone: keyof typeof TONE; title: string; children: ReactNode; cardRef?: RefObject<HTMLElement | null> }) {
  return (
    <article ref={cardRef} className={`relative flex w-[84vw] max-w-[380px] shrink-0 snap-center flex-col overflow-hidden rounded-[28px] md:w-auto md:max-w-none ${TONE[tone]}`}>
      <h3 className="relative z-10 max-w-[20ch] px-7 pt-7 text-[1.5rem] font-medium leading-[1.2] tracking-[-0.025em] lg:px-9 lg:pt-9 lg:text-[1.7rem]">{title}</h3>
      <div className="relative min-h-0 flex-1">{children}</div>
    </article>
  );
}

/** A phone screen rising from the bottom of a card. */
function Phone({ dark, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <div
      className={`absolute inset-x-6 top-6 -bottom-8 flex flex-col rounded-t-[34px] border-[7px] border-b-0 px-4 pt-4 lg:inset-x-9 ${dark ? "border-[#070d09] bg-[#0b130e] text-white" : "border-ink bg-white text-ink"}`}
    >
      {children}
    </div>
  );
}

/** Tile on the left, a wide pill running off the card's right edge. */
function BleedRows({ rows }: { rows: { icon: ReactNode; tile: string; label: ReactNode }[] }) {
  return (
    <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col gap-4">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-center gap-3 ${["pl-7 lg:pl-9", "pl-14 lg:pl-16", "pl-9 lg:pl-11"][i % 3]}`}>
          <span className={`grid size-[4.5rem] shrink-0 place-items-center rounded-[22px] shadow-[0_10px_24px_rgba(10,10,10,0.08)] ${r.tile}`}>{r.icon}</span>
          <span className="flex h-[4.5rem] min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap rounded-l-[22px] bg-[#dcd5c5] pl-6 text-[1.6rem] font-medium tracking-[-0.03em] text-ink/80 lg:text-[1.85rem]">
            {r.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- find ---------- */

/** Real platforms floating round the Pecun tile, the one in focus lifting a little. */
function PlatformsCard({ rows }: { rows: StartRow[] }) {
  const ref = useRef<HTMLElement>(null);
  const active = useTicker(rows.length, 2200, ref);
  const spots = [
    "top-[8%] left-[6%] -rotate-[7deg]",
    "top-[30%] -right-[4%] rotate-[6deg]",
    "bottom-[24%] -left-[5%] rotate-[5deg]",
    "bottom-[6%] right-[4%] -rotate-[6deg]",
  ];
  return (
    <Card tone="lime" title="Lending, vaults, staking and fixed yield, side by side." cardRef={ref}>
      <span aria-hidden className="absolute top-[18%] right-[14%] size-5 rounded-full bg-ink" />
      <span aria-hidden className="absolute bottom-[40%] left-[16%] size-9 rounded-full bg-[#9aee78]" />
      <span aria-hidden className="absolute right-[30%] bottom-[2%] size-3 rounded-full bg-[#2f7d1c]" />
      <span className="absolute top-1/2 left-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 rotate-6 place-items-center rounded-[26px] bg-[#122018] shadow-[0_20px_40px_rgba(18,32,24,0.3)]">
        <PecunMark size={56} tone="dark" />
      </span>
      {rows.map((row, i) => (
        <span
          key={`${row.protocol}-${row.name}`}
          className={`absolute flex h-14 items-center gap-2.5 whitespace-nowrap rounded-full bg-white py-1.5 pr-5 pl-1.5 shadow-[0_12px_30px_rgba(18,32,24,0.14)] transition-transform duration-500 ${spots[i % spots.length]} ${i === active ? "scale-[1.06]" : ""}`}
        >
          <Logo src={row.logo} label={row.protocol} size={42} />
          <span className="text-[17px] font-medium tracking-[-0.02em]">{row.protocol}</span>
          <span className={`tabular text-[15px] font-medium ${i === active ? "text-green" : "text-[#5e5e58]"}`}>{pct(row.apy)}</span>
        </span>
      ))}
    </Card>
  );
}

/** The list sorted by rate, the top one lit. */
function SortCard({ rows }: { rows: StartRow[] }) {
  const sorted = [...rows].sort((a, b) => b.apy - a.apy);
  return (
    <Card tone="dark" title="Sort by rate and see which one pays most today.">
      <Phone dark>
        <div className="flex items-center justify-between px-1 text-sm">
          <span className="font-medium">Earn</span>
          <span className="flex items-center gap-1 rounded-full bg-white/[0.08] px-3 py-1.5 text-lime">
            APY <ArrowDown className="size-3.5" strokeWidth={2.5} />
          </span>
        </div>
        <ul className="mt-4 flex flex-col gap-1">
          {sorted.map((row, i) => (
            <li key={`${row.protocol}-${row.name}`} className={`flex items-center gap-3 rounded-2xl px-2.5 py-3 ${i === 0 ? "bg-white/[0.08]" : ""}`}>
              <Logo src={row.logo} label={row.protocol} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{row.name}</span>
                <span className="block truncate text-[13px] text-white/50">{row.protocol}</span>
              </span>
              <span className={`tabular text-[15px] font-medium ${i === 0 ? "text-lime" : ""}`}>{pct(row.apy)}</span>
            </li>
          ))}
        </ul>
      </Phone>
    </Card>
  );
}

/** Every vault listed takes deposits. */
function OpenCard({ rows }: { rows: StartRow[] }) {
  return (
    <Card tone="cream" title="Every vault you see is one you can deposit into.">
      <BleedRows
        rows={rows.slice(0, 3).map((r) => ({
          icon: <Logo src={r.logo} label={r.protocol} size={44} />,
          tile: "bg-white",
          label: (
            <>
              {r.protocol}
              <span className="flex items-center gap-1 rounded-full bg-lime px-3 py-1 text-[15px] tracking-normal text-ink">
                <Check className="size-3.5" strokeWidth={3} /> Open
              </span>
            </>
          ),
        }))}
      />
    </Card>
  );
}

/* ---------- deposit ---------- */

/** A phone deposit screen, the "Deposited" note dropping in and out. */
function DepositCard({ lead }: { lead: StartRow }) {
  const ref = useRef<HTMLElement>(null);
  const done = useTicker(2, 2600, ref) === 1;
  return (
    <Card tone="dark" title="Deposit in one tap, straight from your own wallet." cardRef={ref}>
      <Phone dark>
        <div
          className={`flex items-center gap-2.5 self-center rounded-2xl bg-white/[0.08] py-2.5 pr-4 pl-2.5 text-sm transition-all duration-500 ${done ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"}`}
        >
          <span className="grid size-6 place-items-center rounded-full bg-lime text-ink">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          Deposited into {lead.protocol}
        </div>
        <div className="my-auto text-center">
          <p className="tabular text-[3.4rem] font-medium leading-none tracking-[-0.05em] lg:text-[4rem]">1.40</p>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-white/55">
            <Logo src={lead.assetLogo} label={lead.asset} size={18} /> {lead.asset}
          </p>
        </div>
        <div className="mb-3 flex items-center justify-between gap-3 px-1 text-sm">
          <span className="text-white/55">APY</span>
          <span className="tabular font-medium text-lime">{pct(lead.apy)}</span>
        </div>
        <span
          className={`mb-12 flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-medium transition-colors duration-500 ${done ? "bg-[#2f7d1c] text-white" : "bg-lime text-ink"}`}
        >
          {done ? (
            <>
              <Check className="size-4" strokeWidth={2.5} /> Done
            </>
          ) : (
            "Deposit"
          )}
        </span>
      </Phone>
    </Card>
  );
}

/** The rate split into what the vault earns and what its fee takes. Lido keeps 10% of staking rewards. */
function FeesCard({ lead }: { lead: StartRow }) {
  const gross = lead.apy / 0.9;
  return (
    <Card tone="lime" title="See the APY after fees before you confirm.">
      <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rotate-[-3deg] rounded-[24px] bg-white p-5 shadow-[0_24px_50px_rgba(18,32,24,0.18)] lg:inset-x-9">
        <div className="flex items-center gap-2.5">
          <Logo src={lead.logo} label={lead.protocol} size={30} />
          <span className="font-medium">{lead.name}</span>
        </div>
        <dl className="mt-5 grid gap-3 text-[15px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-[#5e5e58]">
              <Leaf className="size-4" /> Vault yield
            </dt>
            <dd className="tabular text-green">+{pct(gross)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-[#5e5e58]">
              <TrendingDown className="size-4" /> Fee (10%)
            </dt>
            <dd className="tabular">−{pct(gross - lead.apy)}</dd>
          </div>
          <div className="mt-1 flex items-end justify-between gap-3 border-t border-black/[0.08] pt-4">
            <dt className="font-medium">APY after fees</dt>
            <dd className="tabular text-[2rem] font-medium leading-none tracking-[-0.04em]">{pct(lead.apy)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

/** What $1,000 could earn in a year at today's rate. */
function EstimateCard({ lead }: { lead: StartRow }) {
  const year = (1000 * lead.apy).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (
    <Card tone="cream" title="Estimate what you could earn before you deposit.">
      <div className="absolute inset-x-6 top-1/2 flex -translate-y-1/2 flex-col gap-3 lg:inset-x-9">
        <div className="rounded-[24px] bg-white p-5 shadow-[0_16px_40px_rgba(10,10,10,0.07)]">
          <p className="text-sm text-[#5e5e58]">If you deposit</p>
          <p className="tabular mt-1 text-[2.4rem] font-medium leading-none tracking-[-0.04em]">$1,000</p>
          <div className="relative mt-5 h-1.5 rounded-full bg-[#efe9dc]">
            <span className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-lime" />
            <span className="absolute top-1/2 left-[38%] size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-ink shadow" />
          </div>
        </div>
        <div className="rounded-[24px] bg-[#122018] p-5 text-white">
          <p className="text-sm text-white/55">You could earn in a year</p>
          <p className="tabular mt-1 text-[2.4rem] font-medium leading-none tracking-[-0.04em] text-lime">{year}</p>
          <p className="mt-2 text-xs text-white/45">At today&apos;s {pct(lead.apy)}. Rates move.</p>
        </div>
      </div>
    </Card>
  );
}

/* ---------- earn ---------- */

/** What the portfolio page shows. */
function PortfolioCard({ lead }: { lead: StartRow }) {
  return (
    <Card tone="cream" title="All your positions in one portfolio.">
      <BleedRows
        rows={[
          { icon: <Logo src={lead.logo} label={lead.protocol} size={44} />, tile: "bg-white", label: `Earning ${pct(lead.apy)}` },
          { icon: <TrendingUp className="size-7" strokeWidth={1.8} />, tile: "bg-lime", label: "Lifetime earned" },
          { icon: <CalendarClock className="size-7 text-lime" strokeWidth={1.8} />, tile: "bg-[#122018]", label: "Next accrual" },
        ]}
      />
    </Card>
  );
}

/** Pending items move along until they settle. */
function ActivityCard({ lead }: { lead: StartRow }) {
  const ref = useRef<HTMLElement>(null);
  const step = useTicker(4, 1400, ref);
  return (
    <Card tone="dark" title="Deposits and withdrawals tracked until they settle." cardRef={ref}>
      <Phone dark>
        <div className="flex gap-5 border-b border-white/10 px-1 text-sm">
          <span className="pb-3 text-white/50">History</span>
          <span className="border-b-2 border-lime pb-3 font-medium">Pending</span>
        </div>
        <ul className="mt-4 flex flex-col gap-3">
          <li className="rounded-2xl bg-white/[0.06] p-3.5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-[#1c3a28] text-lime">
                <ArrowDownToLine className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">Withdrawal</span>
                <span className="block text-[13px] text-white/50">
                  0.50 {lead.asset} · {lead.protocol}
                </span>
              </span>
              <span className="flex items-center gap-1 text-[13px] text-white/60">
                <Clock className="size-3.5" /> In queue
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-lime transition-all duration-700" style={{ width: `${30 + step * 18}%` }} />
            </div>
          </li>
          <li className="flex items-center gap-3 rounded-2xl bg-white/[0.06] p-3.5">
            <span className="grid size-9 place-items-center rounded-full bg-lime text-ink">
              <Check className="size-4" strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">Deposit</span>
              <span className="block text-[13px] text-white/50">
                1.40 {lead.asset} · {lead.protocol}
              </span>
            </span>
            <span className="text-[13px] text-lime">Settled</span>
          </li>
        </ul>
      </Phone>
    </Card>
  );
}

/** Instant exit or the protocol's own queue, flipping between the two. */
function WithdrawCard({ lead }: { lead: StartRow }) {
  const ref = useRef<HTMLElement>(null);
  const instant = useTicker(2, 2600, ref) === 0;
  return (
    <Card tone="lime" title="Withdraw when you're ready, instantly where the vault allows." cardRef={ref}>
      <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rotate-[2deg] rounded-[24px] bg-white p-5 shadow-[0_24px_50px_rgba(18,32,24,0.18)] lg:inset-x-9">
        <div className="flex rounded-full bg-[#f3efe6] p-1 text-sm">
          {["Instant exit", "Queue"].map((t, i) => (
            <span
              key={t}
              className={`flex-1 rounded-full py-2 text-center transition-colors duration-300 ${(i === 0) === instant ? "bg-white font-medium shadow-sm" : "text-[#5e5e58]"}`}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="tabular text-[2.4rem] font-medium leading-none tracking-[-0.04em]">0.50</span>
          <span className="flex items-center gap-2 font-medium">
            <Logo src={lead.assetLogo} label={lead.asset} size={24} /> {lead.asset}
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-[15px]">
          <span className="text-[#5e5e58]">Arrives</span>
          <span className="font-medium">{instant ? "Now, via swap" : lead.redemption || "Protocol queue"}</span>
        </div>
        <span className="mt-5 flex h-12 items-center justify-center rounded-2xl bg-ink text-[15px] font-medium text-white">Withdraw</span>
      </div>
    </Card>
  );
}

/* ---------- the Pecun Fund ---------- */

/** The leaf on a dark tile, sized to the headline type. */
function FundTile() {
  return (
    <span
      aria-hidden
      className="float-soft mx-[0.04em] inline-grid size-[0.95em] place-items-center rounded-[0.26em] bg-[#122018] align-[-0.14em] shadow-[0_0.12em_0.3em_rgba(18,32,24,0.22)]"
    >
      <svg viewBox="12 12 40 40" className="size-[0.6em]">
        <path d="M14 50C14 28 28 14 50 14Z" fill="#ffffff" />
        <path d="M50 14C50 36 36 50 14 50Z" fill="#b8ff9d" />
      </svg>
    </span>
  );
}

/** A trade receipt: $97 goes through, $2.10 of the $3 tax goes to the Fund, $0.90 to running costs, and the Fund's tally ticks up. */
function FundTaxCard() {
  const ref = useRef<HTMLElement>(null);
  const tick = useTicker(6, 1600, ref);
  return (
    <Card tone="lime" title="A 3% tax on every $PEN trade. 70% of it goes into the Fund." cardRef={ref}>
      <div className="absolute inset-x-6 top-1/2 flex -translate-y-1/2 flex-col gap-3 lg:inset-x-9">
        <div className="rounded-[24px] bg-white p-5 shadow-[0_18px_40px_rgba(18,32,24,0.12)]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#5e5e58]">$PEN trade</span>
            <span className="tabular text-[1.6rem] font-medium leading-none tracking-[-0.04em]">$100.00</span>
          </div>
          <div className="mt-4 flex h-2.5 gap-[3px] overflow-hidden rounded-full">
            <span className="h-full min-w-0 flex-1 rounded-l-full bg-[#d8d2c2]" />
            <span className="h-full min-w-[6px] bg-[#2f7d1c]" style={{ width: "2.1%" }} />
            <span className="h-full min-w-[4px] rounded-r-full bg-[#0a0a0a]" style={{ width: "0.9%" }} />
          </div>
          <dl className="mt-4 grid gap-2.5 text-[15px]">
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-2 text-[#5e5e58]">
                <span className="size-2 rounded-full bg-[#d8d2c2]" /> Goes through
              </dt>
              <dd className="tabular font-medium">$97.00</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-2 text-[#5e5e58]">
                <span className="size-2 rounded-full bg-[#2f7d1c]" /> To the Fund
              </dt>
              <dd className="tabular font-medium text-[#2f7d1c]">$2.10</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-2 text-[#5e5e58]">
                <span className="size-2 rounded-full bg-[#0a0a0a]" /> Running costs
              </dt>
              <dd className="tabular font-medium">$0.90</dd>
            </div>
          </dl>
        </div>
        <div className="flex items-center justify-between rounded-[20px] bg-[#122018] px-5 py-4 text-white">
          <span className="flex items-center gap-2.5 text-[15px] text-white/75">
            <span className="relative grid size-2.5 place-items-center">
              <span className="absolute size-2.5 animate-ping rounded-full bg-lime/60" />
              <span className="size-2 rounded-full bg-lime" />
            </span>
            Pecun Fund
          </span>
          <span key={tick} className="pop tabular text-[15px] font-medium text-lime">
            +${(2.1 * (tick + 1)).toFixed(2)}
          </span>
        </div>
      </div>
    </Card>
  );
}

const FUND_SPLIT = [
  { label: "Delta-neutral strategies", value: 30, color: "#ffffff" },
  { label: "Yield vaults", value: 25, color: "#b8ff9d" },
  { label: "$PEN buybacks", value: 15, color: "#7ed957" },
  { label: "Lending markets", value: 15, color: "#3f9a2a" },
  { label: "Liquid staking", value: 10, color: "#d8d2c2" },
  { label: "Cash reserve", value: 5, color: "#6b7a64" },
];

/** The Fund's target split: a donut with a clean legend beside it. */
function FundAllocationCard() {
  const r = 50;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Card tone="dark" title="Put to work across vaults, hedged strategies and buybacks.">
      <div className="absolute inset-x-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-5 lg:inset-x-9">
        <div className="relative size-44">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label={FUND_SPLIT.map((d) => `${d.label} ${d.value}%`).join(", ")}>
            <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" />
            {FUND_SPLIT.map((d) => {
              const len = (d.value / 100) * c;
              const el = (
                <circle
                  key={d.label}
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth="14"
                  strokeLinecap="butt"
                  strokeDasharray={`${Math.max(0, len - 2.5)} ${c}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[1.6rem] font-medium leading-none tracking-[-0.04em] text-white">6</span>
            <span className="mt-1 text-[12px] leading-tight text-white/55">places it works</span>
          </span>
        </div>
        <ul className="w-full divide-y divide-white/[0.07] text-[14px]">
          {FUND_SPLIT.map((d) => (
            <li key={d.label} className="flex items-center gap-2.5 py-[7px]">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
              <span className="min-w-0 flex-1 text-white/80">{d.label}</span>
              <span className="tabular font-medium text-white">{d.value}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** Your slice of the Fund, and a way into the docs. */
function FundShareCard() {
  return (
    <Card tone="cream" title="Own a share. It's paid out when you sell.">
      <div className="absolute inset-x-6 top-1/2 flex -translate-y-1/2 flex-col gap-3 lg:inset-x-9">
        <div className="rounded-[24px] bg-white p-5 shadow-[0_16px_40px_rgba(10,10,10,0.07)]">
          <p className="text-sm text-[#5e5e58]">You hold</p>
          <p className="tabular mt-1 text-[1.9rem] font-medium leading-none tracking-[-0.04em]">1,000,000 PEN</p>
          <div className="relative mt-5 h-2 rounded-full bg-[#efe9dc]">
            <span className="absolute inset-y-0 left-0 w-[3px] rounded-full bg-[#2f7d1c]" />
            <span className="absolute -top-1 left-0 h-4 w-px bg-[#2f7d1c]" />
          </div>
          <div className="mt-2 flex justify-between text-[13px] text-[#8a8a83]">
            <span>You: 0.1% of the supply</span>
            <span>1B PEN</span>
          </div>
        </div>
        <div className="rounded-[24px] bg-[#122018] p-5 text-white">
          <p className="text-sm text-white/55">Your share of the Fund</p>
          <p className="tabular mt-1 text-[1.9rem] font-medium leading-none tracking-[-0.04em] text-lime">0.1%</p>
          <p className="mt-2 text-xs text-white/45">Paid to you automatically when you sell.</p>
        </div>
        <a href={`${DOCS_URL}/fund`} className="flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-ink text-[15px] font-medium text-white hover:bg-[#262626]">
          Read how it works <ArrowUpRight className="size-4" />
        </a>
      </div>
    </Card>
  );
}
