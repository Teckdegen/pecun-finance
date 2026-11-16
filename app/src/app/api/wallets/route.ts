import { NextResponse } from "next/server";
import { ensureRoutingAddresses, serverWalletsConfigured, verifyUser } from "@/lib/server-wallets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { signed }: `signed` is a "who am I" request stamped with the user's Turnkey session.
 * Verifies it with Turnkey, then returns (and on first call creates) the user's Solana and Sui routing addresses.
 */
export async function POST(req: Request) {
  if (!serverWalletsConfigured) return NextResponse.json({ error: "Server wallets aren't configured." }, { status: 503 });
  let signed: Parameters<typeof verifyUser>[0];
  try {
    ({ signed } = (await req.json()) as { signed: Parameters<typeof verifyUser>[0] });
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  let subOrgId: string;
  try {
    subOrgId = await verifyUser(signed);
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  try {
    return NextResponse.json(await ensureRoutingAddresses(subOrgId));
  } catch (e) {
    console.error("[wallets] provisioning failed:", (e as Error).message);
    return NextResponse.json({ error: "Couldn't set up wallets." }, { status: 502 });
  }
}
