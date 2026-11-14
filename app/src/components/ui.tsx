"use client";

import { useState } from "react";
import { CHAIN_COLOR } from "@/lib/chains.ts";
import type { Opportunity } from "@/lib/types.ts";

export const usd = (n: number, digits = 2) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(digits)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(digits)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(digits)}K` : `$${n.toFixed(2)}`;
export const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${(n * 100).toFixed(Math.abs(n) * 100 >= 100 ? 0 : 2)}%`;
export const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
export const display = (o: Opportunity) => {
  const name = o.name.replace(/\s+lending\b/i, "");
  return o.ticker ? `${o.ticker.toUpperCase()} · ${name}` : name;
};
const KIND_WORD = /^(lending|vault|vaults|liquidity|fixed yield|liquid staking|perp vault|perps|staking|lending market|direct market)$/i;
/** Category under the name, then the protocol that runs it. Never a product kind, never a link out. */
export const subtitle = (o: Opportunity) => {
  const cat = o.category && !KIND_WORD.test(o.category) ? o.category : o.stablecoin ? "Stablecoin Yield" : undefined;
  if (cat && cat.toLowerCase() !== o.protocol.toLowerCase()) return `${cat} · ${o.protocol}`;
  return o.protocol;
};

const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function Mark({ label, size = 36, ring }: { label: string; size?: number; ring?: boolean }) {
  const hue = hueOf(label);
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-medium text-white ${ring ? "ring-2 ring-card" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `radial-gradient(circle at 30% 25%, hsl(${hue} 55% 60%), hsl(${hue} 50% 34%))` }}
    >
      {label.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

/** Image logo with a lettered fallback when missing or broken. */
export function Logo({ src, label, size = 36, ring, title }: { src?: string; label: string; size?: number; ring?: boolean; title?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <Mark label={label} size={size} ring={ring} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- logos come from many external hosts
    <img
      src={src}
      alt=""
      title={title}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full bg-white object-cover ${ring ? "ring-2 ring-card" : ""}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Vault mark: the vault's own logo, else the deposit token with a small protocol badge. */
export function VaultMark({ o, size = 44 }: { o: Opportunity; size?: number }) {
  if (o.logoUrl && o.protocol === "Ember") return <Logo src={o.logoUrl} label={o.name} size={size} />;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <Logo src={o.assetLogo ?? o.logoUrl} label={o.asset} size={size} />
      <span className="absolute -bottom-0.5 -right-0.5">
        <Logo src={o.protocolLogo} label={o.protocol} size={Math.round(size * 0.42)} ring title={o.protocol} />
      </span>
    </span>
  );
}

export function ChainIcon({ chain, logo, size = 22 }: { chain: string; logo?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt={chain} title={chain} width={size} height={size} loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(true)} className="shrink-0 rounded-full" style={{ width: size, height: size }} />
    );
  }
  return (
    <span title={chain} className="grid shrink-0 place-items-center rounded-full text-[10px] font-medium text-white"
      style={{ width: size, height: size, background: CHAIN_COLOR[chain] ?? "#3a3a3a" }}>
      {chain[0]}
    </span>
  );
}

export function ManagerLogos({ o, size = 22 }: { o: Opportunity; size?: number }) {
  const ms = o.managers?.length ? o.managers : [{ name: o.manager, logoUrl: o.protocolLogo }];
  return (
    <span className="flex items-center" title={ms.map((m) => m.name).join(", ")}>
      {ms.slice(0, 3).map((m, i) => (
        <span key={m.name + i} className={i ? "-ml-1.5" : ""}>
          <Logo src={m.logoUrl} label={m.name} size={size} ring />
        </span>
      ))}
    </span>
  );
}


/* ---------- addresses: explorer link with the explorer's own logo, plus copy ---------- */

