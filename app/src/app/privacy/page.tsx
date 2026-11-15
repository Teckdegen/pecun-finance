import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal";
import { pageMeta } from "@/lib/meta";
import { LEGAL } from "@/lib/site";

export const metadata = pageMeta({
  title: "Privacy Policy",
  description: "What Pecun collects, why, who it's shared with, how long it's kept and your choices.",
  path: "/privacy",
});

const mail = <a className="text-accent underline-offset-2 hover:underline" href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;

const SECTIONS: LegalSection[] = [
  {
    heading: "Who we are",
    body: [<>Pecun Finance is operated by {LEGAL.entity}, which is responsible for your personal data under this policy. Contact us at {mail}.</>],
  },
  {
    heading: "What we collect",
    body: ["We keep this to what we need to run Pecun:"],
    bullets: [
      "Account details: the email address or passkey you sign up with, used to create and secure your wallet with our wallet infrastructure provider. We never see or store your private keys.",
      "Wallet and transaction data: your wallet addresses, the transactions you make through Pecun, and your positions. Much of this is public on the blockchain anyway.",
      "Technical data: your IP address, device and browser type, and basic logs, used to keep the Service secure, prevent abuse and enforce region restrictions.",
      "Your choices: for example your cookie preference, stored on your device.",
    ],
  },
  {
    heading: "How we use it",
    body: ["We use your data to:"],
    bullets: [
      "create your account and wallet and let you sign in;",
      "build, route and track the transactions you ask for, and show your portfolio;",
      "charge Pecun's fees and keep accurate records;",
      "keep the Service secure, detect fraud and abuse, and block unsupported regions and sanctioned persons;",
      "meet our legal obligations;",
      "fix problems and improve the Service.",
    ],
  },
  {
    heading: "Who we share it with",
    body: ["We don't sell your personal data. We share it only where needed to run Pecun:"],
    bullets: [
      "Wallet infrastructure: our wallet provider, which creates and secures your wallet.",
      "Blockchain networks: transactions you make are broadcast to public blockchains, where anyone can see them.",
      "Routing providers: bridges and swap routers receive your wallet address and transaction details to move funds between chains or tokens.",
      "Hosting, network and data providers that run our servers and connect to blockchains.",
      "Authorities, when the law requires it, or to protect our users and the Service.",
    ],
  },
  {
    heading: "Public blockchains",
    body: [
      "Transactions on public blockchains are permanent and visible to anyone. We can't change or delete them, even if you ask us to delete your account.",
    ],
  },
  {
    heading: "Cookies and local storage",
    body: [
      "Pecun uses only what's needed to work: for example remembering your session and your cookie choice. We don't use advertising cookies. If we add analytics, they'll only run if you choose \"Accept all\" in the cookie banner. You can change your choice any time by clearing this site's data in your browser.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "We keep account data while your account is open, and afterwards only as long as the law requires (for example for anti-money-laundering or tax records). Technical logs are kept for a short period for security, then deleted.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      <>Depending on where you live, you can ask to see, correct, export or delete your personal data, or object to how we use it. Email {mail}. We&apos;ll answer within the time the law requires. If you&apos;re unhappy with our answer, you can complain to your local data protection authority.</>,
    ],
  },
  {
    heading: "International transfers",
    body: ["Our providers may process data in other countries. Where the law requires, we use safeguards such as standard contractual clauses."],
  },
  {
    heading: "Security",
    body: ["We protect your data with access controls, encryption in transit and reputable infrastructure providers. No system is perfectly secure, so keep your login methods safe."],
  },
  {
    heading: "Children",
    body: ["Pecun is only for people aged 18 or over. We don't knowingly collect data from children."],
  },
  {
    heading: "Changes to this policy",
    body: [
      <>We may update this policy. We&apos;ll change the effective date above and tell you in the app about significant changes. See also our <Link className="text-accent underline-offset-2 hover:underline" href="/terms">Terms and Conditions</Link>.</>,
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      effective={LEGAL.effectiveDate}
      intro={<p>This policy explains what personal data Pecun collects, why, who it&apos;s shared with, how long it&apos;s kept and the choices you have.</p>}
      sections={SECTIONS}
    />
  );
}
