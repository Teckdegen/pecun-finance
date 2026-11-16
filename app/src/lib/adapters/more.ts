import { createPublicClient, fallback, http, parseAbi, type Address, type PublicClient } from "viem";
import { evmChainName, isStable } from "../chains.ts";
import { getJson, num } from "../http.ts";
import type { LendingInfo, Opportunity } from "../types.ts";

/**
 * Sources added in the second wave: Venus, Silo, GMX, Jupiter JLP, Volo, Rocket Pool, Frax, ether.fi, Resolv, Kinetiq,
 * Lista, Spectra, Avantis and HyperLend. Every endpoint and contract below was probed live before it was added.
 * Each one is executable with the protocol's own contracts (noted per source); none needs a paid key.
 */

/* ---------------- shared helpers ---------------- */

/** dRPC's free endpoints serve historical calls, which exchange-rate APYs need; publicnode is the fallback for live reads. */
const RPC: Record<number, string[]> = {
  1: ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
  56: ["https://bsc.drpc.org", "https://bsc-rpc.publicnode.com"],
  999: ["https://hyperliquid.drpc.org", "https://rpc.hyperliquid.xyz/evm"],
};
const BLOCK_SECONDS: Record<number, number> = { 1: 12, 56: 0.75, 999: 1 };

const clients = new Map<number, PublicClient>();
function client(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({ transport: fallback(RPC[chainId].map((u) => http(u, { timeout: 20_000, retryCount: 2 }))) }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

const ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function getRate() view returns (uint256)",
  "function getExchangeRate() view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function convertSnBnbToBnb(uint256) view returns (uint256)",
  "function kHYPEToHYPE(uint256) view returns (uint256)",
]);

type RateFn = "getRate" | "getExchangeRate" | "convertToAssets" | "convertSnBnbToBnb" | "kHYPEToHYPE";

/** Exchange rate (1e18 base) of a yield-bearing token at a block (latest when omitted). */
async function rateAt(chainId: number, address: Address, fn: RateFn, blockNumber?: bigint): Promise<number> {
  const c = client(chainId);
  const raw =
    fn === "getRate" || fn === "getExchangeRate"
      ? await c.readContract({ address, abi: ABI, functionName: fn, blockNumber })
      : await c.readContract({ address, abi: ABI, functionName: fn, args: [BigInt(1e18)], blockNumber });
  return Number(raw) / 1e18;
}

/** APY from how far the exchange rate moved over the last `days` days, compounded to a year. */
async function rateApy(chainId: number, address: Address, fn: RateFn, days: number): Promise<{ apy: number | null; rate: number }> {
  const c = client(chainId);
  const head = await c.getBlockNumber();
  const back = BigInt(Math.round((days * 86_400) / BLOCK_SECONDS[chainId]));
  const [now, then] = await Promise.all([rateAt(chainId, address, fn), rateAt(chainId, address, fn, head - back).catch(() => 0)]);
  return { apy: now > 0 && then > 0 ? Math.pow(now / then, 365 / days) - 1 : null, rate: now };
}

/** USD price from LI.FI's open token API. */
async function price(chain: string | number, token: string): Promise<number> {
  const t = await getJson<{ priceUSD?: string }>(`https://li.quest/v1/token?chain=${chain}&token=${encodeURIComponent(token)}`, 20_000);
  return num(t.priceUSD);
}
const ETH = "0x0000000000000000000000000000000000000000";

const RAY = 1e27;
const YEAR = 31_536_000;
/** Aave-style APR in ray → APY, compounded per second. */
const rayToApy = (ray: number) => Math.pow(1 + ray / RAY / YEAR, YEAR) - 1;

/** Aave-style two-slope borrow curve, as [utilization, borrow APR] points. */
function twoSlope(base: number, s1: number, s2: number, optimal: number): [number, number][] {
  if (!(optimal > 0 && optimal < 1)) return [];
  return [
    [0, base],
    [optimal, base + s1],
    [1, base + s1 + s2],
  ];
}

/* ---------------- Venus (BNB Chain and L2s) ---------------- */
// Execution: VToken `mint(amount)` after an ERC-20 approve (or `mint()` with value for vBNB); `redeemUnderlying(amount)` to withdraw.

