import { ArrowLeftRight, ChevronDown, Fingerprint, Mail, X } from "lucide-react";
import { Logo } from "./logo";
import type { Featured } from "@/lib/live";
import { APP_URL, TURNKEY } from "@/lib/site";
import { pct } from "@/lib/live";

/**
 * Pieces of the Pecun app for the feature rows, in the landing page's colours (white, black, Pecun green).
 * The yield list uses live catalog rows; the deposit amount is an example.
 */

/** LI.FI chain icons for the chains that show up most. */
const CHAIN_ICON: Record<string, string> = Object.fromEntries(
  [
    ["Ethereum", "ethereum"],
    ["Base", "base"],
    ["Arbitrum", "arbitrum"],
    ["Optimism", "optimism"],
    ["Polygon", "polygon"],
    ["BNB Chain", "bsc"],
    ["Avalanche", "avalanche"],
    ["Solana", "solana"],
    ["Sui", "sui"],
    ["HyperEVM", "hyperevm"],
    ["Hyperliquid", "hyperevm"],
  ].map(([name, key]) => [name, `https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/${key}.svg`]),
);

/* Yield list --------------------------------------------------------------- */

/** Three live vaults inside one card: logo, name, rate. */
export function YieldList({ rows }: { rows: Featured[] }) {
  return (
    <div className="w-full rounded-[24px] bg-white p-3 shadow-[0_16px_50px_rgba(10,10,10,0.08)] sm:p-4">
      <p className="px-2 pb-3 pt-1 text-xs text-muted">Live rates</p>
      <div className="grid gap-2">
        {rows.slice(0, 3).map((v) => (
          <a
            key={v.name}
            href={v.href}
            className="flex min-w-0 items-center gap-3 rounded-full bg-[#111] py-1.5 pl-1.5 pr-4 text-white transition hover:bg-[#1c1c1c]"
          >
            <Logo src={v.logo} label={v.asset} size={42} />
            <span className="min-w-0 truncate text-[15px] font-medium tracking-[-0.02em]">{v.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <span className="tabular text-[15px]">{pct(v.apy)}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/* Deposit card -------------------------------------------------------------- */

function DottedLabel({ children }: { children: string }) {
  return <span className="border-b border-dashed border-ink/25 text-muted">{children}</span>;
}

export function DepositCard({ v }: { v: Featured }) {
  return (
    <div className="w-full min-w-0 max-w-[400px] rounded-[28px] border border-line bg-white p-4 shadow-[0_30px_80px_rgba(10,10,10,0.14),0_2px_6px_rgba(10,10,10,0.05)]">
      <div className="flex items-center justify-between">
        <div className="flex rounded-full text-sm">
          <span className="rounded-full bg-paper px-4 py-2 font-medium">Deposit</span>
          <span className="px-4 py-2 text-muted">Withdraw</span>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-paper py-1 pl-1 pr-2">
          <Logo src={CHAIN_ICON[v.chain]} label={v.chain} size={26} />
          <ChevronDown className="size-4 text-muted" />
        </span>
      </div>

      <div className="mt-3 rounded-[22px] border border-line bg-[#fbfbf9] p-4">
        <div className="text-xs text-muted">Deposit</div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="tabular text-[2.4rem] leading-none tracking-[-0.03em]">2,500</span>
          <span className="flex items-center gap-2 text-lg font-medium">
            <Logo src={v.logo} label={v.asset} size={30} /> {v.asset}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          $2,500.00 <ArrowLeftRight className="size-3.5" />
        </div>
      </div>

      <div className="mt-3 h-12 rounded-full bg-lime text-center text-base font-medium leading-[48px]">Deposit</div>

      <dl className="mt-4 grid gap-2.5 px-1 text-[13px]">
        <div className="flex items-center justify-between">
          <dt>
            <DottedLabel>Shares received</DottedLabel>
          </dt>
          <dd className="flex items-center gap-1.5 font-medium">
            <Logo src={v.logo} label={v.asset} size={16} /> {v.asset} shares
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt>
            <DottedLabel>APY</DottedLabel>
          </dt>
          <dd className="tabular font-medium text-green">{pct(v.apy)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt>
            <DottedLabel>Withdrawal</DottedLabel>
          </dt>
          <dd className="font-medium">{v.redemption}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt>
            <DottedLabel>Protocol</DottedLabel>
          </dt>
          <dd className="flex items-center gap-1.5 font-medium">
            <Logo src={v.protocolLogo} label={v.protocol} size={16} /> {v.protocol}
          </dd>
        </div>
      </dl>

      <p className="mt-4 border-t border-line pt-3 text-center text-[12px] text-muted">
        By depositing, you agree to the{" "}
        <a href={`${APP_URL}/terms`} className="text-ink underline underline-offset-2">
          Terms
        </a>{" "}
        and{" "}
        <a href={`${APP_URL}/risk-disclosure`} className="text-ink underline underline-offset-2">
          Risk Disclosure
        </a>
        .
      </p>
    </div>
  );
}

/* Self-custody wallet -------------------------------------------------------- */

/** The sign-up modal, secured by Turnkey. */
export function SelfCustodyCard() {
  return (
    <div className="w-full min-w-0 max-w-[380px] overflow-hidden rounded-[26px] border border-line bg-white shadow-[0_30px_80px_rgba(10,10,10,0.16),0_2px_6px_rgba(10,10,10,0.05)]">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <span>
            <span className="block text-lg font-medium tracking-[-0.02em]">Create your wallet</span>
            <span className="mt-0.5 block text-xs text-muted">Self-custodial, ready in seconds.</span>
          </span>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-paper text-muted">
            <X className="size-4" />
          </span>
        </div>

        <label className="mt-5 block text-[11px] font-medium text-muted">Email</label>
        <div className="mt-1.5 flex h-11 items-center gap-2 rounded-xl border border-ink/15 bg-white px-3 text-sm ring-4 ring-lime/30">
          <Mail className="size-4 text-muted" />
          <span>you@email.com</span>
          <span className="h-4 w-px animate-pulse bg-ink" />
        </div>
        <div className="mt-2.5 h-11 rounded-xl bg-lime text-center text-sm font-medium leading-[44px]">Continue</div>

        <div className="my-3.5 flex items-center gap-3 text-[11px] text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-medium text-white">
          <Fingerprint className="size-4 text-lime" /> Continue with a passkey
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line bg-[#fbfbf9] px-5 py-3.5">
        <Logo src={TURNKEY.logo} label={TURNKEY.name} size={28} />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">Secured by {TURNKEY.name}</span>
          <span className="block text-[11px] text-muted">Wallet keys are protected by Turnkey's infrastructure.</span>
        </span>
      </div>
    </div>
  );
}
