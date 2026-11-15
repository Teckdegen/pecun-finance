import { APP_URL, SOCIALS } from "@/lib/site";
import { PecunMark } from "./logo";

/** Sections of the home page the header jumps to. Prefixed with "/" so they also work from other pages. */
const LINKS = [
  { href: "/#explore", label: "Explore" },
  { href: "/#deposit", label: "Deposit" },
  { href: "/#earn", label: "Earn" },
];

/** Brand marks for the social links (24x24 paths, filled with currentColor). */
const X_PATH = "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z";
const DISCORD_PATH =
  "M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z";

function Social({ href, label, path }: { href: string; label: string; path: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-black/[0.06] transition-colors hover:bg-[#f1f5ea] sm:size-11"
    >
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 sm:size-[18px]" fill="currentColor">
        <path d={path} />
      </svg>
    </a>
  );
}

/** Header: the logo, a pill of section links (from md up), the X and Discord links, and one Launch App button. */
export function Nav() {
  return (
    <header className="sticky top-0 z-[80] border-b border-black/[0.06] bg-[#fafaf7]">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-[4.5rem] md:px-6">
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

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Social href={SOCIALS.x} label="PECUN on X" path={X_PATH} />
          <Social href={SOCIALS.discord} label="PECUN on Discord" path={DISCORD_PATH} />
          <a href={APP_URL} className="ml-1 inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-[#262626] sm:h-11 sm:px-5">
            Launch App
          </a>
        </div>
      </div>
    </header>
  );
}
