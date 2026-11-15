import type { Metadata } from "next";
import { A, Callout, Doc, Facts, H2, List, P } from "@/components/chrome";

export const metadata: Metadata = { title: "Exploring yields", description: "Categories, filters and how to compare vaults on Pecun." };

export default function Explore() {
  return (
    <Doc href="/explore">
      <P>
        The Explore page is where every yield on Pecun lives. Each row shows the product, the protocol behind it, its current APY and how much is
        deposited in it (TVL). Open a row to see the full detail before you deposit.
      </P>

      <H2>Categories</H2>
      <Facts
        rows={[
          ["Featured", "Hand-picked vaults with deep liquidity and a clean track record."],
          ["Stablecoin", "Dollar-pegged yields. Your balance stays in stablecoins."],
          ["Lending", "Supply an asset to a lending market and earn what borrowers pay."],
          ["Vaults", "Curated strategies that allocate your deposit across markets for you."],
          ["Fixed Yield", "Lock a rate today and hold to maturity."],
          ["Staking", "Stake and keep a liquid token that grows in value."],
          ["Perps", "Provide liquidity to perpetuals exchanges and earn from trading."],
        ]}
      />

      <H2>Filters and sorting</H2>
      <List
        items={[
          "Search by vault, asset or protocol name.",
          "Filter by the asset you want to deposit, by the manager running the strategy, or by how withdrawals work.",
          "Sort by APY or by TVL.",
          "Switch between the 7-day and the 30-day APY. Longer windows smooth out one-off spikes.",
        ]}
      />

      <H2>What a vault page shows</H2>
      <List
        items={[
          "The APY, broken into the vault's own yield, any rewards and any performance fee, with the APY after fees.",
          "An earnings estimate for an amount you choose, at the current rate.",
          "TVL, and the deposit cap if the vault has one.",
          "The deposit asset, the vault token you receive, the protocol and the manager.",
          <>How withdrawals work. See <A href="/withdrawals">Withdrawals</A>.</>,
        ]}
      />

      <Callout title="Only vaults you can use">
        Pecun only lists products it can actually deposit into for you. When a protocol closes, pauses or delists a vault, Pecun marks it as closed:
        no new deposits go in, but you can still withdraw.
      </Callout>
    </Doc>
  );
}
