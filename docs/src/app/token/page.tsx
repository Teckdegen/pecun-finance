import type { Metadata } from "next";
import { Callout, Doc, H2, List, P } from "@/components/chrome";

export const metadata: Metadata = { title: "Pecun token", description: "What we can share about the Pecun token so far." };

export default function Token() {
  return (
    <Doc href="/token">
      <P>
        A Pecun token is in the works. Its name, supply, what it does in the app and the launch details will be published on this page first, and
        announced on Pecun&apos;s official channels.
      </P>

      <Callout tone="warn" title="No Pecun token has launched yet">
        Until it&apos;s announced here, any token, airdrop, presale or claim page calling itself Pecun is not ours. Pecun will never ask you to send funds
        to receive a token, and will never ask for your login codes or passkey.
      </Callout>

      <H2>What will be published here</H2>
      <List
        items={[
          "The token's name, ticker and contract addresses.",
          "What the token is used for in Pecun.",
          "Supply and distribution.",
          "Launch timing, and where it's available.",
          "The terms and risks that apply to it.",
        ]}
      />
    </Doc>
  );
}