type VenusMarket = {
  address: string;
  chainId: string;
  symbol: string;
  underlyingSymbol: string;
  underlyingAddress?: string;
  supplyApy?: string;
  supplyXvsApy?: string;
  borrowApy?: string;
  borrowXvsApy?: string;
  totalSupplyUnderlyingCents?: number | string;
  totalBorrowCents?: number | string;
  liquidityCents?: number | string;
  collateralFactorMantissa?: string;
  liquidationThresholdMantissa?: string;
  liquidationIncentiveMantissa?: string;
  reserveFactorMantissa?: string;
  canBeCollateral?: boolean;
  isListed?: boolean;
  mintGuardianPaused?: boolean;
};
const VENUS_CHAINS = [56, 1, 42161, 8453, 130, 324, 204, 10];

export async function venus(): Promise<Opportunity[]> {
  const pages = await Promise.all(
    VENUS_CHAINS.map((c) =>
      getJson<{ result?: VenusMarket[] }>(`https://api.venus.io/markets?chainId=${c}&limit=100`, 30_000)
        .then((r) => r.result ?? [])
        .catch(() => [] as VenusMarket[]),
    ),
  );
  const out: Opportunity[] = [];
  for (const m of pages.flat()) {
    if (m.isListed === false || m.mintGuardianPaused) continue;
    const chainId = Number(m.chainId);
    const base = num(m.supplyApy) / 100;
    const reward = num(m.supplyXvsApy) / 100;
    const supplied = num(m.totalSupplyUnderlyingCents) / 100;
    const borrowed = num(m.totalBorrowCents) / 100;
    const lending: LendingInfo = {
      totalSuppliedUsd: supplied,
      totalBorrowedUsd: borrowed,
      liquidityUsd: num(m.liquidityCents) / 100,
      utilization: supplied > 0 ? borrowed / supplied : undefined,
      supplyApy: base + reward,
      borrowApy: num(m.borrowApy) / 100,
      maxLtv: num(m.collateralFactorMantissa) / 1e18,
      liquidationThreshold: num(m.liquidationThresholdMantissa) / 1e18 || undefined,
      liquidationPenalty: num(m.liquidationIncentiveMantissa) > 0 ? num(m.liquidationIncentiveMantissa) / 1e18 - 1 : undefined,
      reserveFactor: num(m.reserveFactorMantissa) / 1e18,
      canBeCollateral: m.canBeCollateral,
    };
    out.push({
      id: `venus:${chainId}:${m.address}`,
      protocol: "Venus",
      name: `${m.underlyingSymbol} lending`,
      ticker: m.symbol,
      asset: m.underlyingSymbol,
      kind: "Lending",
      category: "Lending market",
      chain: evmChainName(chainId),
      apy: base + reward,
      apy7d: null,
      apy30d: null,
      rewardApy: reward || null,
      apyNote: reward ? "Supply APY plus XVS rewards" : undefined,
      tvlUsd: supplied,
      manager: "Venus",
      redemption: "Instant (if liquidity)",
      stablecoin: isStable(m.underlyingSymbol),
      url: "https://app.venus.io/",
      address: m.address,
      lending,
    });
  }
  return out;
}

/* ---------------- Silo (isolated lending, V3 + whitelisted V2) ---------------- */
// Execution: each market and vault is ERC-4626, so `deposit(assets, receiver)` / `withdraw(assets, receiver, owner)`.

const SILO_GQL = "https://api-v3.silo.finance/";
type SiloMarket = {
  id: string;
  chainId: number;
  depositRate: string | null;
  borrowRate: string | null;
  utilization: string | null;
  supplyUsd: number | null;
  liquidityUsd: number | null;
  borrowedUsd: number | null;
  maxLtv: string | null;
  lt: string | null;
  inputToken: { symbol: string } | null;
  otherMarket: { inputToken: { symbol: string } | null } | null;
};
type SiloVault = { id: string; chainId: number; name: string; symbol: string; userApr: string | null; totalAssetsUsd: number | null; asset: { symbol: string } | null };

async function siloQuery<T>(query: string): Promise<T> {
  const res = await fetch(SILO_GQL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "PECUN/0.1 (yield catalog)" },
    body: JSON.stringify({ query }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!j.data) throw new Error(j.errors?.[0]?.message ?? `Silo API ${res.status}`);
  return j.data;
}

