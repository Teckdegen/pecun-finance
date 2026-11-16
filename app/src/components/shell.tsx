"use client";

import {
  ArrowUpDown,
  CircleDollarSign,
  Compass,
  Landmark,
  Layers,
  Lock,
  Menu,
  Wallet,
  Waves,
  X,
} from "lucide-react";
import Link from "next/link";
import { DOCS_URL } from "@/lib/site";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { SignInModal } from "./sign-in-modal";
import { PlatformLogos } from "./ui";

/* ---------- shell state: the drawer is for phone and tablet. PC keeps the sidebar open. ---------- */

type ShellCtx = { menuOpen: boolean; toggle: () => void; closeMenu: () => void; signInOpen: boolean; openSignIn: () => void; closeSignIn: () => void };
const Ctx = createContext<ShellCtx | null>(null);
const useShell = () => useContext(Ctx)!;

function ShellState({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggle = useCallback(() => setMenuOpen((o) => !o), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const [signInOpen, setSignInOpen] = useState(false);
  const openSignIn = useCallback(() => (setMenuOpen(false), setSignInOpen(true)), []);
  const closeSignIn = useCallback(() => setSignInOpen(false), []);

  return <Ctx.Provider value={{ menuOpen, toggle, closeMenu, signInOpen, openSignIn, closeSignIn }}>{children}</Ctx.Provider>;
}

/* ---------- navigation ---------- */

export const NAV = [
  { href: "/", earn: "", label: "Explore", icon: Compass },
  { href: "/?earn=vaults", earn: "vaults", label: "Vaults", icon: Layers },
  { href: "/?earn=lending", earn: "lending", label: "Lending", icon: Landmark },
  { href: "/?earn=staking", earn: "staking", label: "Staking", icon: Waves },
  { href: "/?earn=stable", earn: "stable", label: "Stablecoin", icon: CircleDollarSign },
  { href: "/?earn=fixed", earn: "fixed", label: "Fixed yield", icon: Lock },
  { href: "/?earn=perps", earn: "perps", label: "Perps", icon: ArrowUpDown },
] as const;

/** The legal documents live on the docs site. */
const LEGAL_LINKS = [
  { href: `${DOCS_URL}/terms`, label: "Terms" },
  { href: `${DOCS_URL}/privacy`, label: "Privacy" },
  { href: `${DOCS_URL}/risk-disclosure`, label: "Risk Disclosure" },
  { href: DOCS_URL, label: "Docs" },
] as const;

function useActive() {
  const path = usePathname();
  const earn = useSearchParams().get("earn") ?? "";
  return (item: { href: string; earn?: string }) => {
    if (item.href === "/portfolio") return path.startsWith("/portfolio");
    if (path !== "/") return item.earn === "" && path.startsWith("/earn");
    return earn === item.earn;
  };
}

/** The Pecun mark: a leaf split down its vein, white and lime on the dark app. */
export function PecunMark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="12 12 40 40" className="shrink-0">
      <path d="M14 50C14 28 28 14 50 14Z" fill="#ffffff" />
      <path d="M50 14C50 36 36 50 14 50Z" fill="#b8ff9d" />
    </svg>
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
  const { menuOpen, closeMenu, signInOpen, closeSignIn } = useShell();
  const path = usePathname();
  const onVault = path.startsWith("/earn");

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
  }, [menuOpen]);

  return (
    <div className="min-h-dvh bg-bg font-tight text-ink">
      {menuOpen && <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={closeMenu} />}
      {/* Sidebar and page sit side by side; on desktop the sidebar sticks while you scroll. */}
      <div className="flex">
        <Sidebar />
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          <Header />
          <main
            className={`mx-auto w-full max-w-[1240px] flex-1 px-4 pt-4 pb-[max(24px,env(safe-area-inset-bottom))] md:px-8 md:pb-16 md:pt-6 ${onVault ? "pb-32" : ""}`}
          >
            {children}
          </main>
        </div>
      </div>
      <SignInModal open={signInOpen} onClose={closeSignIn} />
    </div>
  );
}

