/**
 * Shared sign-in settings. The actions themselves live in `components/auth-provider.tsx`, which talks to Turnkey
 * when it's configured and runs a demo flow when it isn't.
 *
 * Turnkey needs two public values from its dashboard (both safe in the browser):
 *   NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID   your Turnkey organization ID
 *   NEXT_PUBLIC_TURNKEY_AUTH_PROXY_ID     Auth Proxy → Config ID
 * Dashboard settings this flow expects: Auth Proxy on, Email OTP on with length 6 and type Numeric,
 * Passkey on, OAuth and Wallet off, and Allowed origins set to the app's address.
 */

export const TURNKEY_ORGANIZATION_ID = process.env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID ?? "";
export const TURNKEY_AUTH_PROXY_ID = process.env.NEXT_PUBLIC_TURNKEY_AUTH_PROXY_ID ?? "";

export const authConfigured = Boolean(TURNKEY_ORGANIZATION_ID && TURNKEY_AUTH_PROXY_ID);
export const demoMode = !authConfigured;

/** How long before "Resend code" can be used again, as Turnkey rate-limits OTP emails. */
export const RESEND_SECONDS = 30;

export type AuthResult = { ok: true; otpId?: string; /** true for a brand-new account */ isNew?: boolean } | { ok: false; error: string };

export type WalletSetup = { ok: true; created: boolean } | { ok: false; error: string };

/**
 * Every account's wallet lives in the user's own Turnkey sub-organization: Turnkey holds the keys, and only the
 * user's sign-in (email code or passkey session) can move funds. Pecun's server key has no access to it.
 * The EVM address is the one users see (Base and every EVM chain); Solana and Sui stay hidden and are
 * used behind the scenes for deposits on those chains.
 */
export const EVM_ACCOUNT = { curve: "CURVE_SECP256K1" as const, pathFormat: "PATH_FORMAT_BIP32" as const, path: "m/44'/60'/0'/0/0", addressFormat: "ADDRESS_FORMAT_ETHEREUM" as const };
export const SOLANA_ACCOUNT = { curve: "CURVE_ED25519" as const, pathFormat: "PATH_FORMAT_BIP32" as const, path: "m/44'/501'/0'/0'", addressFormat: "ADDRESS_FORMAT_SOLANA" as const };
export const SUI_ACCOUNT = { curve: "CURVE_ED25519" as const, pathFormat: "PATH_FORMAT_BIP32" as const, path: "m/44'/784'/0'/0'/0'", addressFormat: "ADDRESS_FORMAT_SUI" as const };

export const PECUN_WALLET = {
  walletName: "Pecun Wallet",
  walletAccounts: [EVM_ACCOUNT, SOLANA_ACCOUNT, SUI_ACCOUNT],
};

/** Turns an SDK error into one plain sentence for the modal. */
export function friendlyError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/NotAllowedError|cancel|aborted|timed out/i.test(msg)) return "The passkey request was cancelled or timed out. Try again.";
  if (/invalid.*(otp|code)|otp.*(invalid|incorrect)|incorrect/i.test(msg)) return "That code isn't right. Check the email and try again.";
  if (/expired/i.test(msg)) return "That code has expired. Send a new one.";
  if (/rate|too many/i.test(msg)) return "Too many tries. Wait a minute, then try again.";
  if (/origin/i.test(msg)) return "This site isn't allowed to sign in yet. Add it to Allowed origins in the Turnkey dashboard.";
  return fallback;
}