export async function silo(): Promise<Opportunity[]> {
  const d = await siloQuery<{ markets: { items: SiloMarket[] }; vaults: { items: SiloVault[] } }>(
    `{ markets(limit:500, where:{isWhitelisted:true}){ items { id chainId depositRate borrowRate utilization supplyUsd liquidityUsd borrowedUsd maxLtv lt inputToken { symbol } otherMarket { inputToken { symbol } } } }
       vaults(limit:200, where:{isWhitelisted:true}){ items { id chainId name symbol userApr totalAssetsUsd asset { symbol } } } }`,
  );
  const out: Opportunity[] = [];
  for (const m of d.markets.items) {
    const sym = m.inputToken?.symbol;
    if (!sym || !m.supplyUsd) continue;
    const apy = num(m.depositRate) / 100;
    const coll = m.otherMarket?.inputToken?.symbol;
    out.push({
      id: `silo:${m.chainId}:${m.id}`,
      protocol: "Silo",
      name: coll ? `${sym} lending · ${coll} market` : `${sym} lending`,
      asset: sym,
      kind: "Lending",
      category: "Isolated lending",
      chain: evmChainName(m.chainId),
      apy,
      apy7d: null,
      apy30d: null,
      tvlUsd: m.supplyUsd,
      manager: "Silo",
      redemption: "Instant (if liquidity)",
      stablecoin: isStable(sym),
      url: "https://app.silo.finance/",
      address: m.id,
      lending: {
        totalSuppliedUsd: m.supplyUsd,
        totalBorrowedUsd: m.borrowedUsd ?? undefined,
        liquidityUsd: m.liquidityUsd ?? undefined,
        utilization: m.utilization != null ? num(m.utilization) : undefined,
        supplyApy: apy,
        borrowApy: num(m.borrowRate) / 100,
        liquidationThreshold: coll && num(m.lt) > 0 ? num(m.lt) / 1e18 : undefined,
        collateral: coll ? { symbol: coll } : undefined,
      },
    });
  }
  for (const v of d.vaults.items) {
    const sym = v.asset?.symbol;
    if (!sym || !v.totalAssetsUsd) continue;
    out.push({
      id: `silo-vault:${v.chainId}:${v.id}`,
      protocol: "Silo",
      name: v.name,
      ticker: v.symbol,
      asset: sym,
      kind: "Vault",
      category: "Curated lending vault",
      chain: evmChainName(v.chainId),
      apy: num(v.userApr) / 100,
      apy7d: null,
      apy30d: null,
      apyNote: "After the vault's fee",
      tvlUsd: v.totalAssetsUsd,
      manager: "Silo",
      redemption: "Instant (if liquidity)",
      stablecoin: isStable(sym),
      url: "https://app.silo.finance/",
      address: v.id,
    });
  }
  return out;
}

/* ---------------- GMX (GM pools and GLV vaults on Arbitrum and Avalanche) ---------------- */
// Execution: deposits go through GMX's ExchangeRouter (`createDeposit` / `createGlvDeposit`, executed by GMX keepers).

type GmxMarket = { name: string; marketToken: string; longToken: string; shortToken: string; isListed: boolean; poolAmountLong: string; poolAmountShort: string };
type GmxGlv = { name: string; glvToken: string; isListed: boolean; markets: { balanceUsd: string }[] };
type GmxApy = { markets?: Record<string, { apy: number }>; glvs?: Record<string, { apy: number }> };
type GmxTicker = { tokenAddress: string; tokenSymbol: string; minPrice: string; maxPrice: string };
const GMX_CHAINS: [number, string][] = [
  [42161, "https://arbitrum-api.gmxinfra.io"],
  [43114, "https://avalanche-api.gmxinfra.io"],
];

