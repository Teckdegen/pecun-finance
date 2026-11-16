"use client";

import { AuthState, OtpType, TurnkeyProvider, useTurnkey, type TurnkeyProviderConfig } from "@turnkey/react-wallet-kit";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { authConfigured, friendlyError, PECUN_WALLET, TURNKEY_AUTH_PROXY_ID, TURNKEY_ORGANIZATION_ID, type AuthResult, type WalletSetup } from "@/lib/auth";

/** What the sign-in modal and the header need, whether Turnkey is live or the demo is running. */
export type AuthActions = {
  live: boolean;
  signedIn: boolean;
  /** Email or name to show for the signed-in user. */
  account?: string;
  sendEmailCode: (email: string) => Promise<AuthResult>;
  verifyEmailCode: (email: string, otpId: string, code: string) => Promise<AuthResult>;
  signInWithPasskey: () => Promise<AuthResult>;
  createPasskey: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** The user's EVM address (Robinhood Chain and every EVM chain). Solana and Sui addresses stay behind the scenes. */
  evmAddress?: `0x${string}`;
  /** Signs an unsigned EVM transaction (hex, no 0x) with the user's wallet and broadcasts it. Returns the tx hash. */
  sendEvmTransaction: (unsigned: string, rpcUrl: string) => Promise<{ ok: true; hash: `0x${string}` } | { ok: false; error: string }>;
  /** Solana and Sui addresses Pecun holds for this user as server wallets. Used for routing, never shown. */
  routing?: { solana: string; sui: string };
  /** Creates the user's Solana and Sui server wallets if they don't exist yet; ok only once both are confirmed. */
  setupWallets: () => Promise<WalletSetup>;
  /** True once the user has all three: their EVM wallet and their Solana and Sui server wallets. */
  accountReady: boolean;
  /** Creates whatever is missing (EVM wallet in the user's account, then the server wallets); ok only when all exist. */
  ensureAccount: () => Promise<WalletSetup>;
};

const Ctx = createContext<AuthActions | null>(null);

export function useAuth(): AuthActions {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

const config: TurnkeyProviderConfig = {
  organizationId: TURNKEY_ORGANIZATION_ID,
  authProxyConfigId: TURNKEY_AUTH_PROXY_ID,
  auth: {
    autoRefreshSession: true,
    createSuborgParams: {
      emailOtpAuth: { customWallet: PECUN_WALLET },
      passkeyAuth: { userName: "Pecun user", passkeyName: "Pecun", customWallet: PECUN_WALLET },
    },
  },
  ui: { darkMode: true },
};

/** Live Turnkey when the two IDs are set; the demo flow otherwise. */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!authConfigured) return <DemoAuth>{children}</DemoAuth>;
  return (
    <TurnkeyProvider config={config}>
      <LiveAuth>{children}</LiveAuth>
    </TurnkeyProvider>
  );
}

