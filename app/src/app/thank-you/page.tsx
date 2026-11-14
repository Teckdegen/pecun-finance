import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta({
  title: "Thank you",
  description: "You're all set with PECUN.",
  path: "/thank-you",
  noindex: true,
});

/** Where sign-up (and later, completed actions) land. Not indexed by search engines. */
export default function ThankYouPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <CheckCircle2 aria-hidden className="size-12 text-accent" />
      <h1 className="mt-4 text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2rem]">Thank you. You&apos;re all set.</h1>
      <p className="mt-3 max-w-md text-sm text-muted">Welcome to PECUN. Find a vault, lending market or staking option that fits you, and put your money to work.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-deep">
          Explore yields
        </Link>
        <Link href="/portfolio" className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-card">
          Go to portfolio
        </Link>
      </div>
    </div>
  );
}
