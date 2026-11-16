"use client";

import { ArrowDown, ArrowLeft, ArrowUpRight, Check, Copy, ExternalLink, Loader2, Plus, Power, RefreshCw, Send, X } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  buildUsdgTransfer,
  getBalances,
  isAddress,
  ETH_LOGO,
  ROBINHOOD_EXPLORER,
  ROBINHOOD_RPC,
  shortAddress,
  USDG_LOGO,
  waitForTx,
  type Balances,
} from "@/lib/wallet";
import { useAuth } from "./auth-provider";

type View = "home" | "fund" | "receive" | "send";

const ROBINHOOD_LOGO = "https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/robinhood.svg";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The signed-in user's wallet: their EVM address on Robinhood Chain, the USDG they hold, and Fund / Send / Receive.
 * Solana and Sui addresses exist on the account but are only used behind the scenes.
 */
export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { account, evmAddress, signOut, live } = useAuth();
  const [view, setView] = useState<View>("home");
  const [bal, setBal] = useState<Balances | null>(null);
  const [balErr, setBalErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!evmAddress) return;
    setLoading(true);
    setBalErr(false);
    try {
      setBal(await getBalances(evmAddress));
    } catch {
      setBalErr(true);
    } finally {
      setLoading(false);
    }
  }, [evmAddress]);

  useEffect(() => {
    if (!open) return;
    setView("home");
    void refresh();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, refresh]);

  if (!open || typeof document === "undefined") return null;

  // Rendered on <body>: the header's blur would otherwise trap a fixed overlay inside the header.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Your Pecun wallet"
        className="relative max-h-[92dvh] w-full max-w-[420px] overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#121315] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 shadow-[0_30px_90px_rgba(0,0,0,0.7)] sm:rounded-[28px] sm:pb-6"
      >
        {view === "home" && (
          <Home
            account={account}
            address={evmAddress}
            bal={bal}
            balErr={balErr}
            loading={loading}
            onRefresh={refresh}
            onClose={onClose}
            onSignOut={async () => {
              await signOut();
              onClose();
            }}
            go={setView}
          />
        )}
        {view === "fund" && evmAddress && <Fund address={evmAddress} back={() => setView("home")} />}
        {view === "receive" && evmAddress && <Receive address={evmAddress} back={() => setView("home")} />}
        {view === "send" && evmAddress && (
          <SendView
            from={evmAddress}
            bal={bal}
            live={live}
            back={() => setView("home")}
            onSent={() => void refresh()}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- home ---------- */

function Home({ account, address, bal, balErr, loading, onRefresh, onClose, onSignOut, go }: {
  account?: string;
  address?: `0x${string}`;
  bal: Balances | null;
  balErr: boolean;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onSignOut: () => void;
  go: (v: View) => void;
}) {
  // Total = USDG (a dollar each) + ETH at its live price.
  const total = (bal?.usdg ?? 0) + (bal?.eth ?? 0) * (bal?.ethPrice ?? 0);
  const [whole, cents] = money(total).split(".");
  return (
    <>
      <div className="flex items-start justify-between">
        <span className="relative">
          <span className="grid size-14 place-items-center rounded-full bg-[#1d2a1a]">
            <svg aria-hidden width={26} height={26} viewBox="12 12 40 40">
              <path d="M14 50C14 28 28 14 50 14Z" fill="#ffffff" />
              <path d="M50 14C50 36 36 50 14 50Z" fill="#b8ff9d" />
            </svg>
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ROBINHOOD_LOGO} alt="Robinhood Chain" title="Robinhood Chain" className="absolute -bottom-0.5 -right-0.5 size-5 rounded-full bg-white ring-2 ring-[#121315]" />
        </span>
        <span className="flex items-center gap-1">
          <IconBtn label="Sign out" onClick={onSignOut}><Power className="size-[18px]" /></IconBtn>
          <IconBtn label="Close" onClick={onClose}><X className="size-5" /></IconBtn>
        </span>
      </div>

      {address ? <CopyAddress address={address} /> : <p className="mt-3 font-sans text-sm text-white/55">Setting up your wallet…</p>}
      {account && <p className="mt-0.5 truncate font-sans text-xs text-white/40">{account}</p>}

      <div className="mt-6">
        <div className="flex items-baseline gap-0.5 font-medium tracking-[-0.04em]">
          <span className="tabular text-[2.9rem] leading-none">${whole}</span>
          <span className="tabular text-[2rem] leading-none text-white/45">.{cents}</span>
          <button type="button" onClick={onRefresh} aria-label="Refresh balance" className="ml-2 self-center rounded-full p-1.5 text-white/40 hover:bg-white/5 hover:text-white">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="mt-2 font-sans text-sm text-white/55">{balErr ? "Couldn't load your balance. Tap refresh." : "Total on Robinhood Chain"}</p>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2.5">
        <Action tone="lime" icon={<Plus className="size-5" />} label="Fund" onClick={() => go("fund")} />
        <Action icon={<Send className="size-5" />} label="Send" onClick={() => go("send")} />
        <Action icon={<ArrowDown className="size-5" />} label="Receive" onClick={() => go("receive")} />
      </div>

      {/* Tokens held on Robinhood Chain, always listed, even at zero. */}
      <div className="mt-6">
        <p className="font-sans text-xs text-white/45">Balances</p>
        <ul className="mt-2 divide-y divide-white/[0.06] rounded-2xl bg-white/[0.04]">
          <TokenRow logo={USDG_LOGO} symbol="USDG" name="Global Dollar" amount={bal?.usdg ?? 0} usd={bal?.usdg ?? 0} digits={2} />
          <TokenRow logo={ETH_LOGO} symbol="ETH" name="Network fees" amount={bal?.eth ?? 0} usd={(bal?.eth ?? 0) * (bal?.ethPrice ?? 0)} digits={6} />
        </ul>
      </div>
    </>
  );
}

function TokenRow({ logo, symbol, name, amount, usd, digits }: { logo: string; symbol: string; name: string; amount: number; usd: number; digits: number }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="relative shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" className="size-9 rounded-full bg-white" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ROBINHOOD_LOGO} alt="" className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-white ring-2 ring-[#16171a]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{symbol}</span>
        <span className="block truncate font-sans text-xs text-white/45">{name}</span>
      </span>
      <span className="text-right">
        <span className="tabular block text-[15px] font-medium">{amount.toLocaleString("en-US", { maximumFractionDigits: digits })}</span>
        <span className="tabular block font-sans text-xs text-white/45">${money(usd)}</span>
      </span>
    </li>
  );
}

