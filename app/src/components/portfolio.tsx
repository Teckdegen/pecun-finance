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
    <div>
      <h1 className="text-[1.65rem] font-medium tracking-[-0.03em] md:text-[2rem]">Portfolio</h1>
      <p className="mt-1 font-sans text-sm text-muted">Every position you hold, across EVM, Solana, Sui and Hyperliquid.</p>

      {/* Worth banner */}
      <section className="relative mt-5 overflow-hidden rounded-xl border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hero/banner.jpg" alt="" className="absolute inset-0 size-full object-cover object-[50%_85%] opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-black/30" />
        <div className="relative px-5 py-6 md:px-7 md:py-8">
          <p className="eyebrow text-muted">Total worth</p>
          <div className="tabular mt-2 text-[2.5rem] font-medium leading-none tracking-[-0.04em] md:text-6xl">$0.00</div>
          <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:max-w-xl">
            <Stat label="Deposited" value="$0.00" />
            <Stat label="Per year" value="$0.00" />
            <Stat label="Pending" value="0" />
          </div>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
        <div role="tablist" aria-label="Portfolio view" className="flex gap-6 border-b border-line px-5">
          {(["positions", "activity"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`eyebrow -mb-px border-b-2 py-3.5 transition ${tab === t ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="eyebrow text-muted">
                {(tab === "positions" ? ["Position", "APY", "Balance", "Worth", "Status"] : ["Action", "Vault", "Amount", "Fee", "Date"]).map((h, i) => (
                  <th key={h} className={`py-3 font-medium ${i === 0 ? "pl-5" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>

        <div className="flex flex-col items-center gap-3 border-t border-line px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl border border-line bg-card-2 text-accent">
            <Wallet className="size-5" />
          </span>
          <p className="text-[17px] tracking-[-0.02em]">{tab === "positions" ? "No open positions" : "No activity yet"}</p>
          <p className="max-w-md font-sans text-sm leading-6 text-muted">
            Once your wallet is connected, every vault, lending and staking position shows here with its live worth, across all chains.
          </p>
          <Link href="/" className="eyebrow mt-2 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-on-accent hover:bg-accent-deep">
            <Compass className="size-4" /> Explore yields
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/55 px-3 py-3 backdrop-blur md:px-4">
      <div className="eyebrow text-[10px] text-muted md:text-[11px]">{label}</div>
      <div className="tabular mt-1 text-lg font-medium tracking-[-0.02em]">{value}</div>
    </div>
  );
}
