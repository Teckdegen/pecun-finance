import type { Metadata } from "next";
import { A, Callout, Doc, Facts, H2, P } from "@/components/chrome";

export const metadata: Metadata = { title: "Withdrawals", description: "Instant exit, withdrawal queues and maturity on Pecun." };

export default function Withdrawals() {
  return (
    <Doc href="/withdrawals">
      <P>
        How fast you can withdraw depends on the vault, not on Pecun. Every vault page tells you how withdrawals work before you deposit, so check it
        first.
      </P>

      <H2>The three kinds of withdrawal</H2>
      <Facts
        rows={[
          ["Instant", "You get your money back in the same transaction. Most lending markets and many vaults work this way."],
          ["Withdrawal queue", "The protocol processes withdrawals over time, for example while staked assets unbond. Your request is tracked in the app until it pays out."],
          ["At maturity", "Fixed-yield positions pay out at a set date. You can often exit earlier by selling the position, at the market price."],
        ]}
      />

      <H2>Instant exit</H2>
      <P>
        Some queued vaults offer an instant exit. Instead of waiting, you get part of your withdrawal right away through a partner, and the rest is
        released when the vault finishes processing. The vault page shows how much you get now, the fee for it and how much capacity is left. You can
        always choose to wait out the normal schedule instead.
      </P>

      <H2>Tracking a withdrawal</H2>
      <P>
        Pending withdrawals show in your portfolio under Pending Withdrawals until they settle. Withdrawals that are already paid appear in your
        history.
      </P>

      <Callout title="Fees on withdrawals">
        Pecun takes a small fee on each withdrawal, shown before you confirm. Some protocols charge their own withdrawal or unstaking fees. See{" "}
        <A href="/fees">Fees</A>.
      </Callout>
    </Doc>
  );
}
