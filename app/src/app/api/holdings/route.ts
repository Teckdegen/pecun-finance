/**
 * POST { address }: the ERC-20 tokens an address holds on the main EVM chains, read from Blockscout's free public
 * explorers. The Portfolio matches them against vault share tokens (Morpho, Aave aTokens, Euler, Beefy, ...) to find
 * positions, including ones opened before Pecun kept an activity log. On-chain balances are public; nothing is stored.
 */

export const dynamic = "force-dynamic";

const EXPLORERS: [number, string][] = [
  [8453, "https://base.blockscout.com"],
  [1, "https://eth.blockscout.com"],
  [42161, "https://arbitrum.blockscout.com"],
  [10, "https://optimism.blockscout.com"],
  [137, "https://polygon.blockscout.com"],
  [100, "https://gnosis.blockscout.com"],
  [4663, "https://robinhoodchain.blockscout.com"],
];

type Item = { token?: { address_hash?: string; address?: string; decimals?: string; symbol?: string }; value?: string };

async function tokensOn(chainId: number, base: string, address: string) {
  const res = await fetch(`${base}/api/v2/addresses/${address}/tokens?type=ERC-20`, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; Pecun/1.0)" },
    signal: AbortSignal.timeout(12_000),
    redirect: "follow",
  });
  if (!res.ok) return [];
  const j = (await res.json().catch(() => ({}))) as { items?: Item[] };
  return (j.items ?? [])
    .filter((i) => i.value && i.value !== "0")
    .map((i) => ({ chainId, token: (i.token?.address_hash ?? i.token?.address ?? "").toLowerCase(), symbol: i.token?.symbol ?? "" }))
    .filter((t) => /^0x[0-9a-f]{40}$/.test(t.token));
}

export async function POST(req: Request) {
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "address required" }, { status: 400 });
  const settled = await Promise.allSettled(EXPLORERS.map(([id, base]) => tokensOn(id, base, address)));
  const tokens = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return Response.json({ tokens }, { headers: { "cache-control": "no-store" } });
}
