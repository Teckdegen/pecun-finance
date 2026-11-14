import { evmChainName, isStable } from "../chains.ts";
import { getJson, num } from "../http.ts";
import type { Opportunity } from "../types.ts";

/**
 * Protocols with no public list API: read straight from chain through their own SDKs.
 * The SDKs are imported lazily so a failure here can never break the rest of the catalog.
 */

/* ---------------- Suilend (Sui lending, main market) ---------------- */

type Decimal = { value: string | bigint };
type SuilendReserve = {
  coinType: string | { name: string };
  mintDecimals: number;
  price: Decimal;
  availableAmount: string | bigint;
  borrowedAmount: Decimal;
  config: { element?: SuilendConfig } & SuilendConfig;
};
type SuilendConfig = { interestRateUtils: number[]; interestRateAprs: (string | number)[]; spreadFeeBps: string | number; openLtvPct?: number; closeLtvPct?: number; liquidationBonusBps?: string | number; depositLimitUsd?: string | number; borrowLimitUsd?: string | number };

const WAD = 1e18;
/** Suilend config numbers arrive as bigint, string or number. */
const big = (v: unknown): number => num(v === undefined || v === null ? v : String(v));

/** Borrow APR from Suilend's piecewise-linear curve: utils in %, aprs in basis points. */
function borrowApr(util: number, utils: number[], aprsBps: number[]): number {
  const u = util * 100;
  for (let i = 1; i < utils.length; i++) {
    if (u <= utils[i]) {
      const t = (u - utils[i - 1]) / (utils[i] - utils[i - 1] || 1);
      return (aprsBps[i - 1] + t * (aprsBps[i] - aprsBps[i - 1])) / 10_000;
    }
  }
  return aprsBps[aprsBps.length - 1] / 10_000;
}

export async function suilend(): Promise<Opportunity[]> {
  const { SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE } = await import("@suilend/sdk/client");
  const { SuiGrpcClient } = await import("@mysten/sui/grpc");
  const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
  const s = await SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, client);
  const reserves = s.lendingMarket.reserves as unknown as SuilendReserve[];
  const typeOf = (r: SuilendReserve) => {
    const raw = typeof r.coinType === "string" ? r.coinType : r.coinType.name;
    return raw.startsWith("0x") ? raw : `0x${raw}`;
  };
  // Many Sui tokens are typed `…::coin::COIN`; the real symbol lives in on-chain coin metadata.
  const symbols = new Map<string, string>();
  const types = reserves.map(typeOf);
  // Sui GraphQL caps a query at 5 KB, so and limits store reads per request, so look symbols up 5 coins at a time.
  await Promise.all(
    Array.from({ length: Math.ceil(types.length / 5) }, (_, k) => types.slice(k * 5, k * 5 + 5)).map(async (chunk) => {
      const q = chunk.map((t, i) => `c${i}: coinMetadata(coinType: ${JSON.stringify(t)}) { symbol }`).join(" ");
      const meta = await fetch("https://graphql.mainnet.sui.io/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "PECUN/0.1 (yield catalog)" },
        body: JSON.stringify({ query: `{ ${q} }` }),
        cache: "no-store",
      }).then((x) => x.json() as Promise<{ data?: Record<string, { symbol?: string } | null> }>).catch(() => null);
      chunk.forEach((t, i) => {
        const sym = meta?.data?.[`c${i}`]?.symbol;
        if (sym) symbols.set(t, sym);
      });
    }),
  );

  return reserves.map((r) => {
    const cfg = r.config.element ?? r.config;
    const scale = 10 ** r.mintDecimals;
    const borrowed = num(String(r.borrowedAmount.value)) / WAD / scale;
    const available = num(String(r.availableAmount)) / scale;
    const deposits = borrowed + available;
    const util = deposits > 0 ? borrowed / deposits : 0;
    const bApr = borrowApr(util, cfg.interestRateUtils.map(Number), cfg.interestRateAprs.map(Number));
    const dApr = bApr * util * (1 - big(cfg.spreadFeeBps) / 10_000);
    const price = num(String(r.price.value)) / WAD;
    const coinType = typeOf(r);
    const symbol = symbols.get(coinType) ?? coinType.split("::").pop() ?? "?";
    return {
      id: `suilend:sui:${coinType}`,
      protocol: "Suilend",
      name: `${symbol} lending`,
      asset: symbol,
      kind: "Lending",
      category: "Lending market",
      chain: "Sui",
      apy: dApr,
      apyNote: "Base deposit APR; excludes reward incentives",
      apy7d: null,
      apy30d: null,
      tvlUsd: deposits * price,
      manager: "Suilend",
      redemption: "Instant (if liquidity)",
      stablecoin: isStable(symbol),
      url: "https://suilend.fi/dashboard",
      address: coinType,
      lending: {
        totalSuppliedUsd: deposits * price,
        totalBorrowedUsd: borrowed * price,
        liquidityUsd: available * price,
        utilization: util,
        supplyApy: dApr,
        borrowApy: bApr,
        supplyCapUsd: big(cfg.depositLimitUsd) || undefined,
        borrowCapUsd: big(cfg.borrowLimitUsd) || undefined,
        maxLtv: cfg.openLtvPct !== undefined ? big(cfg.openLtvPct) / 100 : undefined,
        liquidationThreshold: cfg.closeLtvPct !== undefined ? big(cfg.closeLtvPct) / 100 : undefined,
        liquidationPenalty: cfg.liquidationBonusBps !== undefined ? big(cfg.liquidationBonusBps) / 10_000 : undefined,
        canBeCollateral: big(cfg.openLtvPct) > 0,
        reserveFactor: big(cfg.spreadFeeBps) / 10_000,
        priceUsd: price,
        rateCurve: cfg.interestRateUtils.map((u, i) => [Number(u) / 100, Number(cfg.interestRateAprs[i]) / 10_000] as [number, number]),
      },
      details: [
        { label: "Utilization", value: `${(util * 100).toFixed(1)}%` },
        { label: "Borrow APR", value: `${(bApr * 100).toFixed(2)}%` },
        { label: "Reserve fee", value: `${(big(cfg.spreadFeeBps) / 100).toFixed(0)}%` },
      ],
    } satisfies Opportunity;
  });
}

