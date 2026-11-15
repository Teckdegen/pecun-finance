import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PAGES, pageFor } from "@/lib/pages";
import { APP_URL, SOCIALS, WEBSITE_URL } from "@/lib/site";
import { PecunMark } from "./logo";

/* ---------- header and footer ---------- */

export function Header() {
  return (
    <header className="sticky top-0 z-[80] border-b border-black/[0.06] bg-[#fafaf7]">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-3 px-4 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Pecun Docs home">
          <PecunMark size={34} />
          <span className="text-xl font-medium tracking-[-0.03em]">Pecun</span>
          <span className="ml-1 rounded-full bg-[#e7f6dc] px-2.5 py-0.5 text-[13px] font-medium text-[#2f7d1c]">Docs</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <a href={WEBSITE_URL} className="hidden h-11 items-center rounded-full px-4 text-[15px] font-medium text-[#3a3a36] hover:bg-[#f1f5ea] sm:inline-flex">
            Website
          </a>
          <a href={APP_URL} className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-[#262626] sm:h-11 sm:px-5">
            Launch App
          </a>
        </div>
      </div>
    </header>
  );
}

const X_PATH = "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z";
const DISCORD_PATH =
  "M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z";

function Social({ href, label, path }: { href: string; label: string; path: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="grid size-10 place-items-center rounded-full bg-white text-ink ring-1 ring-black/[0.06] hover:bg-[#f1f5ea]">
      <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
        <path d={path} />
      </svg>
    </a>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 flex flex-col items-start justify-between gap-5 border-t border-line pt-8 sm:flex-row sm:items-center">
      <span className="flex items-center gap-2 text-sm text-[#5e5e58]">
        <PecunMark size={20} />
        &copy; {new Date().getFullYear()} Pecun
      </span>
      <div className="flex items-center gap-2">
        <Social href={SOCIALS.x} label="Pecun on X" path={X_PATH} />
        <Social href={SOCIALS.discord} label="Pecun on Discord" path={DISCORD_PATH} />
      </div>
    </footer>
  );
}

/* ---------- a docs page ---------- */

/** Title and summary from the page list, the page body, then previous and next links. */
export function Doc({ href, children }: { href: string; children: ReactNode }) {
  const page = pageFor(href);
  const i = PAGES.indexOf(page);
  const prev = PAGES[i - 1];
  const next = PAGES[i + 1];
  return (
    <article className="min-w-0 flex-1 py-8 lg:py-12">
      <div className="max-w-3xl">
        <h1 className="text-[2.4rem] font-medium leading-[1.05] tracking-[-0.045em] sm:text-[3.25rem]">{page.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-[#5e5e58] sm:text-xl">{page.summary}</p>
        <div className="mt-10 flex flex-col gap-6 font-sans text-[16px] leading-[1.75] text-[#3a3a36] sm:text-[17px]">{children}</div>

        <nav aria-label="More docs" className="mt-16 grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link href={prev.href} className="group rounded-2xl border border-line p-5 hover:border-ink/30">
              <span className="flex items-center gap-1.5 text-sm text-[#8a8a83]">
                <ArrowLeft className="size-4" /> Previous
              </span>
              <span className="mt-1 block text-lg font-medium tracking-[-0.02em]">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={next.href} className="group rounded-2xl border border-line p-5 text-right hover:border-ink/30">
              <span className="flex items-center justify-end gap-1.5 text-sm text-[#8a8a83]">
                Next <ArrowRight className="size-4" />
              </span>
              <span className="mt-1 block text-lg font-medium tracking-[-0.02em]">{next.title}</span>
            </Link>
          )}
        </nav>
        <Footer />
      </div>
    </article>
  );
}

/* ---------- writing blocks ---------- */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export function H2({ children }: { children: string }) {
  return (
    <h2 id={slug(children)} className="mt-6 scroll-mt-24 font-tight text-[1.6rem] font-medium leading-tight tracking-[-0.03em] text-ink sm:text-[1.85rem]">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: string }) {
  return <h3 className="mt-2 font-tight text-[1.2rem] font-medium tracking-[-0.02em] text-ink">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-[#2f7d1c]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Numbered steps with a lime number tile. */
export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="flex flex-col gap-5">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lime font-tight text-[15px] font-medium text-ink">{i + 1}</span>
          <div className="pt-1">
            <p className="font-tight text-[1.1rem] font-medium tracking-[-0.02em] text-ink">{s.title}</p>
            <div className="mt-1">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A tinted box for things worth stopping on. */
export function Callout({ tone = "note", title, children }: { tone?: "note" | "warn"; title: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl p-5 ${tone === "warn" ? "bg-[#fdf3e7] ring-1 ring-[#f0d9b8]" : "bg-[#eef8e6] ring-1 ring-[#cfeabd]"}`}>
      <p className={`font-tight font-medium ${tone === "warn" ? "text-[#8a4b0f]" : "text-[#2f7d1c]"}`}>{title}</p>
      <div className="mt-1.5 text-[15px] leading-relaxed sm:text-base">{children}</div>
    </div>
  );
}

/** A two-column fact table. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-5 py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
          <dt className="font-tight font-medium text-ink">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Link cards to other pages or sites. */
export function Cards({ items }: { items: { href: string; title: string; body: string; external?: boolean }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((c) => {
        const inner = (
          <>
            <span className="flex items-center justify-between gap-2 font-tight text-[1.1rem] font-medium tracking-[-0.02em] text-ink">
              {c.title}
              {c.external ? <ArrowUpRight className="size-4 text-[#8a8a83]" /> : <ArrowRight className="size-4 text-[#8a8a83]" />}
            </span>
            <span className="mt-1 block text-[15px] leading-relaxed text-[#5e5e58]">{c.body}</span>
          </>
        );
        return c.external ? (
          <a key={c.href} href={c.href} className="rounded-2xl border border-line bg-white p-5 hover:border-ink/30">
            {inner}
          </a>
        ) : (
          <Link key={c.href} href={c.href} className="rounded-2xl border border-line bg-white p-5 hover:border-ink/30">
            {inner}
          </Link>
        );
      })}
    </div>
  );
}

/** An inline link: internal pages use Next's Link, everything else a plain anchor. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = "font-medium text-[#2f7d1c] underline decoration-[#2f7d1c]/30 underline-offset-[3px] hover:decoration-[#2f7d1c]";
  return href.startsWith("/") ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}
