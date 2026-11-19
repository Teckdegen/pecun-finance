import type { Metadata } from "next";
import { A, Callout, Doc, H2, List, P, Steps } from "@/components/chrome";

export const metadata: Metadata = { title: "Deposits", description: "How a deposit goes from your Pecun wallet into a protocol." };

export default function Deposits() {
  return (
    <Doc href="/deposits">
      <P>
        A deposit moves USDC from your Pecun wallet on Base into the vault you picked, on whichever chain it lives. Vaults on Base take it directly, with no bridge. It's one press: the
        bridge, the swaps and the deposit all happen for you. In return you receive the vault's position token, in your own wallet, which represents
        your share and grows as the vault earns.
      </P>

      <H2>What happens when you deposit</H2>
      <Steps
        items={[
          {
            title: "You choose an amount",
            body: "Before you press, Pecun shows the 0.5% fee, the bridge and swap costs, the total route cost and what you'll receive. Routes that would cost more than 0.5% don't run.",
          },
          {
            title: "Bridge from Base",
            body: "Your USDC moves to the vault's chain, by the cheapest of several bridges. A small part arrives as that chain's own coin (ETH, SOL, SUI and so on), so your transactions there always go through.",
          },
          { title: "Swap into the vault's asset", body: "The rest is swapped into exactly the asset the vault takes." },
          {
            title: "Deposit",
            body: "The asset goes into the vault and the position appears in your portfolio. Pecun's fee is only taken once the deposit lands.",
          },
        ]}
      />

      <H2>Good to know</H2>
      <List
        items={[
          "Some vaults have a deposit cap. When a vault is full, deposits pause until there's room.",
          "A vault that the protocol has closed shows as closed and won't take new deposits.",
          <>Pecun's fee is 0.5%, shown before you press and only taken once your deposit lands. See <A href="/fees">Fees</A>.</>,
          "If a deposit fails part-way, no fee is taken and anything that already moved is sent back to your wallet automatically.",
          "Blockchain transactions are final once confirmed. Check the amount and the vault before you approve.",
        ]}
      />

      <Callout title="Deposits are opening in stages">
        If a vault isn&apos;t open for deposits through Pecun yet, the vault page says so and the deposit button is disabled.
      </Callout>
    </Doc>
  );
}
