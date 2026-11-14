"use client";

import { ArrowLeft, ArrowUpDown, Clock, Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/**
 * Portfolio overview. Positions arrive once a wallet is connected;
 * until then the account is empty and every figure stays at zero.
 */
export function PortfolioView() {
  const [book, setBook] = useState<"vaults" | "defi">("vaults");

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
        <Money label="Supplied" value="$0.00" />
        <Money label="Lifetime Earned" value="$0.00" hint="Yield already paid to this account." />
        <Money label="Next Accrual" value="—" hint="When the next yield payment is due. Nothing is scheduled." />
      </div>

      <div role="tablist" aria-label="Holdings" className="mt-8 flex gap-6 border-b border-line">
        {(
          [
            ["vaults", "Vaults", "$0.00"],
            ["defi", "DeFi", "$0.00"],
          ] as const
        ).map(([id, label, amount]) => (
          <button
            key={id}
            role="tab"
            aria-selected={book === id}
            onClick={() => setBook(id)}
            className={`-mb-px border-b-2 pb-3 text-sm ${book === id ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label} <span className="tabular">{amount}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-4 px-1 text-sm text-muted">
          {["Vault", "APY", "Yield Earned", "Your shares"].map((h) => (
            <div key={h} className="flex items-center gap-1 py-2">
              {h}
              <ArrowUpDown className="size-3.5" />
            </div>
          ))}
        </div>
        <div className="mt-2 flex min-h-[320px] min-w-[640px] flex-col items-center justify-center gap-3 rounded-2xl bg-card text-center">
          <p className="text-sm text-muted">No active positions yet.</p>
          <Link href="/?earn=vaults" className="inline-flex h-9 items-center rounded-full border border-line px-4 text-sm font-medium text-accent hover:border-accent">
            Explore Vaults
          </Link>
        </div>
      </div>
    </div>
  );
}

const ACTIVITY = ["History", "Pending Deposits", "Pending Withdrawals", "Pending Holdbacks"] as const;

const EMPTY: Record<(typeof ACTIVITY)[number], string> = {
  History: "No activity history yet.",
  "Pending Deposits": "No pending deposits.",
  "Pending Withdrawals": "No pending withdrawals.",
  "Pending Holdbacks": "No pending holdbacks.",
};

/** Activity reached from the portfolio Activity button. */
export function ActivityView() {
  const [tab, setTab] = useState<(typeof ACTIVITY)[number]>("History");

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
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-4 px-1 text-sm text-muted">
          {["Action", "Vault", "Network", "Date"].map((h) => (
            <div key={h} className="flex items-center gap-1 py-2">
              {h}
              <ArrowUpDown className="size-3.5" />
            </div>
          ))}
        </div>
        <div className="mt-2 flex min-h-[320px] min-w-[640px] flex-col items-center justify-center gap-3 rounded-2xl bg-card text-center">
          <p className="text-sm text-muted">{EMPTY[tab]}</p>
          <Link href="/portfolio" className="inline-flex h-9 items-center rounded-full border border-line px-4 text-sm font-medium text-accent hover:border-accent">
            Go to Portfolio
          </Link>
        </div>
      </div>
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
