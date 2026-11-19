import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LegalPage, type LegalSection } from "@/components/legal";
import { LEGAL, UNSUPPORTED_REGIONS, WEBSITE_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service", description: "The terms for using Pecun: what Pecun does, the third-party protocols and providers it relies on, wallets, fees, eligibility, risks, liability and disputes." };

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link className="font-medium text-[#2f7d1c] underline decoration-[#2f7d1c]/30 underline-offset-[3px] hover:decoration-[#2f7d1c]" href={href}>
    {children}
  </Link>
);
const mail = <a className="font-medium text-[#2f7d1c] underline decoration-[#2f7d1c]/30 underline-offset-[3px] hover:decoration-[#2f7d1c]" href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;
const B = ({ children }: { children: ReactNode }) => <span className="font-medium text-ink">{children}</span>;

/** Protocols Pecun currently lists. Kept here so the Terms name them plainly. */
const PROTOCOLS =
  "Aave, Morpho, Euler, Compound, Spark, Sky, Fluid, Moonwell, Pendle, Yearn, Beefy, Lagoon, Lido, Ember, Upshift, Gearbox, Kamino, Jupiter Lend, Marinade, Meteora, Jito and other Solana stake pools, NAVI, Scallop, Suilend, Aftermath, Hyperliquid, Venus, Silo, GMX, Jupiter, Volo, Rocket Pool, Frax, ether.fi, Resolv, Kinetiq, Spectra, Avantis and HyperLend";

