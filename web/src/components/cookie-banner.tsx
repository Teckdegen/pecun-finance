"use client";

import { useEffect, useState } from "react";

/**
 * Cookie choice for this site. Nothing optional runs until someone picks "Accept all".
 * The choice is stored on this device only.
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

/** True only if this browser accepted optional cookies. */
export function hasOptionalConsent(): boolean {
  return readChoice() === "all";
}

export function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readChoice() === null);
  }, []);

  if (!open) return null;

  const choose = (choice: Choice) => {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked: hide it for this visit.
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-3 z-[60] mx-auto max-w-xl rounded-2xl border border-line bg-white p-4 shadow-[0_12px_40px_rgba(10,10,10,0.12)] sm:inset-x-4"
      style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      <p className="font-sans text-sm leading-relaxed text-ink">
        We use essential cookies to run this site. With your OK we may also use analytics to improve it. See the{" "}
        <a href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </a>
        .
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => choose("all")} className="h-10 rounded-full bg-lime px-4 text-sm font-medium text-ink hover:bg-lime-deep sm:h-9">
          Accept all
        </button>
        <button type="button" onClick={() => choose("essential")} className="h-10 rounded-full border border-line bg-white px-4 text-sm font-medium hover:bg-paper sm:h-9">
          Essential only
        </button>
      </div>
    </div>
  );
}
