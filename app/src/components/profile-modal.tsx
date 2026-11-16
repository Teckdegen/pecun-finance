"use client";

import { ArrowDown, ArrowDownUp, ArrowLeft, ArrowUpRight, Check, ChevronDown, Copy, ExternalLink, Loader2, Power, Send, X } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  buildEthTransfer,
  buildUsdgTransfer,
  ETH_LOGO,
  getBalances,
  isAddress,
  ROBINHOOD_EXPLORER,
  ROBINHOOD_RPC,
  shortAddress,
  USDG_LOGO,
  waitForTx,
  type Balances,
} from "@/lib/wallet";
import { useAuth } from "./auth-provider";

type View = "home" | "receive" | "send";

const ROBINHOOD_LOGO = "https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/robinhood.svg";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The signed-in user's wallet: their EVM address on Robinhood Chain, what they hold (USDG and ETH), Send and Receive.
 * Solana and Sui addresses exist on the account but are only used behind the scenes.
 */
export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { account, evmAddress, signOut, live } = useAuth();
  const [view, setView] = useState<View>("home");
  const [bal, setBal] = useState<Balances | null>(null);
  const [balErr, setBalErr] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!evmAddress) return;
    setBalErr(false);
    try {
      setBal(await getBalances(evmAddress));
    } catch {
      setBalErr(true);
    }
  }, [evmAddress]);

  // Load on open, then keep the balance fresh every 20 seconds while the wallet is open.
  useEffect(() => {
    if (!open) return;
    setView("home");
    void refresh();
    const t = setInterval(() => void refresh(), 20_000);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
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
        className="relative max-h-[92dvh] w-full max-w-[440px] overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#121315] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 shadow-[0_30px_90px_rgba(0,0,0,0.7)] sm:rounded-[28px] sm:pb-7"
      >
        {view === "home" && (
          <Home
            account={account}
            address={evmAddress}
            bal={bal}
            balErr={balErr}
            onClose={onClose}
            onSignOut={async () => {
              await signOut();
              onClose();
            }}
            go={setView}
          />
        )}
        {view === "receive" && evmAddress && <Receive address={evmAddress} back={() => setView("home")} close={onClose} />}
        {view === "send" && evmAddress && (
          <SendView from={evmAddress} bal={bal} live={live} close={onClose} back={() => setView("home")} onSent={() => void refresh()} />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- home ---------- */

function Home({ account, address, bal, balErr, onClose, onSignOut, go }: {
  account?: string;
  address?: `0x${string}`;
  bal: Balances | null;
  balErr: boolean;
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
        <Avatar />
        <span className="flex items-center gap-1">
          <IconBtn label="Sign out" onClick={onSignOut}><Power className="size-[18px]" /></IconBtn>
          <IconBtn label="Close" onClick={onClose}><X className="size-5" /></IconBtn>
        </span>
      </div>

      {address ? <CopyShort address={address} /> : <p className="mt-3 font-sans text-sm text-white/55">Setting up your wallet…</p>}
      {account && <p className="mt-0.5 truncate font-sans text-xs text-white/40">{account}</p>}

      <div className="mt-6 flex items-baseline gap-0.5 font-medium tracking-[-0.04em]">
        <span className="tabular text-[2.9rem] leading-none">${whole}</span>
        <span className="tabular text-[2rem] leading-none text-white/45">.{cents}</span>
      </div>
      {balErr && <p className="mt-2 font-sans text-sm text-white/55">Couldn&apos;t load your balance right now.</p>}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Action icon={<Send className="size-6" />} label="Send" onClick={() => go("send")} />
        <Action icon={<ArrowDown className="size-6" />} label="Receive" onClick={() => go("receive")} />
      </div>

      {/* Tokens held on Robinhood Chain, always listed, even at zero. */}
      <div className="mt-6">
        <p className="font-sans text-xs text-white/45">Balances</p>
        <ul className="mt-1 divide-y divide-white/[0.06]">
          <TokenRow logo={USDG_LOGO} symbol="USDG" name="Global Dollar" amount={bal?.usdg ?? 0} usd={bal?.usdg ?? 0} digits={2} />
          <TokenRow logo={ETH_LOGO} symbol="ETH" name="Network fees" amount={bal?.eth ?? 0} usd={(bal?.eth ?? 0) * (bal?.ethPrice ?? 0)} digits={6} />
        </ul>
      </div>
    </>
  );
}

function Avatar() {
  return (
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
  );
}

function TokenRow({ logo, symbol, name, amount, usd, digits }: { logo: string; symbol: string; name: string; amount: number; usd: number; digits: number }) {
  return (
    <li className="flex items-center gap-3 py-3.5">
      <TokenIcon logo={logo} />
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

function TokenIcon({ logo, size = 36 }: { logo: string; size?: number }) {
  return (
    <span className="relative shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" className="rounded-full bg-white" style={{ width: size, height: size }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ROBINHOOD_LOGO} alt="" className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-white ring-2 ring-[#121315]" />
    </span>
  );
}

function Action({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[104px] flex-col items-start justify-between rounded-[22px] bg-accent/[0.09] p-4 text-left text-[17px] font-medium text-accent transition hover:bg-accent/[0.15]"
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

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return { copied, copy };
}

function CopyShort({ address }: { address: string }) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" onClick={() => copy(address)} aria-label="Copy address" className="mt-3 inline-flex items-center gap-2 text-xl font-medium tracking-[-0.02em] text-white hover:text-white/80">
      <span className="tabular [font-feature-settings:'calt'_0]">{shortAddress(address)}</span>
      {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4 text-white/45" />}
    </button>
  );
}

/* ---------- receive ---------- */

/** QR with round dots, rounded finder squares in lime, and the Pecun leaf in the middle. */
function StyledQR({ value, size = 260 }: { value: string; size?: number }) {
  const qr = useMemo(() => QRCode.create(value, { errorCorrectionLevel: "H" }), [value]);
  const n = qr.modules.size;
  const cell = size / n;
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const logoCells = Math.ceil(n * 0.26);
  const lo = Math.floor((n - logoCells) / 2), hi = lo + logoCells;
  const dots: ReactNode[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c) || finder(r, c) || (r >= lo && r < hi && c >= lo && c < hi)) continue;
      dots.push(<circle key={`${r}-${c}`} cx={(c + 0.5) * cell} cy={(r + 0.5) * cell} r={cell * 0.42} />);
    }
  const Eye = ({ r, c }: { r: number; c: number }) => (
    <g transform={`translate(${c * cell} ${r * cell})`}>
      <rect x={cell * 0.5} y={cell * 0.5} width={cell * 6} height={cell * 6} rx={cell * 1.8} fill="none" stroke="currentColor" strokeWidth={cell} />
      <rect x={cell * 2} y={cell * 2} width={cell * 3} height={cell * 3} rx={cell} />
    </g>
  );
  const mid = size / 2, badge = logoCells * cell * 0.82;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="mx-auto block max-w-full text-accent" role="img" aria-label="Wallet address QR code" fill="currentColor">
      {dots}
      <Eye r={0} c={0} />
      <Eye r={0} c={n - 7} />
      <Eye r={n - 7} c={0} />
      <circle cx={mid} cy={mid} r={badge / 2} fill="#1d2a1a" />
      <svg x={mid - badge * 0.28} y={mid - badge * 0.28} width={badge * 0.56} height={badge * 0.56} viewBox="12 12 40 40">
        <path d="M14 50C14 28 28 14 50 14Z" fill="#ffffff" />
        <path d="M50 14C50 36 36 50 14 50Z" fill="#b8ff9d" />
      </svg>
    </svg>
  );
}

function Receive({ address, back, close }: { address: string; back: () => void; close: () => void }) {
  const { copied, copy } = useCopy();
  return (
    <>
      <div className="flex items-center justify-between">
        <IconBtn label="Back" onClick={back}><ArrowLeft className="size-5" /></IconBtn>
        <IconBtn label="Close" onClick={close}><X className="size-5" /></IconBtn>
      </div>
      <h2 className="mt-4 text-[1.9rem] font-medium leading-tight tracking-[-0.03em]">Robinhood Chain address</h2>

      <div className="mt-6"><StyledQR value={address} /></div>

      <fieldset className="mt-7 rounded-[22px] border border-white/15 px-5 pb-5 pt-3 text-center">
        <legend className="mx-auto px-3">
          <button type="button" onClick={() => copy(address)} className="inline-flex items-center gap-2 font-sans text-sm text-white/60 hover:text-white">
            Robinhood Chain address {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
          </button>
        </legend>
        <p className="tabular break-all text-[1.05rem] font-medium leading-snug text-white [font-feature-settings:'calt'_0]">{address}</p>
      </fieldset>

      <p className="mt-5 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center font-sans text-[15px] text-white/80">
        Use this address to receive USDG and ETH on
        <span className="inline-flex items-center gap-1.5 font-medium text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ROBINHOOD_LOGO} alt="" className="size-5 rounded-full bg-white" /> Robinhood Chain
        </span>
      </p>
      <p className="mt-2 text-center font-sans text-xs text-white/40">Tokens sent on any other network may be lost.</p>
    </>
  );
}

/* ---------- send ---------- */

type Token = "USDG" | "ETH";

function SendView({ from, bal, live, close, back, onSent }: {
  from: `0x${string}`;
  bal: Balances | null;
  live: boolean;
  close: () => void;
  back: () => void;
  onSent: () => void;
}) {
  const { sendEvmTransaction } = useAuth();
  const [token, setToken] = useState<Token>("USDG");
  const [picker, setPicker] = useState(false);
  const [inUsd, setInUsd] = useState(true);
  const [input, setInput] = useState("");
  const [to, setTo] = useState("");
  const [stage, setStage] = useState<"form" | "review" | "sending" | "done">("form");
  const [fee, setFee] = useState<number | null>(null);
  const [unsigned, setUnsigned] = useState("");
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState("");

  const price = token === "USDG" ? 1 : bal?.ethPrice ?? 0;
  const balance = token === "USDG" ? bal?.usdg ?? 0 : bal?.eth ?? 0;
  const decimals = token === "USDG" ? 6 : 18;
  const n = Number(input) || 0;
  // The amount in tokens, whichever way it was typed.
  const tokens = inUsd ? (price > 0 ? n / price : 0) : n;
  const usd = inUsd ? n : n * price;
  const tokenStr = tokens > 0 ? tokens.toFixed(Math.min(decimals, token === "USDG" ? 6 : 8)).replace(/\.?0+$/, "") : "0";
  // Demo mode holds nothing, so it skips the balance check to let the whole flow be tried.
  const tooMuch = live && tokens > balance;
  const amountOk = tokens > 0 && !tooMuch && (!inUsd || price > 0);
  const toOk = isAddress(to) && to.toLowerCase() !== from.toLowerCase();

  const review = async () => {
    setError("");
    if (!live) {
      // Demo: no real transaction is built.
      setUnsigned("demo");
      setFee(0.000002);
      setStage("review");
      return;
    }
    try {
      const build = token === "USDG" ? buildUsdgTransfer : buildEthTransfer;
      const t = await build(from, to.trim() as `0x${string}`, tokenStr);
      setUnsigned(t.unsigned);
      setFee(t.feeEth);
      setStage("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(/insufficient|exceeds balance/i.test(msg) ? "Not enough balance, or not enough ETH for the network fee." : "Couldn't prepare the transfer. Check the details and try again.");
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
    // Demo mode has no real transaction to wait for.
    const ok = live ? await waitForTx(r.hash).catch(() => true) : true;
    if (!ok) {
      setError("The transfer failed on-chain. Nothing was moved.");
      setStage("review");
      return;
    }
    setStage("done");
    onSent();
  };

  const title = (
    <div className="relative flex h-9 items-center justify-center">
      {stage === "review" && (
        <span className="absolute left-0"><IconBtn label="Back" onClick={() => setStage("form")}><ArrowLeft className="size-5" /></IconBtn></span>
      )}
      {stage === "form" && (
        <span className="absolute left-0"><IconBtn label="Back" onClick={back}><ArrowLeft className="size-5" /></IconBtn></span>
      )}
      <h2 className="text-lg font-medium tracking-[-0.02em]">Send crypto</h2>
      <span className="absolute right-0"><IconBtn label="Close" onClick={close}><X className="size-5" /></IconBtn></span>
    </div>
  );

  if (stage === "done" && hash) {
    return (
      <>
        {title}
        <div className="pb-2 pt-8 text-center" role="status">
          <span className="relative mx-auto grid size-20 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/25 [animation-iteration-count:2]" />
            <span className="relative grid size-20 place-items-center rounded-full bg-accent text-on-accent shadow-[0_0_40px_rgba(184,255,157,0.35)]">
              <Check className="size-10" strokeWidth={2.75} />
            </span>
          </span>
          <h3 className="mt-6 text-[1.7rem] font-medium tracking-[-0.03em]">Sent successfully</h3>
          <p className="tabular mt-3 text-[2.2rem] font-medium leading-none tracking-[-0.04em]">${money(usd)}</p>
          <p className="tabular mt-2 font-sans text-sm text-white/55">
            {tokenStr} {token} to {shortAddress(to)}
          </p>
          <dl className="mt-6 divide-y divide-white/10 rounded-2xl border border-white/10 text-left font-sans text-sm">
            {[
              ["Status", "Confirmed"],
              ["Network", "Robinhood Chain"],
              ["Transaction", shortAddress(hash)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-3">
                <dt className="text-white/50">{k}</dt>
                <dd className={`tabular ${k === "Status" ? "text-accent" : "text-white"}`}>{v}</dd>
              </div>
            ))}
          </dl>
          {live ? (
            <a href={`${ROBINHOOD_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 font-sans text-sm text-accent hover:underline">
              View on explorer <ExternalLink className="size-3.5" />
            </a>
          ) : (
            <p className="mt-4 font-sans text-xs text-white/40">Demo mode: nothing was actually sent.</p>
          )}
          <button type="button" onClick={back} className="mt-6 flex h-14 w-full items-center justify-center rounded-full bg-[#f3f4f6] text-[16px] font-medium text-[#0a0b0d] hover:bg-white">
            Done
          </button>
        </div>
      </>
    );
  }

  if (stage === "review" || stage === "sending") {
    return (
      <>
        {title}
        <div className="mt-5 text-center">
          <p className="font-sans text-sm text-white/55">You&apos;re sending</p>
          <p className="tabular mt-2 text-[3rem] font-medium leading-none tracking-[-0.04em]">${money(usd)}</p>
          <p className="tabular mt-2 font-sans text-white/55">{tokenStr} {token}</p>
        </div>
        <dl className="mt-6 divide-y divide-white/10 rounded-2xl border border-white/10 font-sans text-sm">
          {[
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
        {live && bal && fee != null && bal.eth < fee + (token === "ETH" ? tokens : 0) && (
          <p className="mt-3 font-sans text-xs text-amber">You need a little more ETH on Robinhood Chain for the network fee.</p>
        )}
        <button
          type="button"
          onClick={() => void send()}
          disabled={stage === "sending"}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-medium text-on-accent transition hover:bg-accent-deep disabled:opacity-70"
        >
          {stage === "sending" ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
          {stage === "sending" ? (hash ? "Confirming" : "Sending") : "Confirm and send"}
        </button>
        {!live && <p className="mt-3 text-center font-sans text-xs text-white/40">Demo mode: nothing is sent.</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </>
    );
  }

  return (
    <>
      {title}

      {/* Amount card */}
      <div className="mt-5 rounded-[22px] border border-white/10">
        <div className="px-5 pb-6 pt-5">
          <p className="font-sans text-[15px] text-white/80">You&apos;re sending</p>
          <label className="mt-6 flex items-center justify-center">
            {inUsd && <span className={`text-[3.4rem] font-medium leading-none tracking-[-0.04em] ${n ? "text-white" : "text-white/35"}`}>$</span>}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
              inputMode="decimal"
              placeholder="0"
              aria-label={inUsd ? "Amount in dollars" : `Amount in ${token}`}
              style={{ width: `${Math.max(1, input.length || 1) + 0.3}ch` }}
              className="tabular min-w-0 max-w-[80%] bg-transparent text-center text-[3.4rem] font-medium leading-none tracking-[-0.04em] text-white outline-none placeholder:text-white/35"
            />
            {!inUsd && <span className="ml-2 text-xl font-medium text-white/50">{token}</span>}
          </label>
          <button
            type="button"
            onClick={() => {
              // Keep the same value when flipping between dollars and tokens.
              setInput(n ? (inUsd ? tokenStr : (n * price).toFixed(2)) : "");
              setInUsd((v) => !v);
            }}
            className="tabular mx-auto mt-4 flex items-center gap-1.5 font-sans text-[15px] text-white/60 hover:text-white"
          >
            {inUsd ? `${tokenStr} ${token}` : `$${money(usd)}`} <ArrowDownUp className="size-4" />
          </button>
        </div>

        {/* Token picker */}
        <div className="relative border-t border-white/10">
          <button type="button" onClick={() => setPicker((p) => !p)} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.03]">
            <TokenIcon logo={token === "USDG" ? USDG_LOGO : ETH_LOGO} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-medium">{token}</span>
              <span className="tabular block font-sans text-[13px] text-white/50">
                Balance: {balance.toLocaleString("en-US", { maximumFractionDigits: token === "USDG" ? 2 : 6 })} (${money(balance * price)})
              </span>
            </span>
            <ChevronDown className={`size-5 text-white/60 transition ${picker ? "rotate-180" : ""}`} />
          </button>
          {picker && (
            <ul className="absolute inset-x-3 top-full z-10 mt-1 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1b1e] shadow-[0_18px_40px_rgba(0,0,0,0.5)]">
              {(["USDG", "ETH"] as Token[]).map((t) => {
                const b = t === "USDG" ? bal?.usdg ?? 0 : bal?.eth ?? 0;
                return (
                  <li key={t}>
                    <button
                      type="button"
                      onClick={() => {
                        setToken(t);
                        setPicker(false);
                        setInput("");
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.05] ${t === token ? "bg-white/[0.04]" : ""}`}
                    >
                      <TokenIcon logo={t === "USDG" ? USDG_LOGO : ETH_LOGO} size={32} />
                      <span className="flex-1 text-[15px] font-medium">{t}</span>
                      <span className="tabular font-sans text-sm text-white/55">{b.toLocaleString("en-US", { maximumFractionDigits: t === "USDG" ? 2 : 6 })}</span>
                      {t === token && <Check className="size-4 text-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Recipient */}
      <label className="mt-3 block rounded-[22px] bg-white/[0.06] px-5 py-4">
        <span className="block font-sans text-[15px] text-white/80">To</span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder="Wallet address on Robinhood Chain"
          spellCheck={false}
          autoComplete="off"
          className="mt-1 w-full bg-transparent font-mono text-[14px] text-white outline-none placeholder:font-sans placeholder:text-[16px] placeholder:text-white/35"
        />
      </label>
      {to && !isAddress(to) && <p className="mt-2 px-1 font-sans text-xs text-neg">That isn&apos;t a valid address.</p>}
      {isAddress(to) && !toOk && <p className="mt-2 px-1 font-sans text-xs text-neg">That&apos;s your own address.</p>}
      {tooMuch && <p className="mt-2 px-1 font-sans text-xs text-neg">That&apos;s more {token} than you have.</p>}

      <button
        type="button"
        onClick={() => void review()}
        disabled={!amountOk || !toOk}
        className="mt-3 flex h-14 w-full items-center justify-center rounded-[22px] bg-accent text-[17px] font-medium text-on-accent transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/45"
      >
        {!n ? "Enter an amount" : !to ? "Enter an address" : "Review"}
      </button>
      {error && <ErrorNote>{error}</ErrorNote>}
    </>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-4 rounded-2xl border border-neg/30 bg-neg/[0.08] px-4 py-3 font-sans text-sm leading-relaxed text-white/85">
      {children}
    </p>
  );
}
