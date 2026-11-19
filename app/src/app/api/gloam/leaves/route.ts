/**
 * Pass-through to Gloam's published vault leaves (no CORS headers upstream). The SDK checks the tree it rebuilds from
 * them against the pool's on-chain root, so a wrong answer here can't make a bad proof; it would just fall back to
 * reading the chain.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const network = new URL(req.url).searchParams.get("network") ?? "";
  if (!/^[a-z0-9-]{2,40}$/.test(network)) return Response.json({ error: "Bad network." }, { status: 400 });
  const res = await fetch(`https://www.gloam.trade/api/vault-leaves?network=${encodeURIComponent(network)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    next: { revalidate: 30 },
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