async function gmxChain(chainId: number, base: string): Promise<Opportunity[]> {
  const [info, glvs, apy, tickers] = await Promise.all([
    getJson<{ markets: GmxMarket[] }>(`${base}/markets/info`, 30_000),
    getJson<{ glvs: GmxGlv[] }>(`${base}/glvs/info`, 30_000).catch(() => ({ glvs: [] as GmxGlv[] })),
    getJson<GmxApy>(`${base}/apy?period=30d`, 30_000),
    getJson<GmxTicker[]>(`${base}/prices/tickers`, 30_000),
  ]);
  // GMX prices are USD per smallest token unit, scaled by 1e30.
  const px = new Map(tickers.map((t) => [t.tokenAddress.toLowerCase(), { p: (num(t.minPrice) + num(t.maxPrice)) / 2, s: t.tokenSymbol }]));
  const sym = (a: string) => px.get(a.toLowerCase())?.s ?? "?";
  const chain = evmChainName(chainId);
  const out: Opportunity[] = [];
  for (const m of info.markets) {
    if (!m.isListed) continue;
    const a = apy.markets?.[m.marketToken]?.apy;
    const tvl = (num(m.poolAmountLong) * (px.get(m.longToken.toLowerCase())?.p ?? 0) + num(m.poolAmountShort) * (px.get(m.shortToken.toLowerCase())?.p ?? 0)) / 1e30;
    if (a == null || !tvl) continue;
    const long = sym(m.longToken), short = sym(m.shortToken);
    out.push({
      id: `gmx:${chainId}:${m.marketToken}`,
      protocol: "GMX",
      name: `GM ${m.name}`,
      ticker: "GM",
      asset: long === short ? long : `${long}-${short}`,
      kind: "Liquidity",
      category: "Perps liquidity",
      chain,
      apy: a,
      apy7d: null,
      apy30d: a,
      apyNote: "30-day fee APY earned from traders",
      tvlUsd: tvl,
      manager: "GMX",
      redemption: "Instant (if liquidity)",
      stablecoin: isStable(long) && isStable(short),
      url: "https://app.gmx.io/#/pools",
      address: m.marketToken,
    });
  }
  for (const g of glvs.glvs) {
    if (!g.isListed) continue;
    const a = apy.glvs?.[g.glvToken]?.apy;
    const tvl = g.markets.reduce((s, x) => s + num(x.balanceUsd), 0) / 1e30;
    if (a == null || !tvl) continue;
    const pair = g.name.replace(/^GLV\s*\[|\]$/g, "");
    out.push({
      id: `gmx-glv:${chainId}:${g.glvToken}`,
      protocol: "GMX",
      name: g.name,
      ticker: "GLV",
      asset: pair,
      kind: "Liquidity",
      category: "Perps liquidity vault",
      chain,
      apy: a,
      apy7d: null,
      apy30d: a,
      apyNote: "30-day fee APY across the GM pools it holds",
      tvlUsd: tvl,
      manager: "GMX",
      redemption: "Instant (if liquidity)",
      stablecoin: pair.split("-").every((s) => isStable(s)),
      url: "https://app.gmx.io/#/pools",
      address: g.glvToken,
    });
  }
  return out;
}

export async function gmx(): Promise<Opportunity[]> {
  const res = await Promise.allSettled(GMX_CHAINS.map(([c, b]) => gmxChain(c, b)));
  const ok = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!ok.length) throw new Error("GMX: no chain returned data");
  return ok;
}

/* ---------------- Jupiter JLP (Solana perps liquidity) ---------------- */
// Execution: Jupiter's perps program (add/remove liquidity), or a Jupiter swap into JLP.

export async function jupiterJlp(): Promise<Opportunity[]> {
  const j = await getJson<{ aumUsdFormatted?: string; jlpApyPct?: string; jlpPriceUsdFormatted?: string }>("https://perps-api.jup.ag/v1/jlp-info", 30_000);
  return [
    {
      id: "jupiter-jlp:solana:jlp",
      protocol: "Jupiter",
      name: "Jupiter Liquidity Provider (JLP)",
      ticker: "JLP",
      asset: "JLP",
      kind: "Perp vault",
      category: "Perps liquidity",
      chain: "Solana",
      apy: num(j.jlpApyPct) / 100,
      apy7d: num(j.jlpApyPct) / 100,
      apy30d: null,
      apyNote: "Trading fees paid to the pool, as reported by Jupiter",
      tvlUsd: num(j.aumUsdFormatted),
      manager: "Jupiter",
      redemption: "Instant (swap)",
      stablecoin: false,
      sharePrice: num(j.jlpPriceUsdFormatted) || undefined,
      url: "https://jup.ag/perps-earn",
      address: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
    },
  ];
}

/* ---------------- Volo (vSUI liquid staking on Sui) ---------------- */
// Execution: Volo's native pool `stake` / `unstake` Move calls (documented in Volo's API reference).

