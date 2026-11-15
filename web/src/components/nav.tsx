import { APP_URL } from "@/lib/site";
import { PecunMark } from "./logo";

/** Sections of the home page the header jumps to. Prefixed with "/" so they also work from other pages. */
const LINKS = [
  { href: "/#explore", label: "Explore" },
  { href: "/#deposit", label: "Deposit" },
  { href: "/#earn", label: "Earn" },
  { href: "/#faq", label: "FAQ" },
];

/** Header: the logo, a pill of section links (from md up), and one Launch App button. */
export function Nav() {
  return (
    <header className="sticky top-0 z-[80] border-b border-black/[0.06] bg-[#fafaf7]">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:h-[4.5rem] md:px-6">
        <a href="/" className="flex shrink-0 items-center gap-2" aria-label="PECUN home">
          <PecunMark size={36} />
          <span className="text-xl font-medium tracking-[-0.03em]">PECUN</span>
        </a>

        <nav aria-label="Sections" className="hidden items-center gap-1 rounded-full bg-white p-1.5 shadow-[0_1px_2px_rgba(10,10,10,0.04)] ring-1 ring-black/[0.05] md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-5 py-2 text-[15px] font-medium text-[#3a3a36] transition-colors hover:bg-[#f1f5ea] hover:text-ink lg:px-6"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a href={APP_URL} className="inline-flex h-10 shrink-0 items-center rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-[#262626] sm:h-11 sm:px-5">
          Launch App
        </a>
      </div>
    </header>
  );
}
