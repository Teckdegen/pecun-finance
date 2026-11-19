import { NextResponse } from "next/server";
import { kv, kvConfigured } from "@/lib/kv";
import { AuthError, verifyUserAccounts, type SignedRequest } from "@/lib/turnkey-server";

/**
 * A wallet's Pecun activity, indexed in Upstash so it follows the user to any device.
 *
 * POST { signed, address, item? }:
 *   `signed` is a list-wallet-accounts request stamped with the user's own Turnkey session; Turnkey confirms which
 *   addresses they own, so only the owner can read or add to an address's history.
 *   With `item`, records it (a deposit or withdrawal). Always returns the history (newest first) and the vault ids used.
 */

export const dynamic = "force-dynamic";

const MAX_ITEMS = 500;
const MAX_ITEM_BYTES = 4_000;

export async function POST(req: Request) {
  if (!kvConfigured()) return NextResponse.json({ items: [], vaults: [], indexed: false });
  let body: { signed: SignedRequest; address: string; item?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const address = String(body.address ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return NextResponse.json({ error: "Bad address." }, { status: 400 });
  try {
    const user = await verifyUserAccounts(body.signed);
    if (!user.addresses.includes(address)) return NextResponse.json({ error: "That address isn't yours." }, { status: 403 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.message : "Couldn't confirm your sign-in." }, { status: 401 });
  }

  const listKey = `pecun:activity:${address}`;
  const vaultsKey = `pecun:vaults:${address}`;
  try {
    if (body.item !== undefined) {
      const json = JSON.stringify(body.item);
      const vaultId = (body.item as { vault?: { id?: unknown } })?.vault?.id;
      if (json.length > MAX_ITEM_BYTES || typeof vaultId !== "string") return NextResponse.json({ error: "Bad item." }, { status: 400 });
      await kv([
        ["LPUSH", listKey, json],
        ["LTRIM", listKey, 0, MAX_ITEMS - 1],
        ["SADD", vaultsKey, vaultId],
      ]);
    }
    const [list, vaults] = await kv([
      ["LRANGE", listKey, 0, MAX_ITEMS - 1],
      ["SMEMBERS", vaultsKey],
    ]);
    const items = ((list as string[] | null) ?? []).flatMap((s) => {
      try {
        return [JSON.parse(s)];
      } catch {
        return [];
      }
    });
    return NextResponse.json({ items, vaults: (vaults as string[] | null) ?? [], indexed: true });
  } catch (e) {
    console.error("[activity]", (e as Error).message);
    return NextResponse.json({ error: "Couldn't reach the activity index." }, { status: 502 });
  }
}
