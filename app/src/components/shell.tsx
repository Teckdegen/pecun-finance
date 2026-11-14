"use client";

import {
  ArrowUpDown,
  BadgeDollarSign,
  Compass,
  Landmark,
  Layers,
  Lock,
  Menu,
  PanelLeft,
  Search,
  Wallet,
  Waves,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/* ---------- shell state: desktop rail collapse + phone drawer ---------- */

type ShellCtx = { collapsed: boolean; menuOpen: boolean; toggle: () => void; closeMenu: () => void; openMenu: () => void };
const Ctx = createContext<ShellCtx | null>(null);
const useShell = () => useContext(Ctx)!;

function ShellState({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("pecun-rail") === "1");
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setMenuOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      try {
        localStorage.setItem("pecun-rail", c ? "0" : "1");
      } catch {}
      return !c;
    });
  }, []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openMenu = useCallback(() => setMenuOpen(true), []);

  return <Ctx.Provider value={{ collapsed, menuOpen, toggle, closeMenu, openMenu }}>{children}</Ctx.Provider>;
}

/* ---------- navigation ---------- */

export const NAV = [
  { href: "/", cat: "", label: "Explore", icon: Compass },
  { href: "/?cat=vaults", cat: "vaults", label: "Vaults", icon: Layers },
  { href: "/?cat=lending", cat: "lending", label: "Lending", icon: Landmark },
  { href: "/?cat=staking", cat: "staking", label: "Staking", icon: Waves },
  { href: "/?cat=stable", cat: "stable", label: "Stablecoin", icon: BadgeDollarSign },
  { href: "/?cat=fixed", cat: "fixed", label: "Fixed yield", icon: Lock },
  { href: "/?cat=perps", cat: "perps", label: "Perps", icon: ArrowUpDown },
] as const;

function useActive() {
  const path = usePathname();
  const cat = useSearchParams().get("cat") ?? "";
  return (item: { href: string; cat?: string }) => {
    if (item.href === "/portfolio") return path.startsWith("/portfolio");
    if (path !== "/") return item.cat === "" && path.startsWith("/earn");
    return cat === item.cat;
  };
}

/** The PECUN mark in Hood colours: lime tile, black letter. */
export function PecunMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[7px] bg-accent font-tight font-medium leading-none text-on-accent"
      style={{ width: size, height: size, fontSize: size * 0.56, letterSpacing: "-0.04em" }}
    >
      P
    </span>
  );
}

/* ---------- frame ---------- */

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellState>
      <Suspense fallback={null}>
        <Frame>{children}</Frame>
      </Suspense>
    </ShellState>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { collapsed, menuOpen, closeMenu } = useShell();
  const path = usePathname();
  const onVault = path.startsWith("/earn");

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
  }, [menuOpen]);

  return (
    <div className="min-h-dvh bg-bg font-tight text-ink">
      {menuOpen && <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={closeMenu} />}
      <Sidebar />
      <div className={`flex min-h-dvh min-w-0 flex-col transition-[padding] ${collapsed ? "md:pl-[88px]" : "md:pl-60"}`}>
        <Header />
        <main
          className={`mx-auto w-full max-w-[1240px] flex-1 px-4 pt-4 md:px-8 md:pb-16 md:pt-6 ${onVault ? "pb-32" : "pb-[calc(96px+env(safe-area-inset-bottom))]"}`}
        >
          {children}
        </main>
      </div>
      {!onVault && <TabBar />}
    </div>
  );
}

/* ---------- sidebar ---------- */

