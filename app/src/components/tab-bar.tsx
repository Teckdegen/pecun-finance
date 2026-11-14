"use client";

import { Landmark, Layers, LayoutGrid, Waves } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { href: "/", cat: "", label: "Explore", icon: LayoutGrid },
  { href: "/?cat=lending", cat: "lending", label: "Lend", icon: Landmark },
  { href: "/?cat=vaults", cat: "vaults", label: "Vaults", icon: Layers },
  { href: "/?cat=staking", cat: "staking", label: "Stake", icon: Waves },
];

/** Phone navigation: a floating glass tab bar pinned above the home indicator. Vault pages swap it for their Deposit bar. */
export function TabBar() {
  const path = usePathname();
  const cat = useSearchParams().get("cat") ?? "";
  const onExplore = path === "/";
  // On a vault page the Deposit bar takes this spot.
  if (path.startsWith("/earn")) return null;
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-40 flex items-end gap-2.5 px-3 md:hidden"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      <div className="glass flex h-[64px] flex-1 items-center justify-between rounded-full p-1.5">
        {TABS.map((t) => {
          const active = onExplore && (path === "/" ? cat === t.cat : t.cat === "");
          return (
            <Link
              key={t.label}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] transition ${active ? "bg-ink text-white" : "text-muted active:bg-card-2"}`}
            >
              <t.icon className="size-[18px]" strokeWidth={active ? 2.2 : 1.8} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