export async function volo(): Promise<Opportunity[]> {
  const [{ data }, sui] = await Promise.all([
    getJson<{ data: { apy?: number; totalStaked?: string; exchangeRate?: number } }>("https://open-api.naviprotocol.io/api/volo/stats", 30_000),
    price("SUI", "0x2::sui::SUI"),
  ]);
  return [
    {
      id: "volo:sui:vsui",
      protocol: "Volo",
      name: "Volo staked SUI (vSUI)",
      ticker: "vSUI",
      asset: "SUI",
      kind: "Liquid staking",
      chain: "Sui",
      apy: num(data.apy),
      apy7d: null,
      apy30d: null,
      tvlUsd: num(data.totalStaked) * sui,
      manager: "Volo",
      redemption: "Instant (if liquidity)",
      stablecoin: false,
      sharePrice: num(data.exchangeRate) || undefined,
      url: "https://stake.volo.fi/",
    },
  ];
}

/* ---------------- Rocket Pool (rETH on Ethereum) ---------------- */
// Execution: RocketDepositPool `deposit()` with ETH; exit by selling rETH or burning it for ETH when the pool has room.

const RETH: Address = "0xae78736Cd615f374D3085123A210448E74Fc6393";

export async function rocketPool(): Promise<Opportunity[]> {
  const [apr, rate, supply, eth] = await Promise.all([
    getJson<{ yearlyAPR?: string }>("https://api.rocketpool.net/api/mainnet/apr", 30_000),
    rateAt(1, RETH, "getExchangeRate"),
    client(1).readContract({ address: RETH, abi: ABI, functionName: "totalSupply" }),
    price(1, ETH),
  ]);
  return [
    {
      id: `rocketpool:1:${RETH}`,
      protocol: "Rocket Pool",
      name: "Rocket Pool ETH (rETH)",
      ticker: "rETH",
      asset: "ETH",
      kind: "Liquid staking",
      chain: "Ethereum",
      apy: num(apr.yearlyAPR) / 100,
      apy7d: num(apr.yearlyAPR) / 100,
      apy30d: null,
      apyNote: "7-day APR reported by Rocket Pool",
      tvlUsd: (Number(supply) / 1e18) * rate * eth,
      manager: "Rocket Pool",
      redemption: "Instant (swap) or burn",
      stablecoin: false,
      sharePrice: rate,
      url: "https://stake.rocketpool.net/",
      address: RETH,
    },
  ];
}

/* ---------------- Frax (sfrxETH and sfrxUSD on Ethereum) ---------------- */
// Execution: both are ERC-4626 vaults: `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`.

const SFRXETH: Address = "0xac3E018457B222d93114458476f3E3416Abbe38F";
const SFRXUSD: Address = "0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6";

export async function frax(): Promise<Opportunity[]> {
  const [sum, eth, usd, usdAssets] = await Promise.all([
    getJson<{ sfrxethApr?: number; sfrxethTotalAssets?: number }>("https://api.frax.finance/v2/frxeth/summary/latest", 30_000),
    price(1, ETH),
    rateApy(1, SFRXUSD, "convertToAssets", 7),
    client(1).readContract({ address: SFRXUSD, abi: ABI, functionName: "totalAssets" }),
  ]);
  const base = { protocol: "Frax", kind: "Vault", chain: "Ethereum", apy7d: null, apy30d: null, manager: "Frax", redemption: "Instant", url: "https://frax.com/" } as const;
  return [
    {
      ...base,
      id: `frax:1:${SFRXETH}`,
      name: "Staked Frax Ether (sfrxETH)",
      ticker: "sfrxETH",
      asset: "frxETH",
      kind: "Liquid staking",
      category: "ETH staking",
      apy: num(sum.sfrxethApr) / 100,
      tvlUsd: num(sum.sfrxethTotalAssets) * eth,
      stablecoin: false,
      address: SFRXETH,
    },
    {
      ...base,
      id: `frax:1:${SFRXUSD}`,
      name: "Staked Frax USD (sfrxUSD)",
      ticker: "sfrxUSD",
      asset: "frxUSD",
      category: "Savings rate",
      apy: usd.apy,
      apy7d: usd.apy,
      apyNote: "Measured from the vault's share price over the last 7 days",
      tvlUsd: Number(usdAssets) / 1e18,
      stablecoin: true,
      sharePrice: usd.rate,
      address: SFRXUSD,
    },
  ];
}

