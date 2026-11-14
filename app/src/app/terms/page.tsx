import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal";
import { pageMeta } from "@/lib/meta";
import { LEGAL, UNSUPPORTED_REGIONS } from "@/lib/site";

export const metadata = pageMeta({
  title: "Terms and Conditions",
  description: "The terms for using PECUN: eligibility, unsupported regions, fees, third-party protocols, risks and liability.",
  path: "/terms",
});

const mail = <a className="text-accent underline-offset-2 hover:underline" href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;

const SECTIONS: LegalSection[] = [
  {
    heading: "Who we are and what these terms cover",
    body: [
      <>PECUN Finance (&quot;PECUN&quot;, &quot;we&quot;, &quot;us&quot;) is operated by {LEGAL.entity}. These terms apply to your use of the PECUN website and app (the &quot;Service&quot;). By using the Service you agree to them. If you don&apos;t agree, don&apos;t use the Service.</>,
    ],
  },
  {
    heading: "Who can use PECUN",
    body: [
      "You must be at least 18 years old and able to enter into a binding contract. You must not be a resident of, located in, or acting for anyone in a region PECUN does not support, and you must not be on any sanctions list.",
      "PECUN is not available in these regions:",
    ],
    bullets: UNSUPPORTED_REGIONS,
  },
  {
    heading: "What PECUN does",
    body: [
      "PECUN shows yield opportunities offered by independent protocols on EVM chains, Solana, Sui and Hyperliquid, and builds the transactions to deposit into and withdraw from them. Every vault, lending market, pool and staking product is operated by a third party, not by PECUN.",
      "PECUN does not hold the assets you deposit, manage strategies, make investment decisions or give investment, legal or tax advice. Nothing on the Service is a recommendation to buy, sell or hold any asset.",
    ],
  },
  {
    heading: "Your wallet and transactions",
    body: [
      "You are responsible for your account, your login methods and every transaction you approve. Blockchain transactions are final: once confirmed they can't be reversed by PECUN. Check the amount, asset, chain and destination before you confirm.",
    ],
  },
  {
    heading: "Fees",
    body: [
      "PECUN charges a fee when you deposit and when you withdraw. The fee is shown before you confirm and is taken as part of the transaction. Protocols may charge their own fees (for example performance, management, withdrawal or unstaking fees), which are separate from PECUN's and set by them.",
      "PECUN currently pays network (gas) fees for you. We may change this, and any change will be shown before you confirm a transaction.",
    ],
  },
  {
    heading: "Third-party protocols and services",
    body: [
      "When you use a product through PECUN you also deal with the protocol that runs it, and that protocol's own terms apply. Moving funds between chains or tokens may use third-party bridges and swap routers. We don't control these parties and aren't responsible for their actions, outages, losses or decisions, including freezing, pausing or delisting a product.",
    ],
  },
  {
    heading: "Risks",
    body: [
      <>
        Using the Service involves significant risk, including the loss of everything you deposit. Read our{" "}
        <Link className="text-accent underline-offset-2 hover:underline" href="/risk-disclosure">Risk Disclosure</Link> before you use PECUN. By using the
        Service you confirm you understand and accept those risks.
      </>,
    ],
  },
  {
    heading: "Information on the Service",
    body: [
      "APY, TVL and other figures come from each protocol's own data and may be delayed, estimated or wrong. APYs are variable and are not a promise of future returns. We may add, change or remove listed products at any time.",
    ],
  },
  {
    heading: "What you must not do",
    body: ["You agree not to:"],
    bullets: [
      "use the Service for anything illegal, including money laundering, terrorist financing or evading sanctions;",
      "use a VPN or any other method to get around our region restrictions;",
      "use funds or wallets that aren't yours to use;",
      "attack, overload, scrape or try to break the Service, or interfere with other users.",
    ],
  },
  {
    heading: "Changes to the Service and access",
    body: [
      "We may change, suspend or stop any part of the Service, and may limit or end your access if we reasonably believe you've broken these terms or the law, or to comply with legal requirements. Your positions stay on-chain and can still be managed directly through each protocol.",
    ],
  },
  {
    heading: "Intellectual property",
    body: ["The PECUN name, logo, design and software belong to us or our licensors. Protocol names and logos belong to their owners and are used only to identify their products."],
  },
  {
    heading: "No warranty",
    body: ["The Service is provided \"as is\" and \"as available\", without warranties of any kind, to the fullest extent the law allows. We don't promise it will be uninterrupted, error-free or secure."],
  },
  {
    heading: "Limitation of liability",
    body: [
      "To the fullest extent the law allows, PECUN and its team are not liable for any indirect or consequential loss, or for losses caused by third-party protocols, bridges, networks, market movements, or your own transactions. Nothing in these terms limits liability that can't be limited by law.",
    ],
  },
  {
    heading: "Indemnity",
    body: ["You agree to cover our reasonable losses and costs arising from your breach of these terms or your misuse of the Service."],
  },
  {
    heading: "Changes to these terms",
    body: ["We may update these terms. We'll change the effective date above, and for significant changes we'll tell you in the app. Using the Service after a change means you accept the new terms."],
  },
  {
    heading: "Contact",
    body: [
      <>Questions about these terms: {mail}. See also our <Link className="text-accent underline-offset-2 hover:underline" href="/privacy">Privacy Policy</Link>.</>,
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms and Conditions"
      effective={LEGAL.effectiveDate}
      intro={<p>Please read these terms carefully. They explain who can use PECUN, what it does and doesn&apos;t do, the fees, and the risks you take on.</p>}
      sections={SECTIONS}
    />
  );
}
