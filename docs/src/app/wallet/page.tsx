import type { Metadata } from "next";
import { Callout, Doc, Facts, H2, List, P } from "@/components/chrome";

export const metadata: Metadata = { title: "Wallet and custody", description: "Your self-custodial Pecun wallet, secured by Turnkey." };

export default function Wallet() {
  return (
    <Doc href="/wallet">
      <P>
        When you sign up, Pecun creates a self-custodial wallet for you, built on Turnkey&apos;s wallet infrastructure. It&apos;s yours: Pecun never
        holds or sees your private keys, and can&apos;t move your funds.
      </P>

      <H2>How it works</H2>
      <Facts
        rows={[
          ["Created by", "Turnkey, the wallet infrastructure behind your Pecun account."],
          ["Signing in", "With the login methods you choose, such as email or a passkey."],
          ["Approvals", "Every transaction needs your approval. Nothing moves without it."],
          ["Pecun's access", "None. Pecun can't sign for you, move your funds or freeze your wallet."],
        ]}
      />

      <H2>Keeping it safe</H2>
      <List
        items={[
          "Keep your email account and devices secure. Whoever controls your login can approve transactions.",
          "Prefer a passkey where you can. It's tied to your device and hard to phish.",
          "Pecun will never ask for your login codes, passkey or recovery details. Anyone who does isn't Pecun.",
          "Check the amount and destination before you approve anything.",
        ]}
      />

      <Callout tone="warn" title="Transactions are final">
        Blockchain transactions can&apos;t be reversed once confirmed, by Pecun or anyone else. If you lose access to your login methods, Pecun may not be
        able to help you recover your wallet.
      </Callout>
    </Doc>
  );
}
