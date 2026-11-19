import { NextResponse } from "next/server";
import { kv, kvConfigured } from "@/lib/kv";
import { AuthError, verifyUserAccounts, type SignedRequest } from "@/lib/turnkey-server";

/**
 * The encrypted backup of a wallet's private receive address (its Gloam receive key, and any private notes waiting to
 * be cashed out). Encrypted in the browser with a key made from the user's own wallet signature; this server only
 * ever stores and returns the ciphertext, and can't open it.
 *
 * POST { signed, address, blob? }: `signed` is a list-wallet-accounts request stamped with the user's Turnkey session,
 * so only the owner can read or replace their backup. With `blob`, stores it. Always returns the current blob.
 */

export const dynamic = "force-dynamic";

const MAX_BYTES = 64_000;

export async function POST(req: Request) {
  if (!kvConfigured()) return NextResponse.json({ blob: null, indexed: false });
  let body: { signed: SignedRequest; address: string; blob?: string };
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
  const key = `pecun:private:${address}`;
  try {
    if (typeof body.blob === "string") {
      if (body.blob.length > MAX_BYTES || !/^[A-Za-z0-9_\-.]+$/.test(body.blob)) return NextResponse.json({ error: "Bad backup." }, { status: 400 });
      await kv([["SET", key, body.blob]]);
    }
    const [blob] = await kv([["GET", key]]);
    return NextResponse.json({ blob: (blob as string | null) ?? null, indexed: true });
  } catch (e) {
    console.error("[private]", (e as Error).message);
    return NextResponse.json({ error: "Couldn't reach the backup store." }, { status: 502 });
  }
}
