"use client";

import { AuthState, OtpType, TurnkeyProvider, useTurnkey, type TurnkeyProviderConfig } from "@turnkey/react-wallet-kit";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { authConfigured, friendlyError, PECUN_WALLET, TURNKEY_AUTH_PROXY_ID, TURNKEY_ORGANIZATION_ID, type AuthResult } from "@/lib/auth";

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
  const { authState, user, initOtp, completeOtp, loginWithPasskey, signUpWithPasskey, logout } = useTurnkey();
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
          await completeOtp({
            otpId,
            otpCode: code,
            otpEncryptionTargetBundle: bundle,
            contact: email,
            otpType: OtpType.Email,
            createSubOrgParams: { userEmail: email, customWallet: PECUN_WALLET },
          });
          bundles.current.delete(otpId);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: friendlyError(e, "That code isn't right. Check the email and try again.") };
        }
      },
      signInWithPasskey: async () => {
        try {
          await loginWithPasskey();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: friendlyError(e, "No Pecun passkey was found on this device. Create one, or use email.") };
        }
      },
      createPasskey: async () => {
        try {
          await signUpWithPasskey({ passkeyDisplayName: "Pecun", createSubOrgParams: { userName: "Pecun user", customWallet: PECUN_WALLET } });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: friendlyError(e, "Couldn't create a passkey on this device. Try email instead.") };
        }
      },
      signOut: async () => {
        await logout();
      },
    }),
    [authState, user, initOtp, completeOtp, loginWithPasskey, signUpWithPasskey, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** No email is sent: any 6-digit code signs in (000000 shows a wrong code). Nobody is really signed in. */
function DemoAuth({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | undefined>();
  const signOut = useCallback(async () => setAccount(undefined), []);
  const value = useMemo<AuthActions>(
    () => ({
      live: false,
      signedIn: !!account,
      account,
      sendEmailCode: async (email) => (await wait(700), { ok: true, otpId: `demo-${email}` }),
      verifyEmailCode: async (email, _otpId, code) => {
        await wait(800);
        if (code === "000000") return { ok: false, error: "That code isn't right. Check the email and try again." };
        setAccount(email);
        return { ok: true };
      },
      signInWithPasskey: async () => (await wait(900), setAccount("Passkey (demo)"), { ok: true }),
      createPasskey: async () => (await wait(900), setAccount("Passkey (demo)"), { ok: true }),
      signOut,
    }),
    [account, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
