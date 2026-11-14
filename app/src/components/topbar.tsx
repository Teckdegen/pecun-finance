"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/portfolio", label: "Portfolio" },
];

/** Floating glass top bar for tablets and desktop. Phones navigate with the bottom tab bar instead. */
export function TopBar() {
  const path = usePathname();
  return (
    <div className="sticky top-0 z-40 hidden px-3 pt-3 sm:px-6 md:block">
      <header className="glass mx-auto flex h-14 max-w-[1180px] items-center justify-between rounded-full pl-2.5 pr-1.5 sm:pl-3">
        <Link
          href="/"
          className="flex items-center gap-2"
          aria-label="PECUN home"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-ink text-sm font-bold text-white">
            P
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            PECUN
          </span>
        </Link>
        <Link href="/#search" aria-label="Search yields" className="grid size-10 place-items-center rounded-full text-ink active:bg-card-2 md:hidden">
          <Search className="size-[18px]" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
          {NAV.map((n) => {
            const active =
              n.href === "/"
                ? path === "/" || path.startsWith("/earn")
                : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-4 py-2 transition ${active ? "bg-ink font-medium text-white" : "text-muted hover:text-ink"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </div>
  );
}
