import { ContactForm } from "./contact-form";
import { PecunMark } from "./logo";
import { APP_URL, LEGAL } from "@/lib/site";

/** Site footer: brand, legal links, and the contact form. */
export function Footer() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-16 md:py-16">
        <div>
          <a href="/" className="inline-flex items-center gap-2" aria-label="Pecun home">
            <PecunMark size={26} />
            <span className="text-lg font-medium tracking-[-0.03em]">Pecun</span>
          </a>
          <p className="mt-4 max-w-sm font-sans text-sm leading-relaxed text-muted">Put your money to work across lending, vaults, staking and fixed yield.</p>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <li>
              <a href={APP_URL} className="hover:underline">
                Launch App
              </a>
            </li>
            <li>
              <a href="/privacy" className="hover:underline">
                Privacy
              </a>
            </li>
            <li>
              <a href={`${APP_URL}/terms`} className="hover:underline">
                Terms
              </a>
            </li>
            <li>
              <a href={`mailto:${LEGAL.contactEmail}`} className="hover:underline">
                {LEGAL.contactEmail}
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="text-base font-medium tracking-[-0.02em]">Write to us</h2>
          <p className="mt-2 font-sans text-sm leading-relaxed text-muted">A question about the site or the app. We check it here, then you send it from your email.</p>
          <div className="mt-4">
            <ContactForm />
          </div>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-4 font-sans text-xs text-muted sm:px-6">© {new Date().getFullYear()} Pecun. Rates are variable and never a promise of future returns.</p>
      </div>
    </footer>
  );
}
