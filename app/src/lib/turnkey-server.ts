import "server-only";
import { Turnkey } from "@turnkey/sdk-server";

/**
 * Pecun's own Turnkey access, server side only. It acts in Pecun's parent organization (the gas tank and the fee
 * treasury). It has NO access to users' wallets: each user's wallet lives in their own sub-organization, where only
 * their sign-in can approve anything.
 *
 * Needs (never NEXT_PUBLIC): TURNKEY_API_PUBLIC_KEY and TURNKEY_API_PRIVATE_KEY, plus NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID.
 */

export const TURNKEY_API_BASE = "https://api.turnkey.com";
export const PARENT_ORG = process.env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID ?? "";
const API_PUBLIC = process.env.TURNKEY_API_PUBLIC_KEY ?? "";
const API_PRIVATE = process.env.TURNKEY_API_PRIVATE_KEY ?? "";

export const turnkeyServerConfigured = Boolean(PARENT_ORG && API_PUBLIC && API_PRIVATE);

let client: ReturnType<Turnkey["apiClient"]> | null = null;
export function turnkey() {
  client ??= new Turnkey({ apiBaseUrl: TURNKEY_API_BASE, apiPublicKey: API_PUBLIC, apiPrivateKey: API_PRIVATE, defaultOrganizationId: PARENT_ORG }).apiClient();
  return client;
}

export class AuthError extends Error {}

export type SignedRequest = { url: string; body: string; stamp: { stampHeaderName: string; stampHeaderValue: string } };

/**
 * Takes a "list my wallet accounts" request signed with the user's own Turnkey session, sends it to Turnkey, and returns
 * the user's account and the addresses Turnkey says they own. A forged or expired session is rejected by Turnkey.
 */
export async function verifyUserAccounts(signed: SignedRequest): Promise<{ organizationId: string; addresses: string[] }> {
  if (!signed?.url?.startsWith(`${TURNKEY_API_BASE}/`) || !signed.url.endsWith("/public/v1/query/list_wallet_accounts")) {
    throw new AuthError("Bad request.");
  }
  const res = await fetch(signed.url, {
    method: "POST",
    headers: { "content-type": "application/json", [signed.stamp.stampHeaderName]: signed.stamp.stampHeaderValue },
    body: signed.body,
    cache: "no-store",
  });
  if (!res.ok) throw new AuthError(`Turnkey didn't accept your session (${res.status}). Sign out and in again.`);
  const { accounts } = (await res.json()) as { accounts?: { organizationId: string; address: string }[] };
  const organizationId = accounts?.[0]?.organizationId;
  if (!organizationId || organizationId === PARENT_ORG) throw new AuthError("This isn't a Pecun user account.");
  return { organizationId, addresses: accounts!.map((a) => a.address.toLowerCase()) };
}