function Action({ icon, label, onClick, tone }: { icon: ReactNode; label: string; onClick: () => void; tone?: "lime" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[88px] flex-col items-start justify-between rounded-2xl p-3.5 text-left text-[15px] font-medium transition ${
        tone === "lime" ? "bg-accent text-on-accent hover:bg-accent-deep" : "bg-white/[0.06] text-white hover:bg-white/[0.1]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid size-9 place-items-center rounded-full text-white/60 hover:bg-white/5 hover:text-white">
      {children}
    </button>
  );
}

function CopyAddress({ address, full }: { address: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={`mt-3 inline-flex max-w-full items-center gap-2 text-left text-white hover:text-white/80 ${full ? "font-mono text-[13px] break-all" : "text-xl font-medium tracking-[-0.02em]"}`}
      aria-label="Copy address"
    >
      <span className={full ? "" : "tabular"}>{full ? address : shortAddress(address)}</span>
      {copied ? <Check className="size-4 shrink-0 text-accent" /> : <Copy className="size-4 shrink-0 text-white/45" />}
    </button>
  );
}

function Header({ title, back }: { title: string; back: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <IconBtn label="Back" onClick={back}><ArrowLeft className="size-5" /></IconBtn>
      <h2 className="text-lg font-medium tracking-[-0.02em]">{title}</h2>
    </div>
  );
}

/* ---------- receive / fund ---------- */

function QR({ value }: { value: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(value, { margin: 1, width: 360, color: { dark: "#0a0b0d", light: "#ffffff" } }).then(setSrc);
  }, [value]);
  return (
    <div className="mx-auto grid size-[188px] place-items-center rounded-2xl bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="Wallet address QR code" className="size-full" /> : <Loader2 className="size-6 animate-spin text-black/40" />}
    </div>
  );
}

