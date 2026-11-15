import type { Metadata } from "next";
import { Doc, Facts, H2, P } from "@/components/chrome";

export const metadata: Metadata = { title: "Partners and providers", description: "The infrastructure Pecun runs on." };

export default function Providers() {
  return (
    <Doc href="/providers">
      <P>Pecun is built on specialist infrastructure. These companies are involved in handling your requests, under their own terms.</P>

      <H2>Who does what</H2>
      <Facts
        rows={[
          ["Turnkey", "Wallet infrastructure. Creates and secures your self-custodial wallet and handles signing when you approve a transaction."],
          ["Relay and LI.FI", "Routing. Move funds and swap one token for another when a deposit or withdrawal needs it. Pecun compares quotes and picks a route."],
          ["Across, deBridge and Mayan", "Additional routes, used when they offer a better transfer."],
          ["Aftermath", "Swap aggregation for some deposits and withdrawals."],
          ["Transaction sponsors", "Relayers and paymasters that pay network fees on your behalf."],
          ["Protocol data", "Each protocol's own APIs and SDKs, plus LI.FI's token and price data, for rates, TVL and prices."],
          ["Node providers", "Services such as PublicNode that read and submit on-chain data."],
        ]}
      />
    </Doc>
  );
}