/* ---------- sidebar ---------- */

function Sidebar() {
  const { menuOpen, closeMenu } = useShell();
  const isActive = useActive();
  const path = usePathname();
  const earn = useSearchParams().get("earn");

  useEffect(() => closeMenu(), [path, earn, closeMenu]);

  const item = (n: { href: string; earn?: string; label: string; icon: React.ElementType }) => {
    const active = isActive(n);
    return (
      <Link
        key={n.label}
        href={n.href}
        aria-current={active ? "page" : undefined}
        onClick={closeMenu}
        className={`mb-0.5 flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink ${active ? "bg-white/10" : "hover:bg-card-2"}`}
      >
        <n.icon className="size-5 shrink-0" strokeWidth={1.75} />
        {n.label}
      </Link>
    );
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-rail transition-transform lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Link href="/" aria-label="Pecun home" className="flex items-center gap-2">
          <PecunMark size={24} />
          <span className="text-[15px] font-medium tracking-[-0.03em]">Pecun</span>
        </Link>
        <button type="button" onClick={closeMenu} aria-label="Close menu" className="grid size-8 place-items-center rounded-lg text-muted hover:text-ink lg:hidden">
          <X className="size-4" />
        </button>
      </div>
      <div className="mx-3 border-t border-line" />

      <nav aria-label="Main" className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto px-2">
        <p className="eyebrow mb-2 px-2.5 text-faint">Earn</p>
        {NAV.map(item)}
        <p className="eyebrow mb-2 mt-6 px-2.5 text-faint">Account</p>
        {item({ href: "/portfolio", label: "Portfolio", icon: Wallet })}
      </nav>

      <div className="shrink-0 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="lime-banner overflow-hidden rounded-xl p-3.5">
            <span className="lb-pill inline-flex rounded-full px-2 py-0.5 font-sans text-[11px]">Every protocol</span>
            <p className="mt-2 text-sm font-medium leading-snug tracking-[-0.01em]">Put your money to work.</p>
            <div className="mt-3"><PlatformLogos max={5} size={20} /></div>
          </div>
          <nav aria-label="Legal" className="mt-4 flex flex-wrap gap-x-3 gap-y-1 px-1 font-sans text-xs">
            {LEGAL_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={closeMenu} className="text-muted hover:text-ink">
                {l.label}
              </a>
            ))}
          </nav>
          <p className="mt-2 px-1 font-sans text-xs text-faint">© 2026 Pecun Finance</p>
        </div>
    </aside>
  );
}

/* ---------- header ---------- */

function Header() {
  const { toggle, menuOpen, openSignIn } = useShell();
  const { signedIn, account, signOut } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        <button
          type="button"
          onClick={toggle}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:text-ink lg:hidden"
        >
          <Menu className="size-5" />
        </button>
        <span className="hidden h-5 w-px shrink-0 bg-line lg:block" />
        <Crumb />
        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <>
              <span className="hidden max-w-[220px] truncate font-sans text-sm text-muted sm:inline" title={account}>{account}</span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-card-2"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={openSignIn}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-deep"
            >
              Sign up / Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function Crumb() {
  const path = usePathname();
  const earn = useSearchParams().get("earn") ?? "";
  const parts: { label: string; href?: string }[] = path.startsWith("/earn")
    ? [{ label: "Explore", href: "/" }, { label: "Vault" }]
    : path.startsWith("/portfolio/activity")
      ? [{ label: "Portfolio", href: "/portfolio" }, { label: "Activity" }]
      : path.startsWith("/portfolio")
        ? [{ label: "Portfolio" }]
        : path.startsWith("/thank-you")
              ? [{ label: "Thank you" }]
              : earn
          ? [{ label: "Explore", href: "/" }, { label: NAV.find((n) => n.earn === earn)?.label ?? "Explore" }]
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

