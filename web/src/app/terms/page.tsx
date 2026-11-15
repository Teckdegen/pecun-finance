import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal";
import { pageMeta } from "@/lib/meta";
import { APP_URL, LEGAL, UNSUPPORTED_REGIONS } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Terms and Conditions",
  description: "The terms for using the PECUN website and, with the app terms, for using PECUN: what it does, fees, eligibility and risk.",
  path: "/terms",
});

const mail = (
  <a className="underline underline-offset-2" href={`mailto:${LEGAL.contactEmail}`}>
    {LEGAL.contactEmail}
  </a>
);

const appTerms = (
  <a className="underline underline-offset-2" href={`${APP_URL}/terms`}>
    app terms
  </a>
);

const SECTIONS: LegalSection[] = [
  {
    heading: "These terms",
    body: [
      <>
        These terms cover this website, operated by {LEGAL.entity}. Using the PECUN app is also covered by the {appTerms}, including wallets, transactions, service
        providers, liability and disputes. If the two differ on how the app works, the app terms win. By using this site you agree to these terms. If you
        don&apos;t, don&apos;t use it.
      </>,
    ],
  },
  {
    heading: "What PECUN is",
    body: [
      "PECUN is an interface. This site introduces it and shows live figures from the protocols it lists. The app finds yield across EVM chains, Solana, Sui and Hyperliquid and prepares the transactions you approve. PECUN does not run those products, does not hold your assets, and does not trade, lend or invest for you.",
      "Vaults, lending markets, staking and fixed yield are run by independent protocols and managers, under their own terms and at your own risk. PECUN does not control, audit, endorse or guarantee them or their returns.",
    ],
  },
  {
    heading: "Information on this site",
    body: [
      "Counts, APY, TVL and other figures come from protocol data and public chain data. They can be delayed, incomplete or wrong. A rate shown today is not a promise of any future return. Products can be added, hidden or removed, including when a protocol pauses or delists them.",
    ],
  },
  {
    heading: "The app, wallets and fees",
    body: [
      "Deposits and withdrawals happen in the app, from a self-custodial wallet. PECUN does not hold or know your private keys and cannot move assets without your approval. Blockchain transactions are irreversible once confirmed.",
      "PECUN charges a fee on deposits and withdrawals made through the app. The fee is shown before you confirm. Network fees are currently paid by PECUN, and that can change. Protocols and other providers may charge their own fees. You are responsible for your own taxes.",
    ],
  },
  {
    heading: "Who may use PECUN",
    body: [
      "You may use this site and the app only if you are at least 18, able to form a binding contract, and not in an unsupported region. PECUN is not offered in:",
    ],
    bullets: UNSUPPORTED_REGIONS,
  },
  {
    heading: "Risks and no advice",
    body: [
      "Yield can be lost. Smart contracts can fail, assets can depeg, and markets can move against you. You could lose what you deposit. Nothing on this site is financial, legal, tax or investment advice, or an offer to sell a security.",
      <>
        Read the risk disclosure in the app before you deposit:{" "}
        <a className="underline underline-offset-2" href={`${APP_URL}/risk-disclosure`}>
          {APP_URL}/risk-disclosure
        </a>
        .
      </>,
    ],
  },
  {
    heading: "This website",
    body: [
      "You may read this site and share links to it. You may not misuse it, try to break it, scrape it in a way that degrades it, or use it to break the law. The PECUN name, mark and site content belong to PECUN. Protocol names and logos belong to their owners and are shown to identify products.",
    ],
  },
  {
    heading: "Liability",
    body: [
      "The site and the figures on it are provided as available. PECUN is not liable for protocol losses, failed or delayed transactions, wrong or late data, or providers it does not control. Your positions remain on-chain and can be managed directly with the protocol.",
    ],
  },
  {
    heading: "Privacy",
    body: [
      <>
        How this site handles personal data is in the <a className="underline underline-offset-2" href="/privacy">Privacy Policy</a>.
      </>,
    ],
  },
  {
    heading: "Changes",
    body: ["We may update these terms. We'll change the date above when we do. Continuing to use the site after a change means you accept the updated terms."],
  },
  {
    heading: "Contact",
    body: [<>Questions about these terms: {mail}.</>],
  },
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <LegalPage
        title="Terms and Conditions"
        effective={LEGAL.effectiveDate}
        intro={<p>These terms explain what this PECUN website is, what PECUN does and does not do, and the rules for using it.</p>}
        sections={SECTIONS}
      />
    </main>
  );
}
