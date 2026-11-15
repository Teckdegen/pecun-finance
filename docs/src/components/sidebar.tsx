"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { GROUPS } from "@/lib/pages";

function Links({ path, onPick }: { path: string; onPick?: () => void }) {
  return (
    <nav aria-label="Docs" className="flex flex-col gap-7">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="px-3 text-[13px] font-medium text-[#8a8a83]">{g.title}</p>
          <ul className="mt-2 flex flex-col gap-0.5">
            {g.pages.map((p) => {
              const active = p.href === path;
              return (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    onClick={onPick}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-xl px-3 py-2 text-[15px] transition-colors ${
                      active ? "bg-[#e7f6dc] font-medium text-ink" : "text-[#4a4a44] hover:bg-[#f1f5ea] hover:text-ink"
                    }`}
                  >
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop: a sticky column of links. Phones: a "Menu" button that opens the same links over the page. */
export function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <aside className="sticky top-[4.5rem] hidden h-[calc(100dvh-4.5rem)] w-60 shrink-0 overflow-y-auto py-10 pr-4 lg:block">
        <Links path={path} />
      </aside>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium ring-1 ring-black/[0.08]"
        >
          <Menu className="size-4" /> Menu
        </button>
        {open && (
          <div className="fixed inset-0 z-[90] bg-black/30" onClick={() => setOpen(false)}>
            <div className="h-full w-[82vw] max-w-xs overflow-y-auto bg-[#fafaf7] px-4 py-5" onClick={(e) => e.stopPropagation()}>
              <div className="mb-6 flex justify-end">
                <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid size-9 place-items-center rounded-full bg-white ring-1 ring-black/[0.08]">
                  <X className="size-4" />
                </button>
              </div>
              <Links path={path} onPick={() => setOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
