import { NextResponse } from "next/server";
import { ensureGas, GAS_CHAINS, gasTankStatus } from "@/lib/gas-tank";
import { AuthError, turnkeyServerConfigured, verifyUserAccounts, type SignedRequest } from "@/lib/turnkey-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const notConfigured = () =>
  NextResponse.json({ error: "Pecun's gas tank isn't switched on: TURNKEY_API_PUBLIC_KEY and TURNKEY_API_PRIVATE_KEY are missing on the server." }, { status: 503 });

/** GET: the gas tank's address and balances, so it can be funded. Public (addresses and balances are public on-chain). */
export async function GET() {
  if (!turnkeyServerConfigured) return notConfigured();
  try {
    return NextResponse.json(await gasTankStatus());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/**
 * POST { signed, chainId, address, needWei }: `signed` is a list-wallet-accounts request stamped with the user's session.
 * Turnkey confirms which addresses the user owns; the top-up only goes to one of them.
 */
export async function POST(req: Request) {
  if (!turnkeyServerConfigured) return notConfigured();
  let body: { signed: SignedRequest; chainId: number; address: string; needWei: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!GAS_CHAINS[body.chainId]) return NextResponse.json({ error: `Pecun doesn't cover gas on chain ${body.chainId} yet.` }, { status: 400 });
  let user: { organizationId: string; addresses: string[] };
  try {
    user = await verifyUserAccounts(body.signed);
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.message : "Couldn't confirm your sign-in." }, { status: 401 });
  }
  if (!user.addresses.includes(String(body.address).toLowerCase())) return NextResponse.json({ error: "That address isn't yours." }, { status: 403 });
  try {
    const need = BigInt(body.needWei);
    return NextResponse.json(await ensureGas(body.chainId, body.address as `0x${string}`, need, user.organizationId));
  } catch (e) {
    console.error("[gas] top-up failed:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