/* ---------------- ether.fi (weETH on Ethereum) ---------------- */
// Execution: ether.fi LiquidityPool `deposit()` with ETH for eETH, then weETH `wrap(amount)`.

const WEETH: Address = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee";

export async function etherfi(): Promise<Opportunity[]> {
  const [{ apy, rate }, supply, eth] = await Promise.all([
    rateApy(1, WEETH, "getRate", 7),
    client(1).readContract({ address: WEETH, abi: ABI, functionName: "totalSupply" }),
    price(1, ETH),
  ]);
  return [
    {
      id: `etherfi:1:${WEETH}`,
      protocol: "ether.fi",
      name: "ether.fi wrapped eETH (weETH)",
      ticker: "weETH",
      asset: "ETH",
      kind: "Liquid staking",
      category: "ETH restaking",
      chain: "Ethereum",
      apy,
      apy7d: apy,
      apy30d: null,
      apyNote: "Measured from weETH's exchange rate over the last 7 days",
      tvlUsd: (Number(supply) / 1e18) * rate * eth,
      manager: "ether.fi",
      redemption: "Withdrawal queue",
      stablecoin: false,
      sharePrice: rate,
      url: "https://app.ether.fi/",
      address: WEETH,
    },
  ];
}

/* ---------------- Resolv (wstUSR on Ethereum) ---------------- */
// Execution: wstUSR is ERC-4626 over USR: `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`.

const WSTUSR: Address = "0x1202F5C7b4B9E47a1A484E8B270be34dbbC75055";

export async function resolv(): Promise<Opportunity[]> {
  // Resolv updates the rate in steps, so a 30-day window gives a steadier figure than 7 days.
  const [{ apy, rate }, assets] = await Promise.all([
    rateApy(1, WSTUSR, "convertToAssets", 30),
    client(1).readContract({ address: WSTUSR, abi: ABI, functionName: "totalAssets" }),
  ]);
  return [
    {
      id: `resolv:1:${WSTUSR}`,
      protocol: "Resolv",
      name: "Resolv wrapped staked USR (wstUSR)",
      ticker: "wstUSR",
      asset: "USR",
      kind: "Vault",
      category: "Delta-neutral",
      chain: "Ethereum",
      apy,
      apy7d: null,
      apy30d: apy,
      apyNote: "Measured from wstUSR's exchange rate over the last 30 days",
      tvlUsd: Number(assets) / 1e18,
      manager: "Resolv",
      redemption: "Instant",
      stablecoin: true,
      sharePrice: rate,
      url: "https://app.resolv.xyz/",
      address: WSTUSR,
    },
  ];
}

/* ---------------- Kinetiq (kHYPE on HyperEVM) ---------------- */
// Execution: Kinetiq StakingManager `stake()` with HYPE; `queueWithdrawal(amount)` then confirm after the delay.

const KHYPE: Address = "0xfD739d4e423301CE9385c1fb8850539D657C296D";
const KINETIQ_ACCOUNTANT: Address = "0x9209648Ec9D448EF57116B73A2f081835643dc7A";

export async function kinetiq(): Promise<Opportunity[]> {
  const [{ apy, rate }, supply, hype] = await Promise.all([
    rateApy(999, KINETIQ_ACCOUNTANT, "kHYPEToHYPE", 7),
    client(999).readContract({ address: KHYPE, abi: ABI, functionName: "totalSupply" }),
    price(999, ETH),
  ]);
  return [
    {
      id: `kinetiq:999:${KHYPE}`,
      protocol: "Kinetiq",
      name: "Kinetiq staked HYPE (kHYPE)",
      ticker: "kHYPE",
      asset: "HYPE",
      kind: "Liquid staking",
      chain: "HyperEVM",
      apy,
      apy7d: apy,
      apy30d: null,
      apyNote: "Measured from kHYPE's exchange rate over the last 7 days",
      tvlUsd: (Number(supply) / 1e18) * rate * hype,
      manager: "Kinetiq",
      redemption: "Withdrawal queue",
      stablecoin: false,
      sharePrice: rate,
      url: "https://kinetiq.xyz/",
      address: KHYPE,
    },
  ];
}

/* ---------------- Lista DAO (slisBNB on BNB Chain) ---------------- */
// Execution: Lista StakeManager `deposit()` with BNB; `requestWithdraw(amount)` then `claimWithdraw` after the unbonding period.

