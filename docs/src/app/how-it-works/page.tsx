import type { Metadata } from "next";
import { A, Doc, Facts, H2, List, P, Steps } from "@/components/chrome";

export const metadata: Metadata = { title: "How Pecun works", description: "Find, deposit and earn with Pecun, and what happens in between." };

export default function HowItWorks() {
  return (
    <Doc href="/how-it-works">
      <P>
        Pecun does three things: it finds yield, it builds the transactions to get your money into and out of it, and it keeps track of your positions.
        The yield itself comes from the protocols. Pecun never runs a strategy or holds your funds.
      </P>

      <H2>Find, deposit, earn</H2>
      <Steps
        items={[
          {
            title: "Find",
            body: "Pecun reads each protocol's own data and lists its vaults, markets and staking products with the live rate, the amount deposited (TVL), the asset it takes and how withdrawals work.",
          },
          {
            title: "Deposit",
            body: "When you deposit, Pecun prepares the transaction, shows you the fees and the APY after fees, and you approve it from your wallet. If the deposit needs a swap first, Pecun finds a route for you.",
          },
          {
            title: "Earn",
            body: "The protocol holds the position and pays the yield. Pecun shows it in your portfolio, with what you've supplied, what you've earned and anything still pending.",
          },
        ]}
      />

      <H2>What Pecun is, and isn&apos;t</H2>
      <Facts
        rows={[
          ["Pecun is", "An interface that finds yield, prepares transactions and tracks positions."],
          ["Pecun isn't", "A bank, a fund, an exchange or an adviser. It doesn't run the products it lists, and it doesn't trade or invest for you."],
          ["Your money", "Moves from your wallet straight into the protocol. Pecun never holds it."],
          ["Every transaction", "Is one you approve. Nothing moves without your confirmation."],
        ]}
      />

      <H2>What Pecun relies on</H2>
      <List
        items={[
          <>The protocols themselves, for the products, the rates and the yield. See <A href="/protocols">Supported protocols</A>.</>,
          "Turnkey, for your self-custodial wallet and signing.",
          "Routers such as Relay and LI.FI, when a deposit or withdrawal needs a swap or a transfer.",
          <>Data and infrastructure providers. See <A href="/providers">Partners and providers</A>.</>,
        ]}
      />
    </Doc>
  );
}
