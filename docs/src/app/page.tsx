import type { Metadata } from "next";
import { A, Callout, Cards, Doc, Facts, H2, List, P } from "@/components/chrome";
import { APP_URL, PROTOCOLS } from "@/lib/site";

export const metadata: Metadata = { title: { absolute: "Pecun Docs" } };

export default function Introduction() {
  return (
    <Doc href="/">
      <P>
        Pecun puts on-chain yield in one place. It lists lending markets, vaults, liquid staking and fixed yield from {PROTOCOLS.length} of the biggest
        protocols and platforms, shows the live rate next to each one, and lets you move money in and out from a single self-custodial wallet.
      </P>
      <P>
        Pecun is an interface, not a bank or a fund. It never holds your money. When you deposit, your funds go from your wallet straight into the
        protocol you picked, and only you can approve that.
      </P>

      <H2>What you can do</H2>
      <List
        items={[
          "Compare yields from many protocols side by side, by category, asset and rate.",
          "Deposit into a vault, market or staking product in a few taps.",
          "Track every position, what you've earned and what's pending in one portfolio.",
          "Withdraw when you're ready, instantly where the vault offers it.",
        ]}
      />

      <H2>Pecun at a glance</H2>
      <Facts
        rows={[
          ["What it is", "An app that finds yield across the top protocols and platforms and handles deposits and withdrawals for you."],
          ["Who holds your money", "You do. Your wallet is self-custodial and secured by Turnkey."],
          ["Products", "Lending markets, vaults, liquid staking, savings rates and fixed yield."],
          ["Protocols", `${PROTOCOLS.length} platforms, including Aave, Morpho, Lido, Pendle, Kamino and Hyperliquid.`],
          ["Fees", "A small fee on deposits and withdrawals, always shown before you confirm. Network fees are currently paid by Pecun."],
          ["Token", <>$PEN, launching on Robinhood Chain. 70% of its 3% trading tax funds the Pecun Fund. See <A href="/token">$PEN token</A>.</>],
          ["Where", <>Most of the world, with some exceptions. See <A href="/availability">Availability</A>.</>],
        ]}
      />

      <Callout title="New here?">
        Start with <A href="/getting-started">Getting started</A>, or open the <A href={APP_URL}>Pecun app</A> and look around. Browsing rates doesn&apos;t
        need an account.
      </Callout>

      <H2>Where to next</H2>
      <Cards
        items={[
          { href: "/getting-started", title: "Getting started", body: "Sign up, add funds and make your first deposit." },
          { href: "/how-it-works", title: "How Pecun works", body: "What happens between tapping deposit and earning." },
          { href: "/protocols", title: "Supported protocols", body: "Every platform you can earn on through Pecun." },
          { href: "/fees", title: "Fees", body: "Exactly what you pay, and to whom." },
        ]}
      />
    </Doc>
  );
}