const SLISBNB: Address = "0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B";
const LISTA_STAKE_MANAGER: Address = "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6";

export async function lista(): Promise<Opportunity[]> {
  const [{ apy, rate }, supply, bnb] = await Promise.all([
    rateApy(56, LISTA_STAKE_MANAGER, "convertSnBnbToBnb", 7),
    client(56).readContract({ address: SLISBNB, abi: ABI, functionName: "totalSupply" }),
    price(56, ETH),
  ]);
  return [
    {
      id: `lista:56:${SLISBNB}`,
      protocol: "Lista DAO",
      name: "Lista staked BNB (slisBNB)",
      ticker: "slisBNB",
      asset: "BNB",
      kind: "Liquid staking",
      chain: "BNB Chain",
      apy,
      apy7d: apy,
      apy30d: null,
      apyNote: "Measured from slisBNB's exchange rate over the last 7 days",
      tvlUsd: (Number(supply) / 1e18) * rate * bnb,
      manager: "Lista DAO",
      redemption: "Withdrawal queue",
      stablecoin: false,
      sharePrice: rate,
      url: "https://lista.org/liquid-staking/BNB",
      address: SLISBNB,
    },
  ];
}

/* ---------------- Spectra (fixed yield) ---------------- */
// Execution: Spectra's Router buys the principal token (PT) for a fixed rate held to maturity; redeem PT at maturity.

type SpectraPt = {
  address: string;
  chainId: number;
  maturity: number;
  tvl?: { usd: number | null };
  underlying?: { symbol: string; price?: { usd: number | null } };
  ibt?: { symbol: string; protocol?: string };
  pools?: { address: string; ptApy?: number; liquidity?: { usd: number | null; underlying?: number } }[];
};
const SPECTRA_NETWORKS = ["mainnet", "base", "arbitrum", "optimism", "sonic", "avalanche", "bsc", "katana", "flare", "hemi"];

