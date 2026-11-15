import type { Metadata } from "next";
import { A, Callout, Doc, H2, List, P, Steps } from "@/components/chrome";

export const metadata: Metadata = { title: "Deposits", description: "How a deposit goes from your Pecun wallet into a protocol." };

export default function Deposits() {
  return (
    <Doc href="/deposits">
      <P>
        A deposit moves money from your Pecun wallet into the protocol you picked. In return you usually receive a vault or position token that
        represents your share and grows as the vault earns.
      </P>

      <H2>What happens when you deposit</H2>
      <Steps
        items={[
          { title: "You choose an amount", body: "Pecun shows what you'll deposit, the fee, the APY after fees and how withdrawals work for this vault." },
          { title: "Pecun prepares the transaction", body: "If the vault takes a different asset from the one you hold, Pecun finds a swap route first and includes it." },
          { title: "You approve it", body: "Nothing moves until you confirm from your wallet." },
          { title: "It settles on-chain", body: "Your funds go straight into the protocol. The position appears in your portfolio, with pending items tracked until they settle." },
        ]}
      />

      <H2>Good to know</H2>
      <List
        items={[
          "Some vaults have a deposit cap. When a vault is full, deposits pause until there's room.",
          "A vault that the protocol has closed shows as closed and won't take new deposits.",
          <>Pecun takes a small fee on each deposit, shown before you confirm. See <A href="/fees">Fees</A>.</>,
          "Blockchain transactions are final once confirmed. Check the amount and the vault before you approve.",
        ]}
      />

      <Callout title="Deposits are opening in stages">
        If a vault isn&apos;t open for deposits through Pecun yet, the vault page says so and the deposit button is disabled.
      </Callout>
    </Doc>
  );
}