type Explorer = { name: string; base: string; logo?: string; path: (a: string) => string };
const evm = (name: string, base: string, logo?: string): Explorer => ({ name, base, logo, path: (a) => `${base}/address/${a}` });
const EXPLORERS: Record<string, Explorer> = {
  Ethereum: evm("Etherscan", "https://etherscan.io", "/logos/explorers/etherscan.ico"),
  Base: evm("BaseScan", "https://basescan.org", "/logos/explorers/basescan.ico"),
  Arbitrum: evm("Arbiscan", "https://arbiscan.io", "/logos/explorers/arbiscan.ico"),
  Optimism: evm("Optimism Explorer", "https://optimistic.etherscan.io", "/logos/explorers/optimism.ico"),
  Polygon: evm("PolygonScan", "https://polygonscan.com", "/logos/explorers/polygonscan.ico"),
  "BNB Chain": evm("BscScan", "https://bscscan.com", "/logos/explorers/bscscan.ico"),
  Avalanche: evm("Snowtrace", "https://snowtrace.io"),
  Sonic: evm("SonicScan", "https://sonicscan.org", "/logos/explorers/sonicscan.ico"),
  Linea: evm("LineaScan", "https://lineascan.build", "/logos/explorers/lineascan.ico"),
  Unichain: evm("Uniscan", "https://uniscan.xyz", "/logos/explorers/uniscan.ico"),
  "World Chain": evm("WorldScan", "https://worldscan.org", "/logos/explorers/worldscan.ico"),
  HyperEVM: evm("HyperEVMScan", "https://hyperevmscan.io", "/logos/explorers/hyperevmscan.ico"),
  Monad: evm("MonadScan", "https://monadscan.com", "/logos/explorers/monadscan.ico"),
  Katana: evm("KatanaScan", "https://katanascan.com", "/logos/explorers/katanascan.ico"),
  Plasma: evm("PlasmaScan", "https://plasmascan.to", "/logos/explorers/plasmascan.ico"),
  Gnosis: evm("GnosisScan", "https://gnosisscan.io", "/logos/explorers/gnosisscan.png"),
  Mantle: evm("MantleScan", "https://mantlescan.xyz", "/logos/explorers/mantlescan.ico"),
  Berachain: evm("BeraScan", "https://berascan.com", "/logos/explorers/berascan.ico"),
  Solana: { name: "Solscan", base: "https://solscan.io", logo: "/logos/explorers/solscan.ico", path: (a) => `https://solscan.io/account/${a}` },
  Sui: { name: "SuiScan", base: "https://suiscan.xyz", logo: "/logos/explorers/suiscan.png", path: (a) => `https://suiscan.xyz/mainnet/object/${a}` },
};

export function explorerFor(chain: string, address: string) {
  const e = EXPLORERS[chain];
  return e && /^(0x[0-9a-fA-F]{40,64}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(address) ? { ...e, url: e.path(address) } : undefined;
}

/** Short address with a copy button (✓ on success) and a link to the chain's explorer, shown with the explorer's logo. */
export function AddressPill({ address, chain, label }: { address: string; chain: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const ex = explorerFor(chain, address);
  const copy = () => {
    navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[13px]" title={address}>{label ?? short(address)}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy address"}
        title={copied ? "Copied" : "Copy address"}
        className={`inline-flex h-7 items-center gap-1 rounded-lg border px-1.5 text-[11px] transition ${
          copied ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-card-2 text-muted hover:border-white/30 hover:text-ink"
        }`}
      >
        {copied ? (
          <>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
            Copied
          </>
        ) : (
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </svg>
        )}
      </button>
      {ex && (
        <a href={ex.url} target="_blank" rel="noreferrer" aria-label={`View on ${ex.name}`} title={`View on ${ex.name}`}
          className="inline-flex size-7 items-center justify-center rounded-lg border border-line bg-card-2 transition hover:border-faint">
          {ex.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ex.logo} alt="" width={16} height={16} className="size-4 rounded-sm" />
          ) : (
            <svg viewBox="0 0 24 24" className="size-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
          )}
        </a>
      )}
    </span>
  );
}
