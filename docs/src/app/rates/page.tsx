import type { Metadata } from "next";
import { Callout, Doc, Facts, H2, List, P } from "@/components/chrome";

export const metadata: Metadata = { title: "Rates and APY", description: "Where Pecun's rates come from and what they include." };

export default function Rates() {
  return (
    <Doc href="/rates">
      <P>
        Every rate on Pecun comes from the protocol itself, read live from its own data. Pecun doesn&apos;t set rates and doesn&apos;t add anything to
        them.
      </P>

      <H2>How to read a rate</H2>
      <Facts
        rows={[
          ["APY", "The yearly rate if today's yield continued for a year, with earnings compounding."],
          ["7-day and 30-day APY", "The rate averaged over the last week or month. Switch between them on the Explore page."],
          ["Vault yield", "What the vault itself earns, measured by the change in its share value."],
          ["Rewards", "Extra incentives some protocols pay on top, often in their own token."],
          ["APY after fees", "The rate once the vault's performance fee is taken out. This is the number to compare."],
          ["TVL", "The total amount deposited in the product."],
        ]}
      />

      <H2>Why rates move</H2>
      <List
        items={[
          "Lending rates follow how much is borrowed. When borrowing demand drops, so does the rate.",
          "Vault yields depend on the markets the strategy uses.",
          "Rewards programmes start, change and end.",
          "Big deposits into a small vault can dilute its rate.",
        ]}
      />

      <Callout tone="warn" title="A rate isn't a promise">
        Rates change all the time and past rates don&apos;t predict future ones. Treat any APY as today&apos;s figure, and estimates in the app as just
        that.
      </Callout>
    </Doc>
  );
}
