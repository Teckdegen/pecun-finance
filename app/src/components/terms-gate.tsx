"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PecunMark } from "@/components/shell";
import { LEGAL } from "@/lib/site";

/**
 * Terms every visitor must accept before using Pecun. The answer is kept in this browser's local
 * storage, once per device: it only shows again if that saved answer no longer exists. The terms version
 * accepted is saved alongside it as a record.
 * It stays out of the way on the legal pages so people can read them in full before agreeing.
 */
const KEY = "pecun-terms-acceptance";
export const TERMS_ACCEPTED_EVENT = "pecun:terms-accepted";
const LEGAL_PAGES = ["/terms", "/privacy", "/risk-disclosure"];

type Acceptance = { version: string; acceptedAt: string };

/** True once this device has accepted the terms. Shown once per device: only asked again if the saved answer is gone. */
export function hasAcceptedTerms(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Acceptance | null;
    return !!v?.acceptedAt;
  } catch {
    return false;
  }
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-accent underline-offset-2 hover:underline">
    {children}
  </Link>
);

export function TermsGate() {
  const path = usePathname();
  const [needed, setNeeded] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => setNeeded(!hasAcceptedTerms()), []);

  const show = needed && !LEGAL_PAGES.some((p) => path.startsWith(p));

  // Keep the page behind still and move focus into the dialog while it's up.
  useEffect(() => {
    if (!show) return;
    // Locked on <html>, not <body>: the shell resets body overflow for its own menu drawer.
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      root.style.overflow = prev;
    };
  }, [show]);

  if (!show) return null;

  const accept = () => {
    if (!agreed) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: LEGAL.termsVersion, acceptedAt: new Date().toISOString() } satisfies Acceptance));
    } catch {
      // Storage blocked (private mode): let them in for this visit; they'll be asked again next time.
    }
    setNeeded(false);
    window.dispatchEvent(new Event(TERMS_ACCEPTED_EVENT));
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-gate-title"
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-line bg-[#161616] shadow-[0_20px_60px_rgba(0,0,0,0.7)] outline-none"
      >
        <div className="flex flex-col items-center px-6 pt-8 pb-6">
          <PecunMark size={56} />
          <h2 id="terms-gate-title" className="sr-only">
            Accept the terms to use Pecun
          </h2>

          <label className="mt-7 flex cursor-pointer items-start gap-3 font-sans text-sm leading-relaxed text-ink/85">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => {
                setAgreed(e.target.checked);
                setDeclined(false);
              }}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 ${
                agreed ? "border-accent bg-accent text-on-accent" : "border-white/30"
              }`}
            >
              {agreed && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <span>
              I agree to the <A href="/terms">Terms</A>, <A href="/privacy">Privacy Policy</A> and <A href="/risk-disclosure">Risk Disclosure</A>.
            </span>
          </label>
          {declined && (
            <p role="alert" className="mt-3 font-sans text-xs text-red-300">
              You need to accept the terms to use Pecun.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={() => setDeclined(true)}
            className="h-10 rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={!agreed}
            className="h-10 rounded-xl bg-accent px-5 text-sm font-medium text-on-accent hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
          >
            Agree and Continue
          </button>
        </div>
      </div>
    </div>
  );
}
