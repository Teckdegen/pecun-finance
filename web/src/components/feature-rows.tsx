import { Check, Coins, Fingerprint, Landmark, Layers, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import type { Featured } from "@/lib/live";
import { pct } from "@/lib/live";
import { TURNKEY } from "@/lib/site";

/**
 * Four panels, PECUN colours. Rates and logos are live.
 * No sample balance and no made-up return.
 */

function Panel({ children }: { children: ReactNode }) {
  return <div className="relative h-[220px] overflow-hidden rounded-[24px] bg-[#f3f2ee] sm:h-[250px]">{children}</div>;
}

function Caption({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-4">
      <h3 className="text-[15px] font-medium leading-snug">{title}</h3>
      <p className="mt-1 max-w-[42ch] text-sm leading-snug text-muted">{text}</p>
    </div>
  );
}

function Rates({ rows }: { rows: Featured[] }) {
  const ranked = [...rows].sort((a, b) => b.apy - a.apy);
  const ordered = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
  return (
    <Panel>
      <div className="flex h-full items-center justify-center gap-3 px-4 sm:gap-5">
        {ordered.map((v, i) => {
          const lead = i === 1;
          return (
            <div key={v.name} className={`flex w-[92px] flex-col items-center ${lead ? "-mt-3" : "mt-4"}`}>
              <span className={`grid place-items-center rounded-full bg-white shadow-[0_8px_24px_rgba(10,10,10,0.08)] ${lead ? "size-[78px] ring-4 ring-lime" : "size-14"}`}>
                <Logo src={v.protocolLogo ?? v.logo} label={v.protocol} size={lead ? 40 : 28} />
              </span>
              <span className="mt-3 tabular text-sm font-medium text-green">{pct(v.apy)}</span>
              <span className="mt-0.5 max-w-[88px] truncate text-[11px] text-muted" title={v.protocol}>
                {v.protocol}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function LiveRate({ v }: { v?: Featured }) {
  return (
    <Panel>
      <div className="absolute left-6 top-5 sm:left-7 sm:top-6">
        <div className="tabular text-[2rem] font-medium leading-none tracking-[-0.04em] sm:text-[2.35rem]">{v ? pct(v.apy) : "—"}</div>
        <p className="mt-2 text-sm font-medium text-green">{v ? `Live · ${v.protocol}` : "Live rate"}</p>
      </div>
      <svg viewBox="0 0 480 150" className="absolute inset-x-0 bottom-0 h-[58%] w-full" aria-hidden>
        <path d="M0 112 C 70 114, 120 78, 175 74 S 280 112, 340 52 S 430 16, 490 30 L 490 150 L 0 150 Z" fill="#b8ff9d" opacity="0.45" />
        <path d="M0 112 C 70 114, 120 78, 175 74 S 280 112, 340 52 S 430 16, 490 30" fill="none" stroke="#2f7d1c" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="175" cy="74" r="4.5" fill="#0a0a0a" />
        <circle cx="175" cy="74" r="8" fill="none" stroke="#0a0a0a" strokeOpacity="0.12" />
        <circle cx="340" cy="52" r="4.5" fill="#0a0a0a" />
        <circle cx="340" cy="52" r="8" fill="none" stroke="#0a0a0a" strokeOpacity="0.12" />
      </svg>
    </Panel>
  );
}

function Kinds() {
  const kinds: { label: string; icon: ReactNode }[] = [
    { label: "Lending", icon: <Landmark className="size-4" /> },
    { label: "Vault", icon: <Layers className="size-4" /> },
    { label: "Staking", icon: <Coins className="size-4" /> },
  ];
  return (
    <Panel>
      <div className="flex h-full flex-col justify-center gap-2.5 px-5 sm:px-7">
        {kinds.map((k) => (
          <div key={k.label} className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 shadow-[0_8px_22px_rgba(10,10,10,0.05)]">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lime text-ink">{k.icon}</span>
            <span className="text-sm font-medium">{k.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Keys() {
  const steps: { title: string; icon: ReactNode }[] = [
    { title: "Email", icon: <Mail className="size-4" /> },
    { title: "Passkey", icon: <Fingerprint className="size-4" /> },
    { title: TURNKEY.name, icon: <Logo src={TURNKEY.logo} label={TURNKEY.name} size={18} /> },
  ];
  return (
    <Panel>
      <div className="flex h-full flex-col items-center justify-center px-6">
        <span className="grid size-16 place-items-center rounded-full bg-lime text-ink shadow-[0_10px_24px_rgba(184,255,157,0.45)]">
          <Check className="size-7" aria-hidden />
        </span>
        <p className="mt-4 text-[1.35rem] font-medium tracking-[-0.03em]">Keys stay with you</p>
        <div className="mt-3 flex items-center gap-2">
          {steps.map((s) => (
            <span key={s.title} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] font-medium shadow-[0_6px_16px_rgba(10,10,10,0.05)]">
              {s.icon}
              {s.title}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

export function FeatureRows({ rows, featured }: { rows: Featured[]; featured: Featured[] }) {
  const list = (rows.length >= 3 ? rows : featured).slice(0, 3);
  const cards = [
    {
      title: "Find the best rate",
      text: "Lending, vaults and staking in one list.",
      graphic: <Rates rows={list} />,
    },
    {
      title: "See the live rate",
      text: "The rate on the vault is live, from the protocol you pick.",
      graphic: <LiveRate v={featured[0]} />,
    },
    {
      title: "Know what you deposit into",
      text: "Lending, vaults and staking, each named for what it is.",
      graphic: <Kinds />,
    },
    {
      title: "Your keys stay yours",
      text: "Sign up with email or a passkey. PECUN never holds the deposit.",
      graphic: <Keys />,
    },
  ];
  return (
    <div className="mx-auto grid max-w-[1040px] gap-x-4 gap-y-10 sm:grid-cols-2">
      {cards.map((c) => (
        <article key={c.title}>
          {c.graphic}
          <Caption title={c.title} text={c.text} />
        </article>
      ))}
    </div>
  );
}