function LiveAuth({ children }: { children: ReactNode }) {
  const { authState, user, wallets, session, httpClient, initOtp, completeOtp, loginWithPasskey, signUpWithPasskey, logout, signAndSendTransaction, createWallet, refreshWallets } = useTurnkey();
  const [routing, setRouting] = useState<{ solana: string; sui: string } | undefined>();

  // Once signed in, make sure the user's server wallets (Solana, Sui) exist. The request is signed with the user's
  // own session so the server can confirm with Turnkey who is asking. Safe to repeat: it returns existing addresses.
  // The session appears a moment after sign-in completes, so setup reads the latest values through a ref.
  const latest = useRef({ session, httpClient });
  latest.current = { session, httpClient };

  const setupWallets = useCallback(async (): Promise<WalletSetup> => {
    // Wait (up to 15s) for the new session to be stored.
    for (let i = 0; i < 30 && !(latest.current.session?.organizationId && latest.current.httpClient); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    const { session: s, httpClient: hc } = latest.current;
    if (!s?.organizationId || !hc) return { ok: false, error: "Your session didn't start. Sign out and sign in again." };
    try {
      const signed = await hc.stampGetWhoami({ organizationId: s.organizationId });
      if (!signed) return { ok: false, error: "Couldn't sign the wallet request with your session." };
      const res = await fetch("/api/wallets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signed }) });
      const body = (await res.json().catch(() => ({}))) as { solana?: string; sui?: string; created?: boolean; error?: string };
      if (!res.ok) return { ok: false, error: body.error || `Wallet setup failed (${res.status}).` };
      if (!body.solana || !body.sui) return { ok: false, error: "Wallet setup didn't return both Solana and Sui addresses." };
      setRouting({ solana: body.solana, sui: body.sui });
      return { ok: true, created: !!body.created };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Wallet setup failed." };
    }
  }, []);

  // A returning visitor whose session survived a reload never sees the sign-in modal, so check their wallets here too.
  const orgId = authState === AuthState.Authenticated ? session?.organizationId : undefined;
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!orgId || routing || checked.current === orgId) return;
    checked.current = orgId;
    void setupWallets();
  }, [orgId, routing, setupWallets]);
  const evmAccount = useMemo(
    () => wallets?.flatMap((w) => w.accounts ?? []).find((a) => a.addressFormat === "ADDRESS_FORMAT_ETHEREUM"),
    [wallets],
  );
  const ensureAccount = useCallback(async (): Promise<WalletSetup> => {
    let created = false;
    if (!evmAccount) {
      // The user's own EVM wallet is missing: create it in their Turnkey account.
      try {
        await createWallet({ walletName: PECUN_WALLET.walletName, accounts: PECUN_WALLET.walletAccounts });
        const fresh = await refreshWallets();
        if (!fresh?.some((w) => w.accounts?.some((a) => a.addressFormat === "ADDRESS_FORMAT_ETHEREUM"))) {
          return { ok: false, error: "Your EVM wallet was created but didn't show up yet. Try again." };
        }
        created = true;
      } catch (e) {
        return { ok: false, error: `Couldn't create your EVM wallet: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    if (!routing?.solana || !routing?.sui) {
      const r = await setupWallets();
      if (!r.ok) return r;
      created ||= r.created;
    }
    return { ok: true, created };
  }, [evmAccount, routing, createWallet, refreshWallets, setupWallets]);

  // initOtp returns an encryption bundle that completeOtp needs; keep it per code request.
  const bundles = useRef(new Map<string, string>());

  const value = useMemo<AuthActions>(
    () => ({
      live: true,
      signedIn: authState === AuthState.Authenticated,
      account: user?.userEmail || user?.userName || undefined,
      sendEmailCode: async (email) => {
        try {
          const { otpId, otpEncryptionTargetBundle } = await initOtp({ otpType: OtpType.Email, contact: email });
          bundles.current.set(otpId, otpEncryptionTargetBundle);
          return { ok: true, otpId };
        } catch (e) {
          return { ok: false, error: friendlyError(e, "Couldn't send a code. Try again in a moment.") };
        }
      },
      verifyEmailCode: async (email, otpId, code) => {
        const bundle = bundles.current.get(otpId);
        if (!bundle) return { ok: false, error: "That code request has expired. Send a new code." };
        try {
          // Logs in, or creates the account and its wallet on first sign-in.
          const r = await completeOtp({
            otpId,
            otpCode: code,
            otpEncryptionTargetBundle: bundle,
            contact: email,
            otpType: OtpType.Email,
            createSubOrgParams: { userEmail: email, customWallet: PECUN_WALLET },
          });
          bundles.current.delete(otpId);
          return { ok: true, isNew: String(r?.action) === "SIGNUP" };
        } catch (e) {
          return { ok: false, error: friendlyError(e, "That code isn't right. Check the email and try again.") };
        }
      },
      signInWithPasskey: async () => {
        try {
          await loginWithPasskey();
          return { ok: true, isNew: false };
        } catch (e) {
          return { ok: false, error: friendlyError(e, "No Pecun passkey was found on this device. Create one, or use email.") };
        }
      },
      createPasskey: async () => {
        try {
          await signUpWithPasskey({ passkeyDisplayName: "Pecun", createSubOrgParams: { userName: "Pecun user", customWallet: PECUN_WALLET } });
          return { ok: true, isNew: true };
        } catch (e) {
          return { ok: false, error: friendlyError(e, "Couldn't create a passkey on this device. Try email instead.") };
        }
      },
      signOut: async () => {
        await logout();
      },
      evmAddress: evmAccount?.address as `0x${string}` | undefined,
      routing,
      setupWallets,
      accountReady: !!evmAccount && !!routing?.solana && !!routing?.sui,
      ensureAccount,
      sendEvmTransaction: async (unsigned, rpcUrl) => {
        if (!evmAccount) return { ok: false, error: "Your wallet is still loading. Try again in a moment." };
        try {
          const hash = await signAndSendTransaction({ walletAccount: evmAccount, unsignedTransaction: unsigned, transactionType: "TRANSACTION_TYPE_ETHEREUM", rpcUrl });
          return { ok: true, hash: (hash.startsWith("0x") ? hash : `0x${hash}`) as `0x${string}` };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (/insufficient funds/i.test(msg)) return { ok: false, error: "Not enough ETH on Robinhood Chain to pay the network fee." };
          return { ok: false, error: friendlyError(e, "The transfer didn't go through. Nothing was sent.") };
        }
      },
    }),
    [authState, user, initOtp, completeOtp, loginWithPasskey, signUpWithPasskey, logout, evmAccount, signAndSendTransaction, routing, setupWallets, ensureAccount],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** No email is sent: any 6-digit code signs in (000000 shows a wrong code). Nobody is really signed in. */
function DemoAuth({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | undefined>();
  const signOut = useCallback(async () => (setAccount(undefined), setDemoReady(false)), []);
  // Demo: the first sign-in with an email this visit counts as a new account, later ones as returning.
  const seen = useRef(new Set<string>());
  const lastNew = useRef(false);
  const [demoReady, setDemoReady] = useState(false);
  const value = useMemo<AuthActions>(
    () => ({
      live: false,
      signedIn: !!account,
      account,
      sendEmailCode: async (email) => (await wait(700), { ok: true, otpId: `demo-${email}` }),
      verifyEmailCode: async (email, _otpId, code) => {
        await wait(800);
        if (code === "000000") return { ok: false, error: "That code isn't right. Check the email and try again." };
        const isNew = !seen.current.has(email);
        seen.current.add(email);
        lastNew.current = isNew;
        setAccount(email);
        return { ok: true, isNew };
      },
      signInWithPasskey: async () => (await wait(900), (lastNew.current = false), setAccount("Passkey (demo)"), { ok: true, isNew: false }),
      createPasskey: async () => (await wait(900), (lastNew.current = true), setAccount("Passkey (demo)"), { ok: true, isNew: true }),
      setupWallets: async () => (await wait(lastNew.current ? 2200 : 1200), setDemoReady(true), { ok: true, created: lastNew.current }),
      accountReady: !!account && demoReady,
      ensureAccount: async () => (await wait(2000), setDemoReady(true), { ok: true, created: true }),
      signOut,
      // A fixed demo address so the wallet screens can be tried; nothing is ever sent from it.
      evmAddress: account ? "0x000000000000000000000000000000000000de40" : undefined,
      // Demo: pretends to send so the success screen can be seen. Nothing is signed or broadcast.
      sendEvmTransaction: async () => (await wait(1400), { ok: true, hash: `0x${"de".repeat(32)}` as `0x${string}` }),
    }),
    [account, signOut, demoReady],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
