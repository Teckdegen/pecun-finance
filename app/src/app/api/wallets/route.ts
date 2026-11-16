import { NextResponse } from "next/server";
import { AuthError, ensureRoutingAddresses, serverWalletsConfigured, verifyUser } from "@/lib/server-wallets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { signed }: `signed` is a "who am I" request stamped with the user's Turnkey session.
 * Verifies it with Turnkey, then returns (and on first call creates) the user's Solana and Sui routing addresses.
 */
export async function POST(req: Request) {
  if (!serverWalletsConfigured) {
    return NextResponse.json({ error: "Wallet setup isn't switched on: TURNKEY_API_PUBLIC_KEY and TURNKEY_API_PRIVATE_KEY are missing on the server." }, { status: 503 });
  }
  let signed: Parameters<typeof verifyUser>[0];
  try {
    ({ signed } = (await req.json()) as { signed: Parameters<typeof verifyUser>[0] });
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  let subOrgId: string;
  try {
    subOrgId = await verifyUser(signed);
  } catch (e) {
    console.error("[wallets] sign-in check failed:", (e as Error).message);
    return NextResponse.json({ error: e instanceof AuthError ? e.message : "Couldn't confirm your sign-in. Try again." }, { status: 401 });
  }
  try {
    return NextResponse.json(await ensureRoutingAddresses(subOrgId));
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[wallets] provisioning failed:", msg);
    // Turnkey's own message (e.g. a permission or key problem) is safe to show and is what's needed to fix it.
    return NextResponse.json({ error: `Turnkey couldn't create the wallets: ${msg.slice(0, 240)}` }, { status: 502 });
  }
}
