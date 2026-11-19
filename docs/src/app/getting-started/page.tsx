import type { Metadata } from "next";
import { A, Callout, Doc, H2, List, P, Steps } from "@/components/chrome";
import { APP_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Getting started", description: "Sign up for Pecun, add funds and make your first deposit." };

export default function GettingStarted() {
  return (
    <Doc href="/getting-started">
      <P>You can browse every yield on Pecun without an account. To deposit, you need a Pecun wallet, which takes about a minute to set up.</P>

      <H2>Make your first deposit</H2>
      <Steps
        items={[
          {
            title: "Open the app and sign up",
            body: (
              <>
                Go to <A href={APP_URL}>the Pecun app</A> and choose Sign up. You can sign in with email or a passkey.
              </>
            ),
          },
          {
            title: "Accept the terms",
            body: (
              <>
                The first time you use Pecun on a device, you&apos;ll be asked to agree to the Terms, the Privacy Policy and the Risk Disclosure. Read them, they
                explain what Pecun does and doesn&apos;t do.
              </>
            ),
          },
          {
            title: "Your wallet is created",
            body: (
              <>
                Pecun creates a self-custodial wallet for you, secured by Turnkey. Only you can approve transactions from it. See{" "}
                <A href="/wallet">Wallet and custody</A>.
              </>
            ),
          },
          { title: "Add funds", body: "Send USDC on Base to your Pecun wallet address, shown in the app. Only send USDC on the Base network, and double-check the address before you send." },
          {
            title: "Pick a vault",
            body: (
              <>
                Browse by category or asset and open a vault to see its rate, how withdrawals work and what it charges. See <A href="/explore">Exploring yields</A>.
              </>
            ),
          },
          { title: "Deposit", body: "Enter an amount, check the fees and the APY after fees, and confirm. Your position shows up in your portfolio." },
        ]}
      />

      <Callout title="Deposits are opening in stages">
        Where a vault isn&apos;t open for deposits through Pecun yet, the vault page says so and the deposit button stays disabled. You can still see its
        rate and details.
      </Callout>

      <H2>Before you deposit</H2>
      <List
        items={[
          "Check how withdrawals work for that vault. Some pay out instantly, others take time.",
          "Look at the APY after fees, not just the headline rate.",
          <>Only deposit what you can afford to lose. Read <A href="/risks">Risks</A>.</>,
          <>Make sure Pecun is available where you are. See <A href="/availability">Availability</A>.</>,
        ]}
      />
    </Doc>
  );
}