function Sidebar() {
  const { collapsed, menuOpen, closeMenu } = useShell();
  const isActive = useActive();
  const path = usePathname();
  const cat = useSearchParams().get("cat");
  const rail = collapsed && !menuOpen;

  useEffect(() => closeMenu(), [path, cat, closeMenu]);

  const item = (n: { href: string; cat?: string; label: string; icon: React.ElementType }) => {
    const active = isActive(n);
    return (
      <Link
        key={n.label}
        href={n.href}
        title={rail ? n.label : undefined}
        aria-current={active ? "page" : undefined}
        onClick={closeMenu}
        className={
          rail
            ? `flex size-10 items-center justify-center rounded-xl ${active ? "bg-[#2a2a2a] text-ink" : "text-muted hover:bg-card-2 hover:text-ink"}`
            : `mb-0.5 flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${active ? "bg-white/10 text-ink" : "text-muted hover:bg-card-2 hover:text-ink"}`
        }
      >
        <n.icon className={rail ? "size-5" : "size-4"} strokeWidth={rail ? 2.2 : 1.8} />
        {!rail && n.label}
      </Link>
    );
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-rail transition-transform md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"} ${
        collapsed ? "md:inset-y-3 md:left-3 md:w-16 md:rounded-2xl md:border md:border-line" : "border-r border-line md:w-60"
      }`}
    >
      <div className={`flex h-14 shrink-0 items-center ${rail ? "justify-center" : "justify-between px-4"}`}>
        <Link href="/" aria-label="PECUN home" className="flex items-center gap-2">
          <PecunMark size={rail ? 30 : 24} />
          {!rail && <span className="text-[15px] font-medium tracking-[-0.03em]">PECUN</span>}
        </Link>
        {!rail && (
          <button type="button" onClick={closeMenu} aria-label="Close menu" className="grid size-8 place-items-center rounded-lg text-muted hover:text-ink md:hidden">
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="mx-3 border-t border-line" />

      <nav aria-label="Main" className={`no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto ${rail ? "flex flex-col items-center gap-1" : "px-2"}`}>
        {!rail && <p className="eyebrow mb-2 px-2.5 text-faint">Earn</p>}
        {NAV.map(item)}
        {rail ? <div className="my-2 w-8 border-t border-line" /> : <p className="eyebrow mb-2 mt-6 px-2.5 text-faint">Account</p>}
        {item({ href: "/portfolio", label: "Portfolio", icon: Wallet })}
      </nav>

      {!rail && (
        <div className="shrink-0 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="relative overflow-hidden rounded-xl border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hero/banner.jpg" alt="" className="absolute inset-0 size-full object-cover object-[50%_80%] opacity-70" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/10" />
            <div className="relative p-3.5">
              <p className="eyebrow text-accent">Every chain</p>
              <p className="mt-1.5 text-sm leading-snug">EVM, Solana, Sui and Hyperliquid yields in one list.</p>
            </div>
          </div>
          <p className="mt-4 px-1 font-sans text-xs text-faint">© 2026 PECUN Finance</p>
        </div>
      )}
    </aside>
  );
}

/* ---------- header ---------- */

function Header() {
  const { toggle, menuOpen, collapsed } = useShell();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        <button
          type="button"
          onClick={toggle}
          aria-label={menuOpen ? "Close menu" : collapsed ? "Expand sidebar" : "Toggle sidebar"}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:text-ink"
        >
          <Menu className="size-5 md:hidden" />
          <PanelLeft className="hidden size-5 md:block" strokeWidth={1.8} />
        </button>
        <Link href="/" aria-label="PECUN home" className="md:hidden">
          <PecunMark size={24} />
        </Link>
        <span className="hidden h-5 w-px shrink-0 bg-line md:block" />
        <Crumb />
        <div className="ml-auto flex items-center gap-2">
          <HeaderSearch />
          <Link
            href="/portfolio"
            className="eyebrow inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-on-accent hover:bg-accent-deep md:px-3.5"
          >
            <Wallet className="size-4 md:hidden" />
            <span className="hidden md:inline">Portfolio</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Crumb() {
  const path = usePathname();
  const cat = useSearchParams().get("cat") ?? "";
  const parts: { label: string; href?: string }[] = path.startsWith("/earn")
    ? [{ label: "Explore", href: "/" }, { label: "Vault" }]
    : path.startsWith("/portfolio")
      ? [{ label: "Portfolio" }]
      : cat
        ? [{ label: "Explore", href: "/" }, { label: NAV.find((n) => n.cat === cat)?.label ?? "Explore" }]
        : [{ label: "Explore" }];
  return (
    <p className="flex min-w-0 items-center gap-2 text-sm md:ml-2">
      {parts.map((p, i) => (
        <span key={p.label} className={`flex min-w-0 items-center gap-2 ${i < parts.length - 1 ? "hidden sm:flex" : ""}`}>
          {i > 0 && <span className="hidden text-faint sm:inline">&gt;</span>}
          {p.href ? (
            <Link href={p.href} className="text-muted hover:text-ink">
              {p.label}
            </Link>
          ) : (
            <span className="truncate">{p.label}</span>
          )}
        </span>
      ))}
    </p>
  );
}

function HeaderSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const submit = () => {
    const v = q.trim();
    router.push(v ? `/?q=${encodeURIComponent(v)}` : "/");
    setOpen(false);
  };
  return (
    <>
      <form
        className="hidden lg:block"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search yields"
            aria-label="Search yields"
            className="h-9 w-56 rounded-lg border border-line bg-bg pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-white/60"
          />
        </label>
      </form>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search yields" className="grid size-9 place-items-center rounded-lg border border-line text-muted hover:text-ink lg:hidden">
        <Search className="size-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/80 px-4 pt-[max(16px,env(safe-area-inset-top))] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form
            className="mx-auto mt-2 flex max-w-xl items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="relative block flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search vaults, assets, protocols"
                className="h-12 w-full rounded-xl border border-line bg-card pl-10 pr-3 text-base text-ink placeholder:text-faint focus:border-white/60"
              />
            </label>
            <button type="button" onClick={() => setOpen(false)} className="eyebrow h-12 px-2 text-muted">
              Cancel
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/* ---------- phone tab bar ---------- */

const TABS = [
  { href: "/", cat: "", label: "Explore", icon: Compass },
  { href: "/?cat=vaults", cat: "vaults", label: "Vaults", icon: Layers },
  { href: "/?cat=lending", cat: "lending", label: "Lend", icon: Landmark },
  { href: "/?cat=staking", cat: "staking", label: "Stake", icon: Waves },
  { href: "/portfolio", cat: undefined, label: "Portfolio", icon: Wallet },
];

function TabBar() {
  const isActive = useActive();
  const path = usePathname();
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[#101010]/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex h-16 max-w-md items-stretch px-2">
        {TABS.map((t) => {
          const active = t.cat === undefined ? isActive(t) : path === "/" && isActive(t);
          return (
            <Link
              key={t.label}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium tracking-wide ${active ? "text-ink" : "text-faint"}`}
            >
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
              <t.icon className={`size-5 ${active ? "text-accent" : ""}`} strokeWidth={active ? 2.2 : 1.8} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
