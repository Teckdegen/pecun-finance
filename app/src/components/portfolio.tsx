"use client";

import { Compass, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Tab = "positions" | "activity";

/**
 * Portfolio: total worth and every open position across chains.
 * Positions are read per protocol once a Turnkey wallet is connected (arrives with execution);
 * until then this shows the empty state.
 */
export function PortfolioView() {
  const [tab, setTab] = useState<Tab>("positions");

  return (
    <div className="mx-auto max-w-[1240px]">
      <h1 className="text-[30px] font-medium tracking-tight">Portfolio</h1>

      <section className="mt-8 rounded-[24px] bg-card px-9 py-8">
        <div className="text-sm text-muted">Total worth</div>
        <div className="tabular mt-2 text-5xl font-medium tracking-tight">$0.00</div>
        <div className="mt-3 text-muted">Across EVM, Solana, Sui and Hyperliquid</div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Stat label="Deposited" value="$0.00" />
          <Stat label="Earning per year" value="$0.00" />
          <Stat label="Pending withdrawals" value="0" />
        </div>
      </section>

      <section className="mt-8 rounded-[24px] bg-card p-6 sm:p-8">
        <div role="tablist" aria-label="Portfolio view" className="flex gap-6 px-1">
          {(["positions", "activity"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`border-b-2 pb-2 text-[15px] capitalize transition ${tab === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="text-sm text-muted">
                {tab === "positions" ? (
                  <>
                    <th className="py-3 pl-1 font-normal">Position</th>
                    <th className="py-3 font-normal">APY</th>
                    <th className="py-3 font-normal">Balance</th>
                    <th className="py-3 font-normal">Worth</th>
                    <th className="py-3 font-normal">Status</th>
                  </>
                ) : (
                  <>
                    <th className="py-3 pl-1 font-normal">Action</th>
                    <th className="py-3 font-normal">Vault</th>
                    <th className="py-3 font-normal">Amount</th>
                    <th className="py-3 font-normal">Fee</th>
                    <th className="py-3 font-normal">Date</th>
                  </>
                )}
              </tr>
            </thead>
          </table>
        </div>

        <div className="flex flex-col items-center gap-3 border-t border-line py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-card-2"><Wallet className="size-5" /></span>
          <p className="text-[17px]">{tab === "positions" ? "No open positions" : "No activity yet"}</p>
          <p className="max-w-md text-sm text-muted">
            Once your wallet is connected, every vault, lending and staking position shows here with its live worth, across all chains.
          </p>
          <Link href="/" className="mt-2 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm text-white">
            <Compass className="size-4" /> Explore opportunities
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] bg-card-2 px-5 py-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="tabular mt-1 text-xl">{value}</div>
    </div>
  );
}
