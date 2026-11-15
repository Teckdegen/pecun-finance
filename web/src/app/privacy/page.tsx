import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal";
import { pageMeta } from "@/lib/meta";
import { APP_URL, LEGAL } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Privacy Policy",
  description: "What this PECUN site collects, why, who it's shared with, how long it's kept and your choices.",
  path: "/privacy",
});

const mail = (
  <a className="underline underline-offset-2" href={`mailto:${LEGAL.contactEmail}`}>
    {LEGAL.contactEmail}
  </a>
);

const SECTIONS: LegalSection[] = [
  {
    heading: "Who we are",
    body: [
      <>
        This policy covers the PECUN website. It is operated by {LEGAL.entity}, which is responsible for personal data collected here. Contact us at {mail}. The
        app has its own policy at{" "}
        <a className="underline underline-offset-2" href={`${APP_URL}/privacy`}>
          {APP_URL}/privacy
        </a>
        , which covers accounts, wallets and transactions.
      </>,
    ],
  },
  {
    heading: "What we collect",
    body: ["On this website we keep collection small:"],
    bullets: [
      "Technical data: your IP address, device and browser type, and basic logs, used to serve the site, keep it secure and enforce region restrictions.",
      "Your cookie choice, stored on your device.",
      "What you type into the contact form. That stays in your browser so the thank-you page can open an email. This site does not keep a copy on our servers.",
      "If you email us, we keep that email and message so we can reply.",
    ],
  },
  {
    heading: "How we use it",
    body: ["We use this data to run and protect the website, remember your cookie choice, reply when you write to us, and meet legal obligations. We don't sell personal data and we don't use it for advertising."],
  },
  {
    heading: "Who we share it with",
    body: ["We share personal data only where needed to run the site: hosting and logging providers that serve these pages, and authorities when the law requires it. If you use the app, the providers named in the app privacy policy apply there."],
  },
  {
    heading: "Cookies and local storage",
    body: [
      "Essential storage remembers your cookie choice. The contact form uses session storage on your device so a message can be handed to your email app. We don't use advertising cookies. Analytics run only if you choose \"Accept all\" in the cookie banner. Clear this site's data in your browser to reset that choice.",
    ],
  },
  {
    heading: "How long we keep it",
    body: ["Cookie and form data in your browser stay until you clear them or the tab session ends. Emails you send us are kept while we need them to reply, and afterwards only as long as the law requires. Technical logs are kept for a short period for security, then deleted."],
  },
  {
    heading: "Your rights",
    body: [
      <>
        Depending on where you live, you can ask to see, correct, export or delete your personal data, or object to how we use it. Email {mail}. We&apos;ll answer within the time the law requires. If you&apos;re unhappy with our answer, you can complain to your local data protection authority.
      </>,
    ],
  },
  {
    heading: "International transfers",
    body: ["Our hosting providers may process data in other countries. Where the law requires, we use safeguards such as standard contractual clauses."],
  },
  {
    heading: "Security",
    body: ["We protect the site with access controls and encryption in transit. No system is perfectly secure."],
  },
  {
    heading: "Children",
    body: ["This site is only for people aged 18 or over. We don't knowingly collect data from children."],
  },
  {
    heading: "Changes",
    body: [
      <>
        We may update this policy. We&apos;ll change the date above when we do. See also the <a className="underline underline-offset-2" href="/terms">Terms and Conditions</a>.
      </>,
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <LegalPage
        title="Privacy Policy"
        effective={LEGAL.effectiveDate}
        intro={<p>This policy explains what personal data this PECUN website collects, why, who it&apos;s shared with, how long it&apos;s kept and the choices you have.</p>}
        sections={SECTIONS}
      />
    </main>
  );
}
