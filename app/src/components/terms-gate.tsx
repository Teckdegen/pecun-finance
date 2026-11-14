"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LEGAL, UNSUPPORTED_REGIONS } from "@/lib/site";

/**
 * Terms every visitor must accept before using PECUN. The answer is kept in this browser's local
 * storage, with the terms version, so people are asked again only when the terms change.
 * It stays out of the way on the legal pages so people can read them in full before agreeing.
 */
const KEY = "pecun-terms-acceptance";
export const TERMS_ACCEPTED_EVENT = "pecun:terms-accepted";
const LEGAL_PAGES = ["/terms", "/privacy", "/risk-disclosure"];

type Acceptance = { version: string; acceptedAt: string };

/** True once this browser has accepted the current version of the terms. */
export function hasAcceptedTerms(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Acceptance | null;
    return v?.version === LEGAL.termsVersion;
  } catch {
    return false;
  }
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-accent underline-offset-2 hover:underline">
    {children}
  </Link>
);

/** The key points, in the order of the full Terms. */
const SUMMARY: { title: string; body: ReactNode }[] = [
  {
    title: "Introduction",
    body: (
      <>
        Welcome to PECUN Finance. By accessing and using PECUN, you agree to these terms. If you don&apos;t agree with any part, please don&apos;t use PECUN.
        The full text is in our <A href="/terms">Terms and Conditions</A>.
      </>
    ),
  },
  {
    title: "Who can use PECUN",
    body: <>You must be at least 18 years old, not on any sanctions list, and not a resident of or located in a region PECUN doesn&apos;t support: {UNSUPPORTED_REGIONS.join("; ")}.</>,
  },
  {
    title: "What PECUN does",
    body: "PECUN shows yield products run by independent protocols and builds the transactions to deposit and withdraw. PECUN does not hold your assets, manage strategies or give investment advice.",
  },
  {
    title: "Fees",
    body: "PECUN charges a fee on deposits and on withdrawals, shown before you confirm. Protocols may charge their own fees, which are separate.",
  },
  {
    title: "Risks",
    body: (
      <>
        Every product carries risk, including smart-contract failures, protocol freezes, depegs and market losses. You could lose some or all of what you
        deposit, and returns are never guaranteed. Read the <A href="/risk-disclosure">Risk Disclosure</A>.
      </>
    ),
  },
  {
    title: "Your data",
    body: (
      <>
        We collect only what we need to run PECUN, and we don&apos;t sell personal data. See the <A href="/privacy">Privacy Policy</A>.
      </>
    ),
  },
];

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
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-[#161616] shadow-[0_20px_60px_rgba(0,0,0,0.7)] outline-none"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 id="terms-gate-title" className="text-lg font-medium tracking-[-0.02em]">
            Terms and Conditions
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
          <div className="max-h-[46dvh] overflow-y-auto rounded-xl border border-line bg-bg px-4 py-3">
            <ol className="grid gap-4 font-sans text-sm leading-relaxed text-ink/80">
              {SUMMARY.map((s, i) => (
                <li key={s.title}>
                  <h3 className="font-medium text-ink">
                    {i + 1}. {s.title}
                  </h3>
                  <p className="mt-1">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 pb-4 font-sans text-sm leading-relaxed text-ink/85">
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
              I agree to the Terms and Conditions, Privacy Policy and Risk Disclosure, and confirm I&apos;m 18 or older and not in an unsupported region.
            </span>
          </label>
          {declined && (
            <p role="alert" className="-mt-2 pb-4 font-sans text-xs text-red-300">
              You need to accept the terms to use PECUN.
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