export async function spectra(): Promise<Opportunity[]> {
  const lists = await Promise.all(
    SPECTRA_NETWORKS.map((n) => getJson<SpectraPt[]>(`https://api.spectra.finance/v1/${n}/pools`, 30_000).catch(() => [] as SpectraPt[])),
  );
  const now = Date.now() / 1000;
  const out: Opportunity[] = [];
  for (const pt of lists.flat()) {
    if (!pt.underlying || pt.maturity <= now) continue;
    const date = new Date(pt.maturity * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    for (const pool of pt.pools ?? []) {
      const tvl = pool.liquidity?.usd ?? (pt.underlying.price?.usd ? num(pool.liquidity?.underlying) * pt.underlying.price.usd : 0);
      if (pool.ptApy == null || !tvl) continue;
      out.push({
        id: `spectra:${pt.chainId}:${pool.address}`,
        protocol: "Spectra",
        name: `PT ${pt.ibt?.symbol ?? pt.underlying.symbol} · ${date}`,
        ticker: "PT",
        asset: pt.underlying.symbol,
        kind: "Fixed yield",
        category: "Fixed yield",
        chain: evmChainName(pt.chainId),
        apy: pool.ptApy / 100,
        apy7d: null,
        apy30d: null,
        apyNote: "Fixed rate if held to maturity",
        tvlUsd: tvl,
        manager: pt.ibt?.protocol ?? "Spectra",
        redemption: `Maturity ${date}`,
        stablecoin: isStable(pt.underlying.symbol),
        url: "https://app.spectra.finance/fixed-rate",
        address: pt.address,
      });
    }
  }
  return out;
}

/* ---------------- Avantis (perps liquidity vault on Base) ---------------- */
// Execution: Avantis junior vault is ERC-4626 over USDC: `deposit(assets, receiver)`, withdrawals after its lock period.

export async function avantis(): Promise<Opportunity[]> {
  const r = await getJson<{ returns?: { jr?: { base?: number } }; meta?: { totalTvl?: { jr?: number } } }>("https://api.avantisfi.com/v1/vault/returns", 30_000);
  const apr = num(r.returns?.jr?.base) / 100;
  return [
    {
      id: "avantis:8453:junior",
      protocol: "Avantis",
      name: "Avantis USDC vault",
      ticker: "avUSDC",
      asset: "USDC",
      kind: "Perp vault",
      category: "Perps liquidity",
      chain: "Base",
      apy: apr,
      apy7d: null,
      apy30d: null,
      apyNote: "Base APR from trading fees, as reported by Avantis",
      tvlUsd: num(r.meta?.totalTvl?.jr),
      manager: "Avantis",
      redemption: "Lock-up",
      stablecoin: true,
      url: "https://www.avantisfi.com/earn",
    },
  ];
}

/* ---------------- HyperLend (Aave-style lending on HyperEVM) ---------------- */
// Execution: HyperLend Pool `supply(asset, amount, onBehalfOf, 0)` / `withdraw(asset, amount, to)`, the same calls as Aave.

type HyperLendReserve = {
  underlyingAsset: string;
  symbol: string;
  decimals: string;
  isActive: boolean;
  isFrozen: boolean;
  isPaused: boolean;
  aTokenAddress: string;
  liquidityRate: string;
  variableBorrowRate: string;
  variableBorrowIndex: string;
  availableLiquidity: string;
  totalScaledVariableDebt: string;
  priceInMarketReferenceCurrency: string;
  baseLTVasCollateral: string;
  reserveLiquidationThreshold: string;
  reserveLiquidationBonus: string;
  reserveFactor: string;
  usageAsCollateralEnabled: boolean;
  supplyCap: string;
  borrowCap: string;
  baseVariableBorrowRate: string;
  variableRateSlope1: string;
  variableRateSlope2: string;
  optimalUsageRatio: string;
};

export async function hyperlend(): Promise<Opportunity[]> {
  const { reserves } = await getJson<{ reserves: HyperLendReserve[] }>("https://api.hyperlend.finance/data/markets?chain=hyperEvm", 30_000);
  const out: Opportunity[] = [];
  for (const r of reserves) {
    if (!r.isActive || r.isPaused || r.isFrozen) continue;
    const scale = 10 ** num(r.decimals);
    const usd = num(r.priceInMarketReferenceCurrency) / 1e8; // Aave base currency: USD with 8 decimals
    const cash = num(r.availableLiquidity) / scale;
    const debt = ((num(r.totalScaledVariableDebt) / scale) * num(r.variableBorrowIndex)) / RAY;
    const supplied = (cash + debt) * usd;
    if (!supplied) continue;
    const apy = rayToApy(num(r.liquidityRate));
    out.push({
      id: `hyperlend:999:${r.underlyingAsset}`,
      protocol: "HyperLend",
      name: `${r.symbol} lending`,
      ticker: `h${r.symbol}`,
      asset: r.symbol,
      kind: "Lending",
      category: "Lending market",
      chain: "HyperEVM",
      apy,
      apy7d: null,
      apy30d: null,
      tvlUsd: supplied,
      manager: "HyperLend",
      redemption: "Instant (if liquidity)",
      stablecoin: isStable(r.symbol),
      url: "https://app.hyperlend.finance/",
      address: r.aTokenAddress,
      lending: {
        totalSuppliedUsd: supplied,
        totalBorrowedUsd: debt * usd,
        liquidityUsd: cash * usd,
        utilization: cash + debt > 0 ? debt / (cash + debt) : undefined,
        supplyApy: apy,
        borrowApy: rayToApy(num(r.variableBorrowRate)),
        supplyCapUsd: num(r.supplyCap) > 0 ? num(r.supplyCap) * usd : undefined,
        borrowCapUsd: num(r.borrowCap) > 0 ? num(r.borrowCap) * usd : undefined,
        maxLtv: num(r.baseLTVasCollateral) / 10_000,
        liquidationThreshold: num(r.reserveLiquidationThreshold) / 10_000,
        liquidationPenalty: num(r.reserveLiquidationBonus) > 10_000 ? num(r.reserveLiquidationBonus) / 10_000 - 1 : undefined,
        reserveFactor: num(r.reserveFactor) / 10_000,
        canBeCollateral: r.usageAsCollateralEnabled,
        priceUsd: usd,
        rateCurve: twoSlope(
          num(r.baseVariableBorrowRate) / RAY,
          num(r.variableRateSlope1) / RAY,
          num(r.variableRateSlope2) / RAY,
          num(r.optimalUsageRatio) / RAY,
        ),
      },
    });
  }
  return out;
}