/* ---------------- Gearbox (passive lending pools) ---------------- */

type GearboxPool = {
  address: string;
  name?: string;
  symbol?: string;
  underlying: string;
  decimals: number;
  supplyRate: bigint | string;
  baseInterestRate?: bigint | string;
  totalBorrowed?: bigint | string;
  expectedLiquidity: bigint | string;
  isPaused?: boolean;
};

const GEARBOX_NETWORKS: { network: string; chainId: number; lifiChain: string; rpc: string }[] = [
  { network: "Mainnet", chainId: 1, lifiChain: "ETH", rpc: "https://ethereum-rpc.publicnode.com" },
];

export async function gearbox(): Promise<Opportunity[]> {
  const { GearboxSDK } = await import("@gearbox-protocol/sdk");
  const out: Opportunity[] = [];
  for (const n of GEARBOX_NETWORKS) {
    const sdk = new GearboxSDK({
      mode: "onchain",
      networks: [n.network],
      onchain: { chains: { [n.network]: { rpcURLs: [n.rpc] } } },
    } as never);
    await sdk.attach();
    const register = (sdk as unknown as { onchain: { chain: (k: string) => { marketRegister: { pools: { pool: GearboxPool }[] } } } }).onchain
      .chain(n.network).marketRegister;
    for (const { pool } of register.pools) {
      if (pool.isPaused) continue;
      const price = await getJson<{ priceUSD?: string; symbol?: string; logoURI?: string }>(
        `https://li.quest/v1/token?chain=${n.lifiChain}&token=${pool.underlying}`,
      ).catch(() => ({}) as { priceUSD?: string; symbol?: string; logoURI?: string });
      const symbol = price.symbol ?? pool.symbol ?? "?";
      const liquidity = num(String(pool.expectedLiquidity)) / 10 ** pool.decimals;
      out.push({
        id: `gearbox:${n.chainId}:${pool.address}`,
        protocol: "Gearbox",
        name: pool.name ?? `${symbol} pool`,
        asset: symbol,
        kind: "Lending",
        category: "Passive lending pool",
        chain: evmChainName(n.chainId),
        apy: num(String(pool.supplyRate)) / 1e27,
        apy7d: null,
        apy30d: null,
        tvlUsd: liquidity * num(price.priceUSD),
        manager: "Gearbox",
        redemption: "Instant (if liquidity)",
        stablecoin: isStable(symbol),
        url: `https://app.gearbox.finance/pools/${n.chainId}/${pool.address}`,
        address: pool.address,
        assetLogo: price.logoURI,
        lending: (() => {
          const px = num(price.priceUSD);
          const borrowed = num(String(pool.totalBorrowed ?? 0)) / 10 ** pool.decimals;
          return {
            totalSuppliedUsd: liquidity * px,
            totalBorrowedUsd: borrowed * px,
            liquidityUsd: Math.max(0, liquidity - borrowed) * px,
            utilization: liquidity > 0 ? borrowed / liquidity : 0,
            supplyApy: num(String(pool.supplyRate)) / 1e27,
            borrowApy: pool.baseInterestRate !== undefined ? num(String(pool.baseInterestRate)) / 1e27 : undefined,
            priceUsd: px || undefined,
          };
        })(),
      });
    }
  }
  return out;
}
