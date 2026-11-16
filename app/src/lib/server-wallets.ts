import "server-only";
import { createHash } from "node:crypto";
import { Turnkey } from "@turnkey/sdk-server";

/**
 * Server wallets for the chains users don't hold directly (Solana and Sui).
 *
 * Users control one EVM wallet (created in their own Turnkey sub-organization at sign-up). For every other chain,
 * Pecun keeps a routing address per user in ONE server wallet in Pecun's parent organization. Turnkey caps wallets
 * per organization but not accounts per wallet, so each user gets accounts in that one wallet, not a wallet each.
 *
 * Each user's account path comes from a hash of their sub-organization ID, so the same user always maps to the same
 * addresses and nothing has to be stored in a database. Two 31-bit hardened indexes make collisions impossible in practice.
 *
 * Needs (server only, never NEXT_PUBLIC): TURNKEY_API_PUBLIC_KEY and TURNKEY_API_PRIVATE_KEY, an API key for a user in
 * the parent organization, plus NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID (the parent organization).
 */

export const TURNKEY_API_BASE = "https://api.turnkey.com";
const ROUTING_WALLET_NAME = "Pecun Routing";

const PARENT_ORG = process.env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID ?? "";
const API_PUBLIC = process.env.TURNKEY_API_PUBLIC_KEY ?? "";
const API_PRIVATE = process.env.TURNKEY_API_PRIVATE_KEY ?? "";

export const serverWalletsConfigured = Boolean(PARENT_ORG && API_PUBLIC && API_PRIVATE);

export type RoutingAddresses = { solana: string; sui: string };

let client: ReturnType<Turnkey["apiClient"]> | null = null;
function api() {
  if (!client) {
    client = new Turnkey({ apiBaseUrl: TURNKEY_API_BASE, apiPublicKey: API_PUBLIC, apiPrivateKey: API_PRIVATE, defaultOrganizationId: PARENT_ORG }).apiClient();
  }
  return client;
}

/** Hardened derivation indexes for a user, from their sub-organization ID. */
function indexes(subOrgId: string): [number, number] {
  const h = createHash("sha256").update(`pecun-routing:${subOrgId}`).digest();
  return [h.readUInt32BE(0) & 0x7fffffff, h.readUInt32BE(4) & 0x7fffffff];
}

function accountsFor(subOrgId: string) {
  const [a, b] = indexes(subOrgId);
  return [
    { curve: "CURVE_ED25519" as const, pathFormat: "PATH_FORMAT_BIP32" as const, path: `m/44'/501'/${a}'/${b}'`, addressFormat: "ADDRESS_FORMAT_SOLANA" as const, chain: "solana" as const },
    { curve: "CURVE_ED25519" as const, pathFormat: "PATH_FORMAT_BIP32" as const, path: `m/44'/784'/${a}'/${b}'/0'`, addressFormat: "ADDRESS_FORMAT_SUI" as const, chain: "sui" as const },
  ];
}

/** The one routing wallet in the parent organization; created on first use. */
let routingWalletId: Promise<string> | null = null;
function routingWallet(): Promise<string> {
  routingWalletId ??= (async () => {
    const { wallets } = await api().getWallets({ organizationId: PARENT_ORG });
    const found = wallets.find((w) => w.walletName === ROUTING_WALLET_NAME);
    if (found) return found.walletId;
    // A wallet needs at least one account; index 0 is reserved and never given to a user.
    const r = await api().createWallet({
      walletName: ROUTING_WALLET_NAME,
      accounts: [{ curve: "CURVE_ED25519", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/501'/0'/0'", addressFormat: "ADDRESS_FORMAT_SOLANA" }],
    });
    return r.walletId;
  })().catch((e) => {
    routingWalletId = null; // retry next time
    throw e;
  });
  return routingWalletId;
}

/**
 * Checks a signed "who am I" request made with the user's own Turnkey session, so only the signed-in user can
 * set up their routing addresses. Returns their sub-organization ID if it belongs to Pecun.
 */
export async function verifyUser(signed: { url: string; body: string; stamp: { stampHeaderName: string; stampHeaderValue: string } }): Promise<string> {
  if (!signed?.url?.startsWith(`${TURNKEY_API_BASE}/`) || !signed.url.endsWith("/public/v1/query/whoami")) throw new Error("bad request");
  const res = await fetch(signed.url, {
    method: "POST",
    headers: { "content-type": "application/json", [signed.stamp.stampHeaderName]: signed.stamp.stampHeaderValue },
    body: signed.body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error("not signed in");
  const who = (await res.json()) as { organizationId?: string };
  const subOrgId = who.organizationId;
  if (!subOrgId || subOrgId === PARENT_ORG) throw new Error("not a user account");
  // Only sub-organizations of Pecun's parent organization can be read with Pecun's API key.
  await api().getWallets({ organizationId: subOrgId });
  return subOrgId;
}

/** Returns the user's Solana and Sui routing addresses, creating them the first time. */
export async function ensureRoutingAddresses(subOrgId: string): Promise<RoutingAddresses> {
  const walletId = await routingWallet();
  const wanted = accountsFor(subOrgId);
  const found = await Promise.all(
    wanted.map((w) =>
      api()
        .getWalletAccount({ organizationId: PARENT_ORG, walletId, path: w.path })
        .then((r) => r.account.address)
        .catch(() => null),
    ),
  );
  const missing = wanted.filter((_, i) => !found[i]);
  if (missing.length) {
    const r = await api().createWalletAccounts({
      walletId,
      accounts: missing.map(({ chain, ...p }) => ({ ...p, name: `${chain}:${subOrgId}` })),
    });
    missing.forEach((m, i) => (found[wanted.indexOf(m)] = r.addresses[i]));
  }
  return { solana: found[0]!, sui: found[1]! };
}
