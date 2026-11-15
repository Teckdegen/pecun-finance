import type { Metadata } from "next";
import { A, Cards, Doc, H2, P } from "@/components/chrome";
import { APP_URL, CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Legal and contact", description: "Pecun's Terms of Service, Privacy Policy, Risk Disclosure and contact details." };

export default function Legal() {
  return (
    <Doc href="/legal">
      <P>
        These docs explain how Pecun works in plain language. The legal documents in the app are what actually apply, and they win if anything here
        differs.
      </P>

      <H2>Legal documents</H2>
      <Cards
        items={[
          { href: `${APP_URL}/terms`, title: "Terms of Service", body: "The rules for using Pecun, its fees, eligibility, liability and disputes.", external: true },
          { href: `${APP_URL}/privacy`, title: "Privacy Policy", body: "What data Pecun collects, why, and your rights.", external: true },
          { href: `${APP_URL}/risk-disclosure`, title: "Risk Disclosure", body: "The risks of using Pecun and the products it lists.", external: true },
        ]}
      />

      <H2>Contact</H2>
      <P>
        Email <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>. Pecun will never ask for your login codes, passkey or recovery details, by email or
        anywhere else.
      </P>
    </Doc>
  );
}
