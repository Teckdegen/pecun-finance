"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown when a page fails to render. The shell (sidebar and header) stays up. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-sm text-red-300">Something went wrong</p>
      <h1 className="mt-3 text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2rem]">We couldn&apos;t load this page.</h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        A data source may be slow or down. Try again in a moment. Your funds aren&apos;t affected: positions live on-chain, not in this page.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-faint">Reference: {error.digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button onClick={reset} className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-deep">
          Try again
        </button>
        <Link href="/" className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-card">
          Back to Explore
        </Link>
      </div>
    </div>
  );
}
