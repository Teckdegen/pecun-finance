import { APP_URL } from "@/lib/site";
import { PecunMark } from "./logo";

/** Header: the logo and one Launch App button. */
export function Nav() {
  return (
    <header className="sticky top-0 z-[80] border-b border-black/[0.06] bg-[#fafaf7]">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-[4.5rem] md:px-6">
        <a href="/" className="flex shrink-0 items-center gap-2" aria-label="Pecun home">
          <PecunMark size={36} />
          <span className="text-xl font-medium tracking-[-0.03em]">Pecun</span>
        </a>

        <a href={APP_URL} className="inline-flex h-10 shrink-0 items-center rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-[#262626] sm:h-11 sm:px-5">
          Launch App
        </a>
      </div>
    </header>
  );
}
