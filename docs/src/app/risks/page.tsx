import type { Metadata } from "next";
import { A, Callout, Doc, Facts, H2, P } from "@/components/chrome";
import { APP_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Risks", description: "What can go wrong when earning yield on-chain, and how to think about it." };

export default function Risks() {
  return (
    <Doc href="/risks">
      <P>
        All yield carries risk. Higher rates usually mean higher risk. You could lose some or all of what you deposit, and Pecun can&apos;t refund losses
        caused by a protocol or a market.
      </P>

      <H2>The main risks</H2>
      <Facts
        rows={[
          ["Smart contracts", "A bug or exploit in a protocol's code can drain funds, even in audited, long-running protocols."],
          ["Depegs", "Stablecoins and staked tokens can lose their peg and trade below the value they track."],
          ["Market risk", "Prices move. Strategies can lose money, and leveraged or liquidity strategies can lose more than expected."],
          ["Liquidity", "A vault can be slow to pay out, pause withdrawals or have a long queue when many people exit at once."],
          ["Protocol decisions", "Protocols can freeze, pause, change or shut down products, and their managers can make mistakes."],
          ["Providers", "Wallets, routers, bridges and data providers can fail, be delayed or misprice a transfer."],
          ["Your access", "If someone else gets your login, or you lose it, funds can be lost."],
        ]}
      />

      <H2>Reducing your risk</H2>
      <P>
        Spread deposits across protocols, prefer vaults with deep liquidity and a long record, read how withdrawals work before you deposit, and only
        put in what you can afford to lose.
      </P>

      <Callout tone="warn" title="Read the full Risk Disclosure">
        The <A href={`${APP_URL}/risk-disclosure`}>Risk Disclosure</A> in the app covers these risks in full. Read it before you deposit.
      </Callout>
    </Doc>
  );
}
