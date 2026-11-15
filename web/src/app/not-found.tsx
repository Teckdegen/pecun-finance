import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { APP_URL } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Page not found",
  description: "That page isn't on the PECUN site.",
  path: "/404",
  noindex: true,
});

/** Unknown URLs. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-sm font-medium text-green">404</p>
      <h1 className="mt-3 text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2.2rem]">This page doesn&apos;t exist.</h1>
      <p className="mt-3 font-sans text-sm leading-relaxed text-muted">The link may be old, or the page may have moved.</p>
      <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <a href="/" className="inline-flex h-11 items-center justify-center rounded-full bg-lime px-5 text-sm font-medium text-ink hover:bg-lime-deep">
          Back home
        </a>
        <a href={APP_URL} className="inline-flex h-11 items-center justify-center rounded-full border border-line bg-white px-5 text-sm font-medium hover:bg-paper">
          Launch App
        </a>
      </div>
    </main>
  );
}
