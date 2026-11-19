import { HOME_TOKEN } from "@/lib/wallet";

/**
 * POST { address }: the wallet's USDC transfers on Base, in and out, newest first, read from Blockscout's free public
 * explorer. The on-chain backup behind Activity: anything the activity index doesn't have (money received from
 * outside, sends made elsewhere) still shows. On-chain data is public; nothing is stored here.
 */

export const dynamic = "force-dynamic";

const BLOCKSCOUT = "https://base.blockscout.com";

type Item = { from?: { hash?: string }; to?: { hash?: string }; total?: { value?: string; decimals?: string }; timestamp?: string; transaction_hash?: string; tx_hash?: string };

export async function POST(req: Request) {
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "address required" }, { status: 400 });
  const out: { hash: string; from: string; to: string; value: string; decimals: number; at: number }[] = [];
  let params = "";
  // Up to 3 pages (about 150 transfers).
  for (let page = 0; page < 3; page++) {
    const url = `${BLOCKSCOUT}/api/v2/addresses/${address}/token-transfers?type=ERC-20&token=${HOME_TOKEN}${params}`;
    const get = () =>
      fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; Pecun/1.0)" }, signal: AbortSignal.timeout(30_000), cache: "no-store" }).catch(() => null);
    // Blockscout can be slow: one retry.
    const res = (await get()) ?? (await get());
    if (!res?.ok) break;
    const j = (await res.json().catch(() => ({}))) as { items?: Item[]; next_page_params?: Record<string, string | number> | null };
    for (const i of j.items ?? []) {
      const hash = i.transaction_hash ?? i.tx_hash;
      if (!hash || !i.from?.hash || !i.to?.hash || !i.total?.value) continue;
      out.push({ hash, from: i.from.hash.toLowerCase(), to: i.to.hash.toLowerCase(), value: i.total.value, decimals: Number(i.total.decimals ?? 6), at: Date.parse(i.timestamp ?? "") || 0 });
    }
    if (!j.next_page_params) break;
    params = "&" + new URLSearchParams(Object.entries(j.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  return Response.json({ transfers: out }, { headers: { "cache-control": "no-store" } });
}
