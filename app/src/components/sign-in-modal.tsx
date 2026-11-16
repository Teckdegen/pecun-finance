"use client";

import { ArrowLeft, Check, KeyRound, Loader2, RotateCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { RESEND_SECONDS } from "@/lib/auth";
import { useAuth } from "./auth-provider";
import { DOCS_URL } from "@/lib/site";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_LENGTH = 6;

type Step = "start" | "code" | "setup" | "done";

/**
 * Sign in or sign up in one step: email (a 6-digit code) or a passkey. No seed phrase; Turnkey holds the wallet keys
 * in its secure enclaves and only the user can approve a transaction. In demo mode (Turnkey not connected yet) the
 * whole flow runs without sending anything.
 */
export function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { live, sendEmailCode, verifyEmailCode, signInWithPasskey, createPasskey, setupWallets } = useAuth();
  const [isNew, setIsNew] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [otpId, setOtpId] = useState("");
  const [busy, setBusy] = useState<"email" | "passkey" | "newPasskey" | "code" | "resend" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [via, setVia] = useState<"email" | "passkey">("email");
  const dialog = useRef<HTMLDivElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  // Reset on open; lock page scroll; Escape closes; keep focus inside; focus the email field.
  useEffect(() => {
    if (!open) return;
    setStep("start");
    setError("");
    setNotice("");
    setBusy(null);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialog.current) {
        const f = dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, a[href]");
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    setTimeout(() => emailInput.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // After signing in, show the confirmation briefly, then close.
  useEffect(() => {
    if (step !== "done") return;
    const t = setTimeout(onClose, 1600);
    return () => clearTimeout(t);
  }, [step, onClose]);

  if (!open) return null;

  const validEmail = EMAIL.test(email.trim());

  const sendCode = async (resend = false) => {
    setBusy(resend ? "resend" : "email");
    setError("");
    setNotice("");
    const r = await sendEmailCode(email.trim());
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setOtpId(r.otpId ?? "");
    setResendIn(RESEND_SECONDS);
    if (resend) setNotice(`We sent a new code to ${email.trim()}.`);
    setStep("code");
  };

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    if (validEmail && !busy) void sendCode();
  };

  /** After sign-in: create (or confirm) the user's Solana and Sui server wallets; success only once both exist. */
  const runSetup = async () => {
    setStep("setup");
    setSetupError("");
    const r = await setupWallets();
    if (!r.ok) return setSetupError(r.error);
    setStep("done");
  };

  const onPasskey = async (create = false) => {
    if (busy) return;
    setBusy(create ? "newPasskey" : "passkey");
    setError("");
    const r = await (create ? createPasskey() : signInWithPasskey());
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setVia("passkey");
    setIsNew(!!r.isNew);
    void runSetup();
  };

  /** Returns true when the code was accepted, so the boxes know whether to clear. */
  const onCode = async (code: string) => {
    setBusy("code");
    setError("");
    setNotice("");
    const r = await verifyEmailCode(email.trim(), otpId, code);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setVia("email");
    setIsNew(!!r.isNew);
    void runSetup();
    return true;
  };

  const changeEmail = () => {
    setStep("start");
    setError("");
    setNotice("");
    setTimeout(() => emailInput.current?.select(), 30);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        className="relative w-full max-w-[440px] rounded-t-[28px] border border-white/10 bg-[#121315] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-7 shadow-[0_30px_90px_rgba(0,0,0,0.7)] sm:rounded-[28px] sm:px-8 sm:pb-7"
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-5 top-5 grid size-9 place-items-center rounded-full text-white/60 hover:bg-white/5 hover:text-white">
          <X className="size-5" />
        </button>

        {/* The landing page logo, in its dark-background colours. */}
        <span className="flex items-center gap-2">
          <svg aria-hidden width={34} height={34} viewBox="12 12 40 40" className="shrink-0">
            <path d="M14 50C14 28 28 14 50 14Z" fill="#ffffff" />
            <path d="M50 14C50 36 36 50 14 50Z" fill="#b8ff9d" />
          </svg>
          <span className="text-xl font-medium tracking-[-0.03em]">Pecun</span>
        </span>

        {step === "start" && (
          <>
            <h2 id="signin-title" className="mt-6 text-[1.6rem] font-medium leading-tight tracking-[-0.03em]">Sign in to Pecun</h2>
            <p className="mt-1.5 font-sans text-[15px] text-white/55">Email or passkey. No seed phrase.</p>

            <form onSubmit={onEmail} className="mt-6">
              <label htmlFor="signin-email" className="sr-only">Email</label>
              <input
                ref={emailInput}
                id="signin-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 w-full rounded-2xl border border-white/15 bg-transparent px-4 font-sans text-[16px] text-white outline-none transition placeholder:text-white/30 focus:border-white/40 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)]"
              />
              <button
                type="submit"
                disabled={!validEmail || !!busy}
                className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#f3f4f6] text-[16px] font-medium text-[#0a0b0d] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "email" && <Loader2 className="size-4 animate-spin" />}
                Continue
              </button>
            </form>

            <div className="my-5 flex items-center gap-4 font-sans text-sm text-white/40">
              <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              onClick={() => onPasskey()}
              disabled={!!busy}
              className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full border border-white/15 text-[16px] font-medium text-white transition hover:border-white/30 hover:bg-white/[0.03] disabled:opacity-60"
            >
              {busy === "passkey" ? <Loader2 className="size-[18px] animate-spin" /> : <KeyRound className="size-[18px]" />}
              Continue with a passkey
            </button>
            <button
              type="button"
              onClick={() => onPasskey(true)}
              disabled={!!busy}
              className="mt-3 flex w-full items-center justify-center gap-1.5 font-sans text-sm text-white/55 hover:text-white disabled:opacity-60"
            >
              {busy === "newPasskey" && <Loader2 className="size-3.5 animate-spin" />}
              New to Pecun? Create a passkey
            </button>
          </>
        )}

        {step === "code" && (
          <CodeStep
            email={email.trim()}
            busy={busy === "code"}
            resending={busy === "resend"}
            resendIn={resendIn}
            onSubmit={onCode}
            onChangeEmail={changeEmail}
            onResend={() => sendCode(true)}
          />
        )}

        {step === "setup" && (
          <div className="pt-6" role="status" aria-live="polite">
            <h2 id="signin-title" className="text-[1.6rem] font-medium leading-tight tracking-[-0.03em]">
              {setupError ? "Wallet setup didn't finish" : isNew ? "Creating your wallets" : "Signing you in"}
            </h2>
            <p className="mt-1.5 font-sans text-[15px] text-white/55">
              {setupError
                ? "You're signed in, but your wallets aren't ready yet."
                : isNew
                  ? "Setting up your Pecun wallet and the Solana and Sui wallets behind it."
                  : "Checking your Solana and Sui wallets are in place."}
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                { label: "Pecun wallet", sub: "EVM · yours to control", done: true },
                { label: "Solana wallet", sub: "Pecun-held, for routing", done: false },
                { label: "Sui wallet", sub: "Pecun-held, for routing", done: false },
              ].map((w) => (
                <li key={w.label} className="flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{w.label}</span>
                    <span className="block font-sans text-xs text-white/45">{w.sub}</span>
                  </span>
                  {w.done ? (
                    <span className="grid size-6 place-items-center rounded-full bg-accent text-on-accent"><Check className="size-4" strokeWidth={3} /></span>
                  ) : setupError ? (
                    <span className="grid size-6 place-items-center rounded-full bg-neg/20 text-neg"><X className="size-4" strokeWidth={3} /></span>
                  ) : (
                    <Loader2 className="size-5 animate-spin text-white/60" />
                  )}
                </li>
              ))}
            </ul>
            {setupError && (
              <>
                <p role="alert" className="mt-4 rounded-2xl border border-neg/30 bg-neg/[0.08] px-4 py-3 font-sans text-sm leading-relaxed text-white/85">
                  {setupError}
                </p>
                <button
                  type="button"
                  onClick={() => void runSetup()}
                  className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#f3f4f6] text-[16px] font-medium text-[#0a0b0d] transition hover:bg-white"
                >
                  <RotateCw className="size-4" /> Try again
                </button>
              </>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="py-6 text-center" role="status">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-on-accent">
              <Check className="size-7" strokeWidth={2.5} />
            </span>
            <h2 id="signin-title" className="mt-5 text-[1.6rem] font-medium leading-tight tracking-[-0.03em]">
              {isNew ? "Your wallets are ready" : "You're in"}
            </h2>
            <p className="mt-1.5 font-sans text-[15px] text-white/55">
              {via === "passkey" ? "Signed in with your passkey." : `Signed in as ${email.trim()}.`}
            </p>
            <p className="mt-1 font-sans text-xs text-white/40">Solana and Sui wallets confirmed.</p>
          </div>
        )}

        {notice && !error && (
          <p role="status" className="mt-4 flex items-center gap-2 rounded-2xl border border-accent/20 bg-accent/[0.06] px-4 py-3 font-sans text-sm text-white/80">
            <Check className="size-4 shrink-0 text-accent" /> {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-2xl border border-neg/30 bg-neg/[0.08] px-4 py-3 font-sans text-sm leading-relaxed text-white/85">
            {error}
          </p>
        )}
        {!live && step !== "done" && step !== "setup" && (
          <p className="mt-4 text-center font-sans text-xs text-white/40">
            Demo mode: no email is sent. Any 6-digit code works ({"000000"} shows a wrong code).
          </p>
        )}

        <p className="mt-6 flex items-center justify-center gap-2.5 font-sans text-[13px] text-white/45">
          <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Secured by Turnkey</span>
          <span aria-hidden>·</span>
          <a href={`${DOCS_URL}/terms`} className="hover:text-white">Terms</a>
          <span aria-hidden>·</span>
          <a href={`${DOCS_URL}/privacy`} className="hover:text-white">Privacy</a>
        </p>
      </div>
    </div>
  );
}

/** Six boxes for the emailed code. Typing moves forward, Backspace moves back, pasting fills them all. */
function CodeStep({ email, busy, resending, resendIn, onSubmit, onChangeEmail, onResend }: {
  email: string;
  busy: boolean;
  resending: boolean;
  resendIn: number;
  onSubmit: (code: string) => Promise<boolean>;
  onChangeEmail: () => void;
  onResend: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => boxes.current[0]?.focus(), []);

  const submit = async (code: string) => {
    const ok = await onSubmit(code);
    if (!ok) {
      // Wrong code: clear the boxes and start again from the first.
      setDigits(Array(CODE_LENGTH).fill(""));
      setTimeout(() => boxes.current[0]?.focus(), 20);
    }
  };

  const set = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      // Pasted or autofilled a whole code.
      const next = clean.slice(0, CODE_LENGTH).split("");
      setDigits([...next, ...Array(CODE_LENGTH - next.length).fill("")]);
      boxes.current[Math.min(next.length, CODE_LENGTH - 1)]?.focus();
      if (next.length === CODE_LENGTH) void submit(next.join(""));
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < CODE_LENGTH - 1) boxes.current[i + 1]?.focus();
    if (next.every(Boolean)) void submit(next.join(""));
  };

  const code = digits.join("");
  return (
    <>
      <h2 id="signin-title" className="mt-6 text-[1.6rem] font-medium leading-tight tracking-[-0.03em]">Check your email</h2>
      <p className="mt-1.5 font-sans text-[15px] leading-relaxed text-white/55">
        Enter the 6-digit code we sent to <span className="text-white">{email}</span>.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === CODE_LENGTH && !busy) void submit(code);
        }}
      >
        <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              value={d}
              disabled={busy}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !d && i > 0) boxes.current[i - 1]?.focus();
              }}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1}`}
              className="tabular h-14 w-full min-w-0 rounded-2xl border border-white/15 bg-transparent text-center text-[1.4rem] font-medium text-white outline-none transition focus:border-white/40 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] disabled:opacity-60"
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={code.length < CODE_LENGTH || busy}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#f3f4f6] text-[16px] font-medium text-[#0a0b0d] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Checking" : "Verify and continue"}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between gap-3 font-sans text-sm">
        <button type="button" onClick={onChangeEmail} className="inline-flex items-center gap-1.5 text-white/55 hover:text-white">
          <ArrowLeft className="size-4" /> Change email
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={resendIn > 0 || resending}
          className="inline-flex items-center gap-1.5 text-white/55 hover:text-white disabled:cursor-not-allowed disabled:text-white/30 disabled:hover:text-white/30"
        >
          {resending && <Loader2 className="size-3.5 animate-spin" />}
          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
        </button>
      </div>
    </>
  );
}
