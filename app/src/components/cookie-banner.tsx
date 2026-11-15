"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { hasAcceptedTerms, TERMS_ACCEPTED_EVENT } from "./terms-gate";

/**
 * Cookie consent. Pecun only uses what it needs to work, so nothing optional runs until someone
 * picks "Accept all". Anything optional added later (analytics) must check hasOptionalConsent().
 */
const KEY = "pecun-cookie-consent";
type Choice = "all" | "essential";

function readChoice(): Choice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return null;
  }
}

/** True only if the visitor accepted optional cookies (analytics and the like). */
export function hasOptionalConsent(): boolean {
  return readChoice() === "all";
}

export function CookieBanner() {
  const [open, setOpen] = useState(false);
  // One prompt at a time: the cookie banner waits until the terms disclaimer has been accepted.
  useEffect(() => {
    const check = () => setOpen(readChoice() === null);
    if (hasAcceptedTerms()) check();
    window.addEventListener(TERMS_ACCEPTED_EVENT, check);
    return () => window.removeEventListener(TERMS_ACCEPTED_EVENT, check);
  }, []);
  if (!open) return null;

  const choose = (c: Choice) => {
    try {
      localStorage.setItem(KEY, c);
    } catch {
      // Storage blocked (private mode): just hide the banner for this visit.
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-3 z-50 mx-auto max-w-xl rounded-2xl border border-line bg-[#161616] p-4 shadow-[0_12px_30px_rgba(0,0,0,0.6)] lg:left-auto lg:right-6 lg:mx-0"
      style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      <p className="font-sans text-sm leading-relaxed text-ink/85">
        We use essential cookies to run Pecun. With your OK we may also use analytics to improve it. See our{" "}
        <Link href="/privacy" className="text-accent underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => choose("all")}
          className="h-9 flex-1 rounded-xl bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-deep sm:flex-none"
        >
          Accept all
        </button>
        <button
          type="button"
          onClick={() => choose("essential")}
          className="h-9 flex-1 rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-card sm:flex-none"
        >
          Essential only
        </button>
      </div>
    </div>
  );
}
