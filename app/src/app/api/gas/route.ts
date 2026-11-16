import { NextResponse } from "next/server";
import { ensureGas, gasTankConfigured, gasTankStatus, isGasChain } from "@/lib/gas-tank";
import { AuthError, verifyUserAccounts, type SignedRequest } from "@/lib/turnkey-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const notConfigured = () =>
  NextResponse.json({ error: "Pecun's gas tank isn't set up: add GAS_TANK_EVM_PRIVATE_KEY, GAS_TANK_SOLANA_PRIVATE_KEY and GAS_TANK_SUI_PRIVATE_KEY on the server." }, { status: 503 });

/** GET: the gas tank addresses and balances, so they can be funded. Public (addresses and balances are public on-chain). */
export async function GET() {
  if (!gasTankConfigured()) return notConfigured();
  try {
    return NextResponse.json(await gasTankStatus());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/**
 * POST { signed, chainId, address, need }: `signed` is a list-wallet-accounts request stamped with the user's session.
 * Turnkey confirms which addresses the user owns; a top-up only goes to one of them. `need` is wei (EVM), lamports (Solana) or MIST (Sui).
 */
export async function POST(req: Request) {
  if (!gasTankConfigured()) return notConfigured();
  let body: { signed: SignedRequest; chainId: number; address: string; need?: string; needWei?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!isGasChain(body.chainId)) return NextResponse.json({ error: `Pecun doesn't cover gas on chain ${body.chainId} yet.` }, { status: 400 });
  let user: { organizationId: string; addresses: string[] };
  try {
    user = await verifyUserAccounts(body.signed);
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.message : "Couldn't confirm your sign-in." }, { status: 401 });
  }
  if (!user.addresses.includes(String(body.address).toLowerCase())) return NextResponse.json({ error: "That address isn't yours." }, { status: 403 });
  try {
    const need = BigInt(body.need ?? body.needWei ?? "0");
    return NextResponse.json(await ensureGas(body.chainId, body.address, need, user.organizationId));
  } catch (e) {
    console.error("[gas] top-up failed:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
