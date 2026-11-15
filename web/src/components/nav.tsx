import { APP_URL } from "@/lib/site";
import { PecunMark } from "./logo";

/** Header: the PECUN logo and one Launch App button. */
export function Nav() {
  return (
    <header className="sticky top-0 z-[80] border-b border-black/[0.06] bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 md:px-6">
        <a href="/" className="flex items-center gap-2" aria-label="PECUN home">
          <PecunMark size={36} />
          <span className="text-xl font-medium tracking-[-0.03em]">PECUN</span>
        </a>
        <a href={APP_URL} className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-[#262626] sm:px-5">
          Launch App
        </a>
      </div>
    </header>
  );
}
