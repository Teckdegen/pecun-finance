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
            body: "You hold USDG on Robinhood Chain. Press once and Pecun bridges it to the vault's chain, swaps it into the vault's own asset and deposits it, all signed by your own session. Every cost is shown before you press.",
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
          ["Every transaction", "Is signed with your own sign-in. Pecun's servers can't move your money on their own."],
        ]}
      />

      <H2>One click, step by step</H2>
      <P>Here's what happens behind the button when you deposit into a vault on another chain.</P>
      <Steps
        items={[
          {
            title: "Bridge from Robinhood Chain",
            body: "Your USDG leaves Robinhood Chain for the vault's chain, by the cheapest route Pecun can find, never one that costs more than 0.5%. A small part arrives as that chain's own coin (ETH, SOL, SUI and so on), so your transactions there always go through.",
          },
          {
            title: "Swap into the vault's asset",
            body: "The rest is swapped into exactly the asset the vault takes, on that chain.",
          },
          {
            title: "Deposit",
            body: "The asset goes into the vault and the position lands in your wallet, under your name. Pecun's fee is only taken once the deposit lands.",
          },
        ]}
      />
      <P>
        Withdrawing runs the same steps backwards and brings your money home as USDG on Robinhood Chain. If anything fails on the way, no fee is taken
        and whatever already moved is sent back to your wallet. It works the same way on every chain, Solana and Sui included.
      </P>

      <H2>What Pecun relies on</H2>
      <List
        items={[
          <>The protocols themselves, for the products, the rates and the yield. See <A href="/protocols">Supported protocols</A>.</>,
          "Turnkey, for your self-custodial wallet and signing.",
          "Routers such as Relay and LI.FI, for the bridges and swaps that move your money between chains.",
          <>Data and infrastructure providers. See <A href="/providers">Partners and providers</A>.</>,
        ]}
      />
    </Doc>
  );
}