const SECTIONS: LegalSection[] = [
  {
    heading: "The Services",
    body: [],
    subsections: [
      {
        heading: "What Pecun is",
        body: [
          <>
            Pecun provides a website and app (the <B>&quot;App&quot;</B>) that finds yield opportunities across EVM blockchains, Solana, Sui and
            Hyperliquid, shows information about them, and prepares the blockchain transactions you need to deposit into and withdraw from them. The App,
            together with any related content, tools, documentation and features, makes up the <B>&quot;Services&quot;</B>.
          </>,
          "Pecun is an interface. It does not run the yield products it shows, does not hold or control the assets you deposit, and does not trade, lend or invest on your behalf. Every transaction you make through the App is one you approve, executed on a public blockchain.",
        ],
      },
      {
        heading: "Third-party protocols",
        body: [
          <>
            Every vault, lending market, liquidity pool, staking product and fixed-yield market shown in the App is created and operated by an independent
            third party (a <B>&quot;Third-Party Protocol&quot;</B>), not by Pecun. These currently include {PROTOCOLS}, and the curators and vault managers
            that run strategies on them.
          </>,
          "Third-Party Protocols are not part of the Services. Your use of them is governed by their own terms, and is entirely at your own risk. Pecun does not control, audit, endorse or guarantee any Third-Party Protocol, its smart contracts, its managers or its returns. Third-Party Protocols can be used without Pecun, and anyone can build their own interface to them.",
        ],
      },
      {
        heading: "Information shown in the App",
        body: [
          "APY, TVL, prices, rates, capacity and other figures in the App come from each Third-Party Protocol's own data, from blockchain data, and from the data providers listed in section 2. They are estimates for information only. They may be delayed, incomplete or wrong, and actual returns can differ greatly. A yield shown today is not a promise of any future return.",
          "Pecun may add, change, hide or remove listed products at any time. When a Third-Party Protocol freezes, pauses, deprecates or delists a product, Pecun may close new deposits to it and show it as withdraw-only or paused, but Pecun cannot guarantee it will detect every such change, and whether and when you can withdraw is decided by the Third-Party Protocol.",
        ],
      },
      {
        heading: "Updates and monitoring",
        body: [
          "We may update, change or improve the Services at any time, including their software, infrastructure, security measures and features. We are not obliged to monitor how the Services are used, but we may do so to operate them, enforce these Terms and comply with the law.",
        ],
      },
      {
        heading: "Suspension and emergency measures",
        body: [
          "We may, at our discretion and with or without notice, suspend, restrict or discontinue all or part of the Services; take emergency measures in response to security threats, market events, regulatory concerns or anything else we consider serious; limit or end your access; or refuse to build or route any transaction. We are not liable to you for any such action. Your positions in Third-Party Protocols remain on-chain and can still be managed directly through those protocols.",
        ],
      },
    ],
  },
  {
    heading: "Third-party service providers",
    body: [
      "To run the Services, Pecun relies on outside companies and networks (\"Service Providers\") that Pecun does not own or control. By using the Services you agree that these providers are involved in handling your requests, and that their own terms and privacy policies may also apply. They currently include:",
    ],
    bullets: [
      <>
        <B>Wallet infrastructure</B> — Turnkey, which creates and secures the embedded wallet you use in the App and handles signing when you approve a
        transaction.
      </>,
      <>
        <B>Bridges and swap routers</B> — including Relay, LI.FI, Across, deBridge, Mayan and decentralised exchange aggregators, which move your funds
        between blockchains or swap one token for another when a deposit or withdrawal needs it. Pecun compares their quotes and may pick a route for you.
      </>,
      <>
        <B>Data providers</B> — each Third-Party Protocol&apos;s own APIs and software development kits, LI.FI&apos;s token and price data, and blockchain
        node (RPC) provider Alchemy.
      </>,
      <>
        <B>Hosting and infrastructure</B> — cloud hosting, content delivery and logging providers that run the website and App.
      </>,
    ],
    subsections: [
      {
        heading: "No responsibility for Service Providers",
        body: [
          "Service Providers can fail, be delayed, be hacked, change their terms, block certain users or regions, or stop operating. Pecun is not responsible for their acts or omissions, including a bridge or router failing, delaying or mispricing a transfer, a data provider showing wrong figures, or a wallet or node provider being unavailable. We may add, replace or remove Service Providers at any time without notice, and this list will be updated from time to time.",
        ],
      },
    ],
  },
  {
    heading: "Your wallet",
    body: [],
    subsections: [
      {
        heading: "Embedded wallet",
        body: [
          "When you sign up, a self-custodial wallet is created for you through our wallet infrastructure provider and linked to the login methods you choose (for example email or a passkey). Pecun does not hold or know your private keys and cannot move your assets without your approval.",
          "You are responsible for keeping your login methods, devices and any recovery details secure, and for every transaction approved from your account. If you lose access to your login methods, Pecun may be unable to help you recover your wallet.",
        ],
      },
      {
        heading: "Other wallets",
        body: [
          "If you connect a third-party wallet, you use it under that wallet provider's own terms. Third-party wallets are not operated, supported or controlled by Pecun, and we are not responsible for how they work with the Services.",
        ],
      },
      {
        heading: "Transactions are final",
        body: [
          "Blockchain transactions are irreversible once confirmed. Pecun cannot cancel, reverse or refund them. Check the amount, asset, network and destination before you approve. Transactions can fail because of network congestion, changes in on-chain conditions, protocol limits or provider errors, and Pecun is not liable for failed or delayed transactions.",
        ],
      },
    ],
  },
  {
    heading: "Fees and taxes",
    body: [],
    subsections: [
      {
        heading: "Pecun's fees",
        body: [
          "Pecun charges a fee on each deposit and on each withdrawal made through the App. The fee is shown before you confirm and is paid as a transfer to Pecun; on deposits it is taken once your funds have entered the product, and no fee is taken if a deposit does not complete. Fees are not refundable once taken, including when a Third-Party Protocol later loses value.",
        ],
      },
      {
        heading: "Third-party fees",
        body: [
          "Third-Party Protocols and Service Providers may charge their own fees, such as performance, management, deposit, withdrawal, unstaking, bridge or swap fees, and swaps may involve slippage. These are set by them, not by Pecun, and any estimate shown in the App may differ from what is actually charged.",
        ],
      },
      {
        heading: "Taxes",
        body: ["You are responsible for any taxes, duties or reporting that apply to your use of the Services and the products you use. Consider getting your own tax advice."],
      },
    ],
  },
  {
    heading: "Who may use the Services",
    body: [
      "You may use the Services only if you are at least 18 years old, able to form a binding contract, and not a Prohibited Person. A \"Prohibited Person\" is anyone who:",
    ],
    bullets: [
      "is named on a sanctions or restricted-party list maintained by the United States (including OFAC's Specially Designated Nationals list), the European Union or any EU member state, the United Kingdom, the United Nations, or any other applicable authority;",
      "is a citizen or resident of, located in, or organised in an unsupported region (the \"Prohibited Jurisdictions\" listed below);",
      "is otherwise someone Pecun is not allowed to deal with under applicable law; or",
      "is owned or controlled by, or acting for, any such person.",
    ],
    subsections: [
      {
        heading: "Prohibited Jurisdictions",
        body: ["Pecun is not available in the following regions. This list combines every region blocked by a Third-Party Protocol or Service Provider Pecun uses, and may change:"],
        bullets: UNSUPPORTED_REGIONS,
      },
      {
        heading: "Enforcement and information requests",
        body: [
          "We may use tools such as IP-based location checks and blockchain analytics to enforce these restrictions. Using a VPN or any other method to get around them is a breach of these Terms. We may ask you for information or documents to comply with anti-money-laundering, counter-terrorist-financing or sanctions laws, or if we have reason to believe your wallet is involved in illegal activity, and we may suspend your access until you provide them.",
          "You are solely responsible for complying with the laws that apply to you where you are located.",
        ],
      },
    ],
  },
  {
    heading: "Privacy",
    body: [
      <>
        How we collect and use personal data is explained in our <A href="/privacy">Privacy Policy</A>, which forms part of these Terms.
      </>,
    ],
  },
  {
    heading: "Your use of the Services",
    body: [],
    subsections: [
      {
        heading: "Licence to use",
        body: [
          "Subject to these Terms, we give you a personal, non-exclusive, non-transferable, non-sublicensable and revocable right to use the Services for your own non-commercial purposes. Access may be interrupted from time to time, for example for maintenance or because of equipment or provider failures.",
        ],
      },
      {
        heading: "What you must not do",
        body: ["Unless the law says otherwise or we agree in writing, you must not:"],
        bullets: [
          "use the Services for anything illegal, including money laundering, terrorist financing, fraud or evading sanctions;",
          "use funds or wallets you are not entitled to use;",
          "copy, resell, republish or commercially exploit the Services or any data obtained from them;",
          "decompile, reverse engineer or try to extract the source code of the Services, except where the law allows;",
          "use bots, scrapers or other automated means to access, collect data from or interact with the Services;",
          "attack, overload, probe or disrupt the Services, or the wallets, networks or protocols connected to them;",
          "get around any security measure, rate limit or region restriction;",
          "introduce viruses or other harmful code;",
          "impersonate anyone, or misrepresent your identity, location or connection with any person; or",
          "use the Services in any way these Terms do not allow.",
        ],
      },
    ],
  },
  {
    heading: "Ownership",
    body: [],
    subsections: [
      {
        heading: "The Services",
        body: [
          "The Services, including their design, text, graphics, software and other content, are owned by us or our licensors and protected by intellectual property laws. Apart from the licence in section 7.1, these Terms give you no rights in them.",
        ],
      },
      {
        heading: "Trademarks",
        body: [
          "The Pecun name and logo are our trademarks. The names and logos of Third-Party Protocols, tokens, networks and Service Providers belong to their owners and are used only to identify their products; their use does not mean they endorse, sponsor or are affiliated with Pecun.",
        ],
      },
      {
        heading: "Feedback",
        body: ["If you send us ideas, suggestions or bug reports, we may use them freely without any obligation or payment to you."],
      },
    ],
  },
  {
    heading: "Risks",
    body: [
      <>
        Using the Services and Third-Party Protocols involves significant risk, and you could lose some or all of what you deposit. By using the Services
        you confirm that you have read and understood the <A href="/risk-disclosure">Risk Disclosure</A>, which forms part of these Terms, and that you
        have enough knowledge of blockchains, digital assets and decentralised finance to assess those risks yourself. In particular, you accept that:
      </>,
    ],
    bullets: [
      "smart contracts, bridges and blockchains can fail, be exploited or behave unexpectedly, and losses may not be recoverable from anyone;",
      "Third-Party Protocols and their managers can change, pause, freeze or close products, and control how and when you can withdraw;",
      "digital assets are volatile, stablecoins can lose their peg, and the value of what you deposit can fall regardless of the yield it earns;",
      "laws and regulations can change and may restrict your access or the products available;",
      "digital assets are not bank deposits and are not protected by any deposit insurance or government guarantee.",
    ],
  },
  {
    heading: "No advice",
    body: [
      "Nothing in the Services is investment, financial, legal or tax advice, or a recommendation to buy, sell or hold any asset or use any product. We do not assess whether any product is suitable for you. Every deposit or withdrawal you make is your own decision, made without advice or solicitation from Pecun.",
    ],
  },
  {
    heading: "Disclaimers",
    body: [
      "THE SERVICES ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE\". TO THE FULLEST EXTENT ALLOWED BY LAW, PECUN, ITS AFFILIATES AND THEIR DIRECTORS, OFFICERS, EMPLOYEES, AGENTS AND LICENSORS (THE \"PECUN PARTIES\") DISCLAIM ALL WARRANTIES, WHETHER EXPRESS, IMPLIED OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT.",
      "THE PECUN PARTIES DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, SECURE OR ERROR-FREE; THAT ANY INFORMATION SHOWN IS ACCURATE, COMPLETE OR CURRENT; OR THAT ANY THIRD-PARTY PROTOCOL, SERVICE PROVIDER, WALLET OR BLOCKCHAIN WILL WORK AS EXPECTED.",
    ],
  },
  {
    heading: "Limitation of liability",
    body: [
      "TO THE FULLEST EXTENT ALLOWED BY LAW, THE PECUN PARTIES WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, DIGITAL ASSETS OR GOODWILL, ARISING FROM OR RELATED TO THE SERVICES OR THESE TERMS, HOWEVER CAUSED, EVEN IF ADVISED OF THEIR POSSIBILITY.",
      "THE PECUN PARTIES ARE NOT LIABLE FOR LOSSES CAUSED BY THIRD-PARTY PROTOCOLS, SERVICE PROVIDERS, WALLETS, BLOCKCHAINS, MARKET MOVEMENTS, YOUR OWN TRANSACTIONS, OR UNAUTHORISED ACCESS TO YOUR ACCOUNT THAT IS NOT OUR FAULT.",
      "THE PECUN PARTIES' TOTAL LIABILITY TO YOU FOR ALL CLAIMS RELATING TO THE SERVICES WILL NOT EXCEED THE GREATER OF (A) THE FEES YOU PAID TO PECUN IN THE 12 MONTHS BEFORE THE CLAIM AROSE AND (B) ONE HUNDRED US DOLLARS (US$100).",
      "Nothing in these Terms limits liability that cannot be limited by law, such as liability for fraud. Some jurisdictions do not allow certain exclusions, so some of the above may not apply to you.",
    ],
  },
  {
    heading: "Indemnity",
    body: [
      "You agree to defend, indemnify and hold harmless the Pecun Parties from any claims, losses, liabilities, damages, costs and expenses (including reasonable legal fees) arising from your breach of these Terms or the law, your violation of anyone else's rights, or your misuse of the Services. We may take control of the defence of any such claim, and you agree to cooperate with us.",
    ],
  },
  {
    heading: "Disputes, arbitration and class action waiver",
    body: ["Please read this section carefully. It affects how disputes are resolved and limits your right to go to court or join a class action."],
    subsections: [
      {
        heading: "Talk to us first",
        body: [
          <>
            If you have a dispute with us, contact us first at {mail}. You and we agree to try in good faith to resolve it informally for at least 30 days
            before starting any formal proceedings.
          </>,
        ],
      },
      {
        heading: "Arbitration",
        body: [
          "If the dispute is not resolved informally, any dispute, claim or controversy arising from or relating to these Terms or the Services (including whether this section applies) will be finally resolved by confidential, binding arbitration under the rules of a recognised arbitration body in the country or region where you live, with the arbitration held there. Where arbitration is not allowed or not available under the law of your country or region, the dispute will be decided by its competent courts. The arbitration or court proceedings will be conducted in English unless the law of your country or region requires otherwise.",
        ],
      },
      {
        heading: "Class action waiver",
        body: [
          "TO THE FULLEST EXTENT ALLOWED BY LAW, YOU AND WE EACH WAIVE ANY RIGHT TO A JURY TRIAL AND TO TAKE PART IN A CLASS, COLLECTIVE OR REPRESENTATIVE ACTION. Claims may be brought only on an individual basis.",
        ],
      },
      {
        heading: "Exceptions",
        body: [
          "Either party may bring an individual claim in a small-claims court where it qualifies, or ask a court for urgent injunctive relief or to protect intellectual property rights.",
        ],
      },
    ],
  },
  {
    heading: "Changes to these Terms",
    body: [
      "We may change these Terms from time to time. We will update the \"Last updated\" date above, and for material changes we will make reasonable efforts to tell you, for example with a notice in the App. Changes take effect when posted unless we say otherwise. If you keep using the Services after a change takes effect, you accept the new Terms. A change will not apply to a dispute already in arbitration.",
    ],
  },
  {
    heading: "Suspension and termination",
    body: [
      "We may suspend or end your access to the Services at any time, with or without notice, including if we believe you have breached these Terms, given us false information, are a Prohibited Person, or if we need to do so to comply with the law. You may stop using the Services at any time. Sections that by their nature should survive termination, including those on fees, risks, disclaimers, limitation of liability, indemnity and disputes, will continue to apply.",
    ],
  },
  {
    heading: "Events beyond our control",
    body: [
      "We are not liable for any failure or delay caused by events beyond our reasonable control, including blockchain or network outages, failures of Third-Party Protocols or Service Providers, cyberattacks, natural disasters, war, civil unrest, pandemics, power or internet failures, or actions by governments or regulators.",
    ],
  },
  {
    heading: "General",
    body: [],
    subsections: [
      {
        heading: "Governing law",
        body: [
          "These Terms, and any dispute arising from them or the Services, are governed by the laws of the country or region where you live. Nothing in these Terms takes away any protection you have under the mandatory laws of your country or region.",
        ],
      },
      {
        heading: "Entire agreement",
        body: [
          <>
            These Terms, together with the <A href="/privacy">Privacy Policy</A> and the <A href="/risk-disclosure">Risk Disclosure</A>, are the entire
            agreement between you and Pecun about the Services.
          </>,
        ],
      },
      {
        heading: "Other terms",
        body: [
          "If any part of these Terms is found unenforceable, the rest stays in effect. Our failure to enforce a right is not a waiver of it. You may not transfer your rights under these Terms without our written consent; we may transfer ours. Headings are for convenience only.",
        ],
      },
    ],
  },
  {
    heading: "Contact",
    body: [<>Questions about these Terms: {mail}.</>],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      subtitle="Terms and conditions for using Pecun Finance"
      effective={LEGAL.effectiveDate}
      contents
      intro={
        <>
          <p>
            These Terms of Service (the &quot;Terms&quot;) explain the conditions for accessing and using the Pecun website at {WEBSITE_URL.replace(/^https?:\/\//, "")}, the
            Pecun app, and any related services, operated by {LEGAL.entity} (&quot;Pecun&quot;, &quot;we&quot;, &quot;us&quot;). By accessing or using
            them you agree to these Terms. If you do not understand or agree to them, do not use Pecun.
          </p>
          <p>
            <B>Important:</B> section 14 contains an arbitration agreement and a class action waiver. Please read it carefully.
          </p>
          <p>
            &quot;You&quot; means you as the user. If you use Pecun on behalf of a company or other entity, you confirm you are authorised to accept
            these Terms for it, and &quot;you&quot; includes that entity.
          </p>
        </>
      }
      sections={SECTIONS}
    />
  );
}
