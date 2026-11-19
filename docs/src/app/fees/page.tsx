import type { Metadata } from "next";
import { Callout, Doc, Facts, H2, P } from "@/components/chrome";

export const metadata: Metadata = { title: "Fees", description: "What Pecun charges, and what protocols charge." };

export default function Fees() {
  return (
    <Doc href="/fees">
      <P>There are three kinds of cost when you use Pecun. You always see Pecun&apos;s fee before you confirm.</P>

      <H2>Who charges what</H2>
      <Facts
        rows={[
          ["Pecun's fee", "0.5% on each deposit and each withdrawal, in USDG. It's shown before you press. On a deposit it's only taken once the deposit lands; if a deposit fails, there's no fee."],
          ["Network fees", "Pecun pays them on Robinhood Chain. On every other chain, a deposit brings a small gas reserve in that chain's own gas token, from your deposit: about $0.15 on most chains, $0.60 of SOL on Solana, $0.30 of SUI on Sui, $0.75 for GMX pools and $1 on Ethereum. It stays in your wallet and covers your deposit and your withdrawal there. It's shown before you press, and only added when your wallet there is short on gas."],
          ["Protocol fees", "Set by each protocol, not by Pecun: performance, management, deposit, withdrawal or unstaking fees. Shown on the vault page where the protocol reports them."],
          ["Swaps and routing", "When a deposit or withdrawal needs a swap, routers may charge a fee and prices can move (slippage). The quote is shown before you confirm."],
        ]}
      />

      <H2>Performance fees and APY</H2>
      <P>
        Many vaults keep a share of what they earn as a performance fee. Pecun shows the APY after that fee, so the number you compare is close to what
        you actually earn.
      </P>

      <Callout title="Taxes">Pecun doesn&apos;t give tax advice. You&apos;re responsible for any taxes on what you earn.</Callout>
    </Doc>
  );
}
