import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { A, Doc } from "@/components/chrome";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "FAQ", description: "Short answers to common questions about Pecun." };

const QA: [string, ReactNode][] = [
  ["What is Pecun?", "One place for on-chain yield. Pecun brings together lending markets, vaults, liquid staking and fixed yield from the biggest protocols and platforms, with the live rate next to each one."],
  ["Who holds my money?", <>You do. Your wallet is self-custodial and secured by Turnkey. Pecun never holds your funds and can&apos;t move them. See <A href="/wallet">Wallet and custody</A>.</>],
  ["Do I need an account to look around?", "No. You can browse every yield without signing up. You only need a wallet to deposit."],
  ["Where do the rates come from?", <>From each protocol, live. Pecun doesn&apos;t set rates or add to them. See <A href="/rates">Rates and APY</A>.</>],
  ["Can I withdraw whenever I want?", <>It depends on the vault: some pay out instantly, some use a queue, and fixed yield pays at maturity. See <A href="/withdrawals">Withdrawals</A>.</>],
  ["What does it cost?", <>A small Pecun fee on deposits and withdrawals, shown before you confirm. Protocols may charge their own fees. See <A href="/fees">Fees</A>.</>],
  ["Is it risky?", <>Yes. All yield carries risk and you could lose what you deposit. See <A href="/risks">Risks</A>.</>],
  ["What is $PEN?", <>The Pecun token, launching on Base. Every trade pays a 3% tax: 70% goes into the Pecun Fund, which is invested in yield vaults and strategies and owned by holders, and 30% pays for running Pecun. See <A href="/token">$PEN token</A> and <A href="/fund">Pecun Fund</A>.</>],
  ["Where is Pecun available?", <>Most of the world, with some exceptions. See <A href="/availability">Availability</A>.</>],
  ["How do I contact Pecun?", <>Email <A href="mailto:contact@pecun.finance">contact@pecun.finance</A>, or find us on X and Discord.</>],
];

export default function Faq() {
  return (
    <Doc href="/faq">
      <div className="divide-y divide-line border-y border-line">
        {QA.map(([q, a]) => (
          <details key={q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-tight text-[1.15rem] font-medium tracking-[-0.02em] text-ink sm:text-[1.3rem] [&::-webkit-details-marker]:hidden">
              {q}
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-[#5e5e58] transition group-open:rotate-45 group-open:border-ink group-open:bg-ink group-open:text-white">
                <Plus className="size-4" />
              </span>
            </summary>
            <p className="mt-3 pr-12">{a}</p>
          </details>
        ))}
      </div>
    </Doc>
  );
}
