import { createPublicClient, erc20Abi, fallback, http, type Address } from "viem";
import { buildCatalog } from "@/lib/catalog";
import { chainIdByName, EVM_CHAINS } from "@/lib/exec-chains";

/**
 * POST { address }: which vaults an address holds a position in, read straight from the chains. For every EVM chain
 * Pecun lists vaults on, one batched call (Multicall3) asks each vault's share token for the address's balance. On-chain
 * balances are public; nothing is stored. Solana and Sui positions come from the activity index instead.
 */

export const dynamic = "force-dynamic";

const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11" as Address;
const isAddr = (a?: string): a is Address => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);

async function heldOn(chainId: number, tokens: Address[], owner: Address): Promise<Address[]> {
  const ch = EVM_CHAINS.find((c) => c.id === chainId);
  if (!ch || !tokens.length) return [];
  const client = createPublicClient({ transport: fallback([ch.rpc, ...(ch.backups ?? [])].map((u) => http(u, { timeout: 12_000, retryCount: 0 })), { retryCount: 1 }) });
  const contracts = tokens.map((address) => ({ address, abi: erc20Abi, functionName: "balanceOf" as const, args: [owner] as const }));
  try {
    const res = await client.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3, batchSize: 4_096 });
    return tokens.filter((_, i) => res[i].status === "success" && (res[i].result as bigint) > BigInt(0));
  } catch {
    // No Multicall3 on this chain (or it failed): ask each token directly, a few at a time.
    const hits: Address[] = [];
    for (let i = 0; i < tokens.length; i += 10) {
      const batch = await Promise.allSettled(tokens.slice(i, i + 10).map((t) => client.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [owner] })));
      batch.forEach((r, j) => r.status === "fulfilled" && r.value > BigInt(0) && hits.push(tokens[i + j]));
    }
    return hits;
  }
}

export async function POST(req: Request) {
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!isAddr(address)) return Response.json({ error: "address required" }, { status: 400 });
  const cat = await buildCatalog();
  const byChain = new Map<number, Set<Address>>();
  for (const o of [...cat.opportunities, ...cat.unlisted, ...cat.closed]) {
    const id = chainIdByName(o.chain);
    if (!id || !isAddr(o.address)) continue;
    if (!byChain.has(id)) byChain.set(id, new Set());
    byChain.get(id)!.add(o.address.toLowerCase() as Address);
  }
  const settled = await Promise.allSettled([...byChain].map(async ([chainId, set]) => (await heldOn(chainId, [...set], address)).map((token) => ({ chainId, token }))));
  const tokens = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return Response.json({ tokens }, { headers: { "cache-control": "no-store" } });
}
