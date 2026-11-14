import Link from "next/link";

export const metadata = { title: "Page not found", robots: { index: false } };

/** Shown for any unknown URL, and for vaults that aren't (or are no longer) listed. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-3 text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2rem]">This page doesn&apos;t exist.</h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        The link may be old, or the vault may no longer be listed. Head back to Explore to find what&apos;s earning right now.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-deep">
          Explore yields
        </Link>
        <Link href="/portfolio" className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-card">
          Your portfolio
        </Link>
      </div>
    </div>
  );
}
