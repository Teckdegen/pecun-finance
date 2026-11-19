/**
 * Pass-through to Gloam's relay (it sends no CORS headers, so the browser can't call it directly). The relay pays the
 * gas for private claims and cash outs; what it sends is fixed by the proof, so this route can't change anything.
 */

export const dynamic = "force-dynamic";

const RELAY = "https://www.gloam.trade/api/relay";

export async function GET() {
  const res = await fetch(RELAY, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > 20_000) return Response.json({ ok: false, error: "Too large." }, { status: 413 });
  let action: unknown;
  try {
    action = (JSON.parse(body) as { action?: unknown }).action;
  } catch {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  // Only the two calls Pecun makes: claiming a payment (transfer) and cashing out (unshield).
  if (action !== "transfer" && action !== "unshield") return Response.json({ ok: false, error: "Not allowed." }, { status: 400 });
  const res = await fetch(RELAY, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(60_000) });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
