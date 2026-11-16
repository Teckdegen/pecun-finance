/**
 * Sign-in actions behind the Pecun sign-in modal: email one-time code and passkey, both run by Turnkey.
 *
 * Turnkey's React kit (`@turnkey/react-wallet-kit`) supplies these through `useTurnkey()`:
 *   - sendEmailCode → initOtp({ otpType: OtpType.Email, contact: email })
 *   - verifyEmailCode → completeOtp({ otpId, otpCode, contact, otpType })   (logs in, or signs up on first use)
 *   - passkey → loginWithPasskey(), falling back to signUpWithPasskey() for a new user
 * It needs NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID and NEXT_PUBLIC_TURNKEY_AUTH_PROXY_ID from the Turnkey dashboard.
 *
 * Until those are set, the app runs in demo mode: no email is sent, any 6-digit code is accepted, and resend and
 * change-email behave as they will live, so the whole flow can be tried. Nobody is really signed in.
 */

export const authConfigured = Boolean(process.env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID && process.env.NEXT_PUBLIC_TURNKEY_AUTH_PROXY_ID);
export const demoMode = !authConfigured;

/** How long before "Send a new code" can be used again, as Turnkey rate-limits OTP emails. */
export const RESEND_SECONDS = 30;

export type AuthResult = { ok: true; otpId?: string } | { ok: false; error: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends a 6-digit code to the email. Returns the id Turnkey needs to verify it. */
export async function sendEmailCode(email: string): Promise<AuthResult> {
  if (demoMode) {
    await wait(700);
    return { ok: true, otpId: `demo-${email}` };
  }
  return { ok: false, error: "Couldn't send a code. Try again in a moment." };
}

/** Checks the code. On success the user is signed in (a new user gets their wallet created). */
export async function verifyEmailCode(email: string, otpId: string, code: string): Promise<AuthResult> {
  if (demoMode) {
    await wait(800);
    void email;
    void otpId;
    // Demo: any 6 digits work, except 000000, which shows what a wrong code looks like.
    return code === "000000" ? { ok: false, error: "That code isn't right. Check the email and try again." } : { ok: true };
  }
  return { ok: false, error: "Couldn't verify the code. Try again in a moment." };
}

/** Signs in with a passkey saved on this device (Face ID, fingerprint, Windows Hello, or a security key). */
export async function signInWithPasskey(): Promise<AuthResult> {
  if (demoMode) {
    await wait(900);
    return { ok: true };
  }
  return { ok: false, error: "Couldn't use a passkey on this device. Try email instead." };
}