function NetworkNote() {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-2xl border border-amber/25 bg-amber/[0.07] px-4 py-3 font-sans text-[13px] leading-relaxed text-white/80">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ROBINHOOD_LOGO} alt="" className="mt-0.5 size-4 shrink-0 rounded-full bg-white" />
      <span>
        Only send <b className="font-medium text-white">USDG</b> (or ETH for fees) on <b className="font-medium text-white">Robinhood Chain</b>. Tokens sent on another
        network may be lost.
      </span>
    </p>
  );
}

function Receive({ address, back }: { address: string; back: () => void }) {
  return (
    <>
      <Header title="Receive" back={back} />
      <div className="mt-5"><QR value={address} /></div>
      <p className="mt-5 text-center font-sans text-xs text-white/45">Your address on Robinhood Chain</p>
      <div className="mt-1 text-center"><CopyAddress address={address} full /></div>
      <NetworkNote />
    </>
  );
}

function Fund({ address, back }: { address: string; back: () => void }) {
  return (
    <>
      <Header title="Fund your wallet" back={back} />
      <p className="mt-3 font-sans text-sm leading-relaxed text-white/60">Add USDG on Robinhood Chain. It lands in your Pecun wallet, ready to put to work.</p>
      <ol className="mt-5 space-y-3">
        {[
          ["From the Robinhood app", "Withdraw USDG, choose Robinhood Chain as the network, and paste your address below."],
          ["From another wallet or exchange", "Send USDG on Robinhood Chain to the same address. Other networks aren't supported here yet."],
        ].map(([t, b], i) => (
          <li key={t} className="flex gap-3 rounded-2xl bg-white/[0.05] p-4">
            <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent">{i + 1}</span>
            <span>
              <span className="block text-[15px] font-medium">{t}</span>
              <span className="mt-0.5 block font-sans text-[13px] leading-relaxed text-white/55">{b}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 rounded-2xl border border-white/10 p-4">
        <p className="font-sans text-xs text-white/45">Your address</p>
        <CopyAddress address={address} full />
      </div>
      <NetworkNote />
    </>
  );
}

/* ---------- send ---------- */

function SendView({ from, bal, live, back, onSent }: { from: `0x${string}`; bal: Balances | null; live: boolean; back: () => void; onSent: () => void }) {
  const { sendEvmTransaction } = useAuth();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"form" | "review" | "sending" | "done">("form");
  const [fee, setFee] = useState<number | null>(null);
  const [unsigned, setUnsigned] = useState("");
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState("");

  const usdg = bal?.usdg ?? 0;
  const n = Number(amount);
  const amountOk = amount !== "" && n > 0 && n <= usdg && /^\d*\.?\d{0,6}$/.test(amount);
  const toOk = isAddress(to) && to.toLowerCase() !== from.toLowerCase();

  const review = async () => {
    setError("");
    try {
      const t = await buildUsdgTransfer(from, to.trim() as `0x${string}`, amount);
      setUnsigned(t.unsigned);
      setFee(t.feeEth);
      setStage("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(/insufficient|exceeds balance/i.test(msg) ? "Not enough USDG, or not enough ETH for the network fee." : "Couldn't prepare the transfer. Check the details and try again.");
    }
  };

  const send = async () => {
    setStage("sending");
    setError("");
    const r = await sendEvmTransaction(unsigned, ROBINHOOD_RPC);
    if (!r.ok) {
      setError(r.error);
      setStage("review");
      return;
    }
    setHash(r.hash);
    const ok = await waitForTx(r.hash).catch(() => true);
    if (!ok) {
      setError("The transfer failed on-chain. Your USDG wasn't moved.");
      setStage("review");
      return;
    }
    setStage("done");
    onSent();
  };

  if (stage === "done" && hash) {
    return (
      <div className="py-4 text-center" role="status">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-on-accent"><Check className="size-7" strokeWidth={2.5} /></span>
        <h2 className="mt-5 text-[1.5rem] font-medium tracking-[-0.03em]">Sent</h2>
        <p className="mt-1.5 font-sans text-sm text-white/55">{money(n)} USDG to {shortAddress(to)}</p>
        <a href={`${ROBINHOOD_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 font-sans text-sm text-accent hover:underline">
          View on explorer <ExternalLink className="size-3.5" />
        </a>
        <button type="button" onClick={back} className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-[#f3f4f6] text-[15px] font-medium text-[#0a0b0d] hover:bg-white">
          Done
        </button>
      </div>
    );
  }

  return (
    <>
      <Header title="Send USDG" back={stage === "review" ? () => setStage("form") : back} />

      {stage === "form" ? (
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="font-sans text-xs text-white/50">To</span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="0x… address on Robinhood Chain"
              spellCheck={false}
              autoComplete="off"
              className="mt-1.5 h-13 w-full rounded-2xl border border-white/15 bg-transparent px-4 py-3.5 font-mono text-[14px] text-white outline-none placeholder:font-sans placeholder:text-white/30 focus:border-white/40"
            />
            {to && !isAddress(to) && <span className="mt-1 block font-sans text-xs text-neg">That isn&apos;t a valid address.</span>}
            {isAddress(to) && to.toLowerCase() === from.toLowerCase() && <span className="mt-1 block font-sans text-xs text-neg">That&apos;s your own address.</span>}
          </label>
          <label className="block">
            <span className="flex items-center justify-between font-sans text-xs text-white/50">
              Amount
              <span>Available {usdg.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDG</span>
            </span>
            <span className="mt-1.5 flex items-center rounded-2xl border border-white/15 px-4 focus-within:border-white/40">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0.00"
                className="tabular h-14 min-w-0 flex-1 bg-transparent text-[1.4rem] font-medium text-white outline-none placeholder:text-white/25"
              />
              <button type="button" onClick={() => setAmount(String(usdg))} className="rounded-full bg-white/10 px-3 py-1 font-sans text-xs text-white hover:bg-white/15">
                Max
              </button>
              <span className="ml-2 flex items-center gap-1.5 font-sans text-sm text-white/70">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={USDG_LOGO} alt="" className="size-5 rounded-full" /> USDG
              </span>
            </span>
            {amount !== "" && n > usdg && <span className="mt-1 block font-sans text-xs text-neg">That&apos;s more than you have.</span>}
          </label>
          <button
            type="button"
            onClick={() => void review()}
            disabled={!toOk || !amountOk}
            className="flex h-14 w-full items-center justify-center rounded-full bg-[#f3f4f6] text-[16px] font-medium text-[#0a0b0d] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <dl className="divide-y divide-white/10 rounded-2xl border border-white/10 font-sans text-sm">
            {[
              ["Sending", `${money(n)} USDG`],
              ["To", shortAddress(to)],
              ["Network", "Robinhood Chain"],
              ["Network fee", fee != null ? `≈ ${fee.toLocaleString("en-US", { maximumFractionDigits: 8 })} ETH` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-3">
                <dt className="text-white/50">{k}</dt>
                <dd className="tabular text-white">{v}</dd>
              </div>
            ))}
          </dl>
          {bal && fee != null && bal.eth < fee && (
            <p className="mt-3 font-sans text-xs text-amber">You need a little ETH on Robinhood Chain for the network fee.</p>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={stage === "sending"}
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-medium text-on-accent transition hover:bg-accent-deep disabled:opacity-70"
          >
            {stage === "sending" ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
            {stage === "sending" ? (hash ? "Confirming" : "Sending") : `Send ${money(n)} USDG`}
          </button>
          {!live && <p className="mt-3 text-center font-sans text-xs text-white/40">Demo mode: nothing is sent.</p>}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-2xl border border-neg/30 bg-neg/[0.08] px-4 py-3 font-sans text-sm leading-relaxed text-white/85">
          {error}
        </p>
      )}
    </>
  );
}
