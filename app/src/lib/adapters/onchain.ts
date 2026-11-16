import { createPublicClient, fallback, http, parseAbi, type Address, type PublicClient } from "viem";
import { evmChainName, isStable } from "../chains.ts";
import { getJson, mapLimit, num } from "../http.ts";
import type { Opportunity } from "../types.ts";

/**
 * Protocols with no keyless list API, read straight from their contracts with viem.
 * Every address below was checked on-chain (symbol / asset / base token) before it was added.
 * Each one is executable with a plain contract call, noted per protocol.
 */

/** Public, keyless RPCs: publicnode first (batched), then other public endpoints (unbatched). */
const RPC: Record<number, string[]> = {
  1: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://eth.drpc.org"],
  10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
  100: ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com"],
  130: ["https://unichain-rpc.publicnode.com", "https://mainnet.unichain.org"],
  137: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
  5000: ["https://mantle-rpc.publicnode.com", "https://rpc.mantle.xyz"],
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  42161: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  59144: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build"],
  534352: ["https://scroll-rpc.publicnode.com", "https://rpc.scroll.io"],
};

const clients = new Map<number, PublicClient>();
function client(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    // Some fallbacks reject JSON-RPC batches, so only the first endpoint batches.
    const transport = fallback(RPC[chainId].map((url, i) => http(url, { batch: i === 0, timeout: 20_000, retryCount: 2 })));
    c = createPublicClient({ transport }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

const SECONDS_PER_YEAR = 31_536_000;
const RAY = 1e27;

/** Per-second compounding rate in ray (1e27) → APY fraction (Sky SSR/DSR, Spark VSR). */
const rayRateToApy = (perSecond: bigint) => Math.pow(Number(perSecond) / RAY, SECONDS_PER_YEAR) - 1;

const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const ERC4626 = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function asset() view returns (address)",
]);

/** USD price from LI.FI's open token API (cached for the life of one refresh). */
async function lifiPrice(chainId: number, token: string): Promise<{ price: number; symbol?: string; logo?: string }> {
  const t = await getJson<{ priceUSD?: string; symbol?: string; logoURI?: string }>(
    `https://li.quest/v1/token?chain=${chainId}&token=${token}`,
    20_000,
  ).catch(() => ({}) as { priceUSD?: string; symbol?: string; logoURI?: string });
  return { price: num(t.priceUSD), symbol: t.symbol, logo: t.logoURI };
}

/* ---------------- Compound III (Comet) ---------------- */
// Execution: Comet `supply(asset, amount)` / `withdraw(asset, amount)` after an ERC-20 approve. Plain viem calls.
// (compound-js is not installed: it pins ethers v5 as a peer, which conflicts with @aave/client's ethers v6.)

const COMETS: Record<number, Address[]> = {
  1: [
    "0xc3d688B66703497DAA19211EEdff47f25384cdc3", // cUSDCv3
    "0xA17581A9E3356d9A858b789D68B4d866e593aE94", // cWETHv3
    "0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3", // cWstETHv3
    "0x5D409e56D886231aDAf00c8775665AD0f9897b56", // cUSDSv3
    "0xe85Dc543813B8c2CFEaAc371517b925a166a9293", // cWBTCv3
  ],
  8453: [
    "0xb125E6687d4313864e53df431d5425969c15Eb2F", // cUSDCv3
    "0x46e6b214b524310239732D51387075E0e70970bf", // cWETHv3
    "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", // cUSDbCv3
    "0x784efeB622244d2348d4F2522f8860B96fbEcE89", // cAEROv3
    "0x2c776041CCFe903071AF44aa147368a9c8EEA518", // cUSDSv3
  ],
  42161: [
    "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", // cUSDCv3
    "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA", // cUSDCev3
    "0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486", // cWETHv3
    "0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07", // cUSDTv3
  ],
  10: [
    "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB", // cUSDCv3
    "0x995E394b8B2437aC8Ce61Ee0bC610D617962B214", // cUSDTv3
    "0xE36A30D249f7761327fd973001A32010b521b6Fd", // cWETHv3
  ],
  137: [
    "0xF25212E676D1F7F89Cd72fFEe66158f541246445", // cUSDCv3
    "0xaeB318360f27748Acb200CE616E389A6C9409a07", // cUSDTv3
  ],
  130: ["0x2c7118c4C88B9841FCF839074c26Ae8f035f2921", "0x6C987dDE50dB1dcDd32Cd4175778C2a291978E2a"],
  59144: ["0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991", "0x60F2058379716A64a7A5d29219397e79bC552194"],
  534352: ["0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44"],
  5000: ["0x606174f62cd968d8e684c645080fa694c1D7786E"],
};

const COMET = parseAbi([
  "function baseToken() view returns (address)",
  "function symbol() view returns (string)",
  "function getUtilization() view returns (uint64)",
  "function getSupplyRate(uint256) view returns (uint64)",
  "function getBorrowRate(uint256) view returns (uint64)",
  "function totalSupply() view returns (uint256)",
  "function totalBorrow() view returns (uint256)",
  "function isSupplyPaused() view returns (bool)",
  "function isWithdrawPaused() view returns (bool)",
]);

/** Comet rates are per second, 1e18-scaled. */
const cometApy = (perSecond: bigint) => Math.pow(1 + Number(perSecond) / 1e18, SECONDS_PER_YEAR) - 1;

export async function compound(): Promise<Opportunity[]> {
  const markets = Object.entries(COMETS).flatMap(([c, list]) => list.map((address) => ({ chainId: Number(c), address })));
  const res = await mapLimit(markets, 6, async ({ chainId, address }) => {
    const p = client(chainId);
    const read = <T>(functionName: string, args: unknown[] = []) =>
      p.readContract({ address, abi: COMET, functionName, args } as never) as Promise<T>;
    const [base, symbol, util, supply, borrow, supplyPaused, withdrawPaused] = await Promise.all([
      read<Address>("baseToken"),
      read<string>("symbol"),
      read<bigint>("getUtilization"),
      read<bigint>("totalSupply"),
      read<bigint>("totalBorrow"),
      read<boolean>("isSupplyPaused"),
      read<boolean>("isWithdrawPaused"),
    ]);
    const [supplyRate, borrowRate, decimals, info] = await Promise.all([
      read<bigint>("getSupplyRate", [util]),
      read<bigint>("getBorrowRate", [util]),
      p.readContract({ address: base, abi: ERC20, functionName: "decimals" }),
      lifiPrice(chainId, base),
    ]);
    const asset = info.symbol ?? (await p.readContract({ address: base, abi: ERC20, functionName: "symbol" }));
    const scale = 10 ** Number(decimals);
    const suppliedUsd = (Number(supply) / scale) * info.price;
    const borrowedUsd = (Number(borrow) / scale) * info.price;
    const apy = cometApy(supplyRate);
    return {
      id: `compound:${chainId}:${address}`,
      ...(withdrawPaused
        ? { status: "paused" as const, statusReason: "Paused by Compound: withdrawals are stopped for now." }
        : supplyPaused
          ? { status: "withdraw-only" as const, statusReason: "Compound has paused new deposits. You can still withdraw." }
          : {}),
      protocol: "Compound",
      name: `${asset} lending (${symbol})`,
      ticker: symbol,
      asset,
      kind: "Lending",
      category: "Compound III",
      chain: evmChainName(chainId),
      apy,
      apy7d: null,
      apy30d: null,
      tvlUsd: suppliedUsd,
      manager: "Compound",
      redemption: "Instant (if liquidity)",
      stablecoin: isStable(asset),
      url: "https://app.compound.finance/",
      address,
      assetLogo: info.logo,
      lending: {
        totalSuppliedUsd: suppliedUsd,
        totalBorrowedUsd: borrowedUsd,
        liquidityUsd: Math.max(0, suppliedUsd - borrowedUsd),
        utilization: Number(util) / 1e18,
        supplyApy: apy,
        borrowApy: cometApy(borrowRate),
        priceUsd: info.price || undefined,
      },
    } satisfies Opportunity;
  });
  const out = res.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  if (out.length === 0) throw new Error("No Comet market could be read");
  return out;
}

/* ---------------- Sky (sUSDS, sDAI on Ethereum) ---------------- */
// Execution: both are ERC-4626, so `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`.

const SUSDS: Address = "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD";
const SDAI: Address = "0x83F20F44975D03b1b09e64809B757c47f942BEeA";
const SKY_ABI = parseAbi(["function ssr() view returns (uint256)", "function pot() view returns (address)", "function dsr() view returns (uint256)"]);

/** Sky Savings Rate (per second, ray) → APY. Spark's L2 sUSDS earns the same rate. */
async function skySavingsApy(): Promise<number> {
  return rayRateToApy(await client(1).readContract({ address: SUSDS, abi: SKY_ABI, functionName: "ssr" }));
}

export async function sky(): Promise<Opportunity[]> {
  const p = client(1);
  const [ssrApy, susdsAssets, sdaiAssets, pot] = await Promise.all([
    skySavingsApy(),
    p.readContract({ address: SUSDS, abi: ERC4626, functionName: "totalAssets" }),
    p.readContract({ address: SDAI, abi: ERC4626, functionName: "totalAssets" }),
    p.readContract({ address: SDAI, abi: SKY_ABI, functionName: "pot" }),
  ]);
  const dsrApy = rayRateToApy(await p.readContract({ address: pot, abi: SKY_ABI, functionName: "dsr" }));
  const base = { kind: "Vault", category: "Savings rate", chain: "Ethereum", apy7d: null, apy30d: null, manager: "Sky", redemption: "Instant", stablecoin: true } as const;
  return [
    {
      ...base,
      id: `sky:1:${SUSDS}`,
      protocol: "Sky",
      name: "Sky Savings USDS (sUSDS)",
      ticker: "sUSDS",
      asset: "USDS",
      apy: ssrApy,
      apyNote: "Sky Savings Rate",
      tvlUsd: Number(susdsAssets) / 1e18,
      url: "https://app.sky.money/",
      address: SUSDS,
    },
    {
      ...base,
      id: `sky:1:${SDAI}`,
      protocol: "Sky",
      name: "Savings DAI (sDAI)",
      ticker: "sDAI",
      asset: "DAI",
      apy: dsrApy,
      apyNote: "DAI Savings Rate",
      tvlUsd: Number(sdaiAssets) / 1e18,
      url: "https://app.sky.money/",
      address: SDAI,
    },
  ];
}

/* ---------------- Ethena (sUSDe on Ethereum) ---------------- */
// Execution: sUSDe is ERC-4626, so `deposit(assets, receiver)` stakes USDe. Unstaking goes through Ethena's cooldown
// (`cooldownShares`, then `unstake` once it ends); the cooldown length is read live from the contract.

const SUSDE: Address = "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497";
const ETHENA_ABI = parseAbi(["function cooldownDuration() view returns (uint24)"]);
type EthenaYield = { value?: number };

export async function ethena(): Promise<Opportunity[]> {
  const p = client(1);
  const [assets, cooldown, y] = await Promise.all([
    p.readContract({ address: SUSDE, abi: ERC4626, functionName: "totalAssets" }),
    p.readContract({ address: SUSDE, abi: ETHENA_ABI, functionName: "cooldownDuration" }),
    // Ethena's own yield feed, in percent.
    getJson<{ stakingYield?: EthenaYield; avg30dSusdeYield?: EthenaYield }>("https://ethena.fi/api/yields/protocol-and-staking-yield"),
  ]);
  const days = Math.round(Number(cooldown) / 86_400);
  return [
    {
      id: `ethena:1:${SUSDE}`,
      protocol: "Ethena",
      name: "Ethena Staked USDe (sUSDe)",
      ticker: "sUSDe",
      asset: "USDe",
      kind: "Vault",
      category: "Delta-neutral",
      chain: "Ethereum",
      apy: y.stakingYield?.value != null ? y.stakingYield.value / 100 : null,
      apy7d: null,
      apy30d: y.avg30dSusdeYield?.value != null ? y.avg30dSusdeYield.value / 100 : null,
      apyNote: "Funding and basis from Ethena's hedged positions, plus staking yield on its collateral",
      tvlUsd: Number(assets) / 1e18,
      manager: "Ethena",
      redemption: Number(cooldown) === 0 ? "Instant" : `${days}-day cooldown`,
      stablecoin: true,
      url: "https://app.ethena.fi/earn",
      address: SUSDE,
    },
  ];
}

/* ---------------- Spark (SparkLend + Spark Savings) ---------------- */
// Execution:
//  - SparkLend is an Aave v3 fork: Pool `supply(asset, amount, onBehalfOf, 0)` / `withdraw(asset, amount, to)`.
//  - Spark Savings vaults (sUSDC, spUSDC, spUSDT) are ERC-4626: `deposit` / `redeem`.
//  - sUSDS on L2s: PSM3 `swapExactIn(USDC → sUSDS)` and back.
// Spark's Morpho vaults are already listed through the Morpho adapter, so they are not repeated here.

const SPARK_POOLS: { chainId: number; pool: Address }[] = [
  { chainId: 1, pool: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987" },
  { chainId: 100, pool: "0x2Dae5307c5E3FD1CF5A72Cb6F698f915860607e0" },
];

const POOL = parseAbi([
  "function getReservesList() view returns (address[])",
  "function ADDRESSES_PROVIDER() view returns (address)",
  "function getReserveData(address) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
]);
const PROVIDER = parseAbi(["function getPriceOracle() view returns (address)"]);
const ORACLE = parseAbi(["function getAssetPrice(address) view returns (uint256)", "function BASE_CURRENCY_UNIT() view returns (uint256)"]);

/** Bits of an Aave v3 reserve configuration word. */
const bits = (cfg: bigint, from: number, len: number) => Number((cfg >> BigInt(from)) & ((BigInt(1) << BigInt(len)) - BigInt(1)));
/** Aave liquidity rate (APR in ray) → APY with per-second compounding. */
const aaveRateToApy = (rate: bigint) => Math.pow(1 + Number(rate) / RAY / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;

async function sparkLend(chainId: number, pool: Address): Promise<Opportunity[]> {
  const p = client(chainId);
  const [assets, provider] = await Promise.all([
    p.readContract({ address: pool, abi: POOL, functionName: "getReservesList" }),
    p.readContract({ address: pool, abi: POOL, functionName: "ADDRESSES_PROVIDER" }),
  ]);
  const oracle = await p.readContract({ address: provider, abi: PROVIDER, functionName: "getPriceOracle" });
  const unit = Number(await p.readContract({ address: oracle, abi: ORACLE, functionName: "BASE_CURRENCY_UNIT" }));
  const res = await mapLimit([...assets], 6, async (asset) => {
    const [d, price, symbol, decimals] = await Promise.all([
      p.readContract({ address: pool, abi: POOL, functionName: "getReserveData", args: [asset] }),
      p.readContract({ address: oracle, abi: ORACLE, functionName: "getAssetPrice", args: [asset] }),
      p.readContract({ address: asset, abi: ERC20, functionName: "symbol" }),
      p.readContract({ address: asset, abi: ERC20, functionName: "decimals" }),
    ]);
    const cfg = d.configuration;
    const active = bits(cfg, 56, 1) === 1;
    const frozen = bits(cfg, 57, 1) === 1;
    const paused = bits(cfg, 60, 1) === 1;
    const [aSupply, vDebt] = await Promise.all([
      p.readContract({ address: d.aTokenAddress, abi: ERC20, functionName: "totalSupply" }),
      p.readContract({ address: d.variableDebtTokenAddress, abi: ERC20, functionName: "totalSupply" }),
    ]);
    const px = Number(price) / unit;
    const scale = 10 ** Number(decimals);
    const supplied = (Number(aSupply) / scale) * px;
    const borrowed = (Number(vDebt) / scale) * px;
    const capTokens = bits(cfg, 116, 36);
    const apy = aaveRateToApy(d.currentLiquidityRate);
    return {
      id: `spark:${chainId}:${asset}`,
      ...(paused || !active
        ? { status: "paused" as const, statusReason: "Paused by Spark: deposits and withdrawals are stopped for now." }
        : frozen
          ? { status: "withdraw-only" as const, statusReason: "Frozen by Spark governance: no new deposits. You can still withdraw." }
          : {}),
      protocol: "Spark",
      name: `${symbol} lending`,
      asset: symbol,
      kind: "Lending",
      category: "SparkLend",
      chain: evmChainName(chainId),
      apy,
      apy7d: null,
      apy30d: null,
      tvlUsd: supplied,
      manager: "Spark",
      redemption: "Instant (if liquidity)",
      stablecoin: isStable(symbol),
      url: "https://app.spark.fi/",
      address: asset,
      lending: {
        totalSuppliedUsd: supplied,
        totalBorrowedUsd: borrowed,
        liquidityUsd: Math.max(0, supplied - borrowed),
        utilization: supplied > 0 ? borrowed / supplied : 0,
        supplyApy: apy,
        borrowApy: aaveRateToApy(d.currentVariableBorrowRate),
        supplyCapUsd: capTokens > 0 ? capTokens * px : undefined,
        maxLtv: bits(cfg, 0, 16) / 10_000 || undefined,
        liquidationThreshold: bits(cfg, 16, 16) / 10_000 || undefined,
        liquidationPenalty: bits(cfg, 32, 16) > 10_000 ? bits(cfg, 32, 16) / 10_000 - 1 : undefined,
        canBeCollateral: bits(cfg, 0, 16) > 0,
        reserveFactor: bits(cfg, 64, 16) / 10_000,
        priceUsd: px,
      },
    } satisfies Opportunity;
  });
  return res.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}

/** Spark Savings vaults on Ethereum. sUSDC earns the SSR; spUSDC / spUSDT have their own vault rate (vsr). */
const SPARK_SAVINGS: { address: Address; ticker: string; asset: string; rate: "ssr" | "vsr" }[] = [
  { address: "0xBc65ad17c5C0a2A4D159fa5a503f4992c7B545FE", ticker: "sUSDC", asset: "USDC", rate: "ssr" },
  { address: "0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d", ticker: "spUSDC", asset: "USDC", rate: "vsr" },
  { address: "0xe2e7a17dFf93280dec073C995595155283e3C372", ticker: "spUSDT", asset: "USDT", rate: "vsr" },
];
const SAVINGS_RATE = parseAbi(["function ssr() view returns (uint256)", "function vsr() view returns (uint256)"]);

/** Spark's PSM3 on each L2 swaps USDC/USDS ↔ sUSDS at the Sky Savings Rate. */
const SPARK_PSM3: { chainId: number; psm: Address; susds: Address }[] = [
  { chainId: 8453, psm: "0x1601843c5E9bC251A3272907010AFa41Fa18347E", susds: "0x5875eEE11Cf8398102FdAd704C9E96607675467a" },
  { chainId: 42161, psm: "0x2B05F8e1cACC6974fD79A673a341Fe1f58d27266", susds: "0xdDb46999F8891663a8F2828d25298f70416d7610" },
  { chainId: 10, psm: "0xe0F9978b907853F354d79188A3dEfbD41978af62", susds: "0xb5B2dc7fd34C249F4be7fB1fCea07950784229e0" },
  { chainId: 130, psm: "0x7b42Ed932f26509465F7cE3FAF76FfCe1275312f", susds: "0xA06b10Db9F390990364A3984C04FaDf1c13691b5" },
];

async function sparkSavings(): Promise<Opportunity[]> {
  const p = client(1);
  const ssrApy = await skySavingsApy();
  const savings = await mapLimit(SPARK_SAVINGS, 3, async (v) => {
    const [rate, total, decimals] = await Promise.all([
      p.readContract({ address: v.address, abi: SAVINGS_RATE, functionName: v.rate }),
      p.readContract({ address: v.address, abi: ERC4626, functionName: "totalAssets" }),
      p.readContract({ address: await p.readContract({ address: v.address, abi: ERC4626, functionName: "asset" }), abi: ERC20, functionName: "decimals" }),
    ]);
    return {
      id: `spark:1:${v.address}`,
      protocol: "Spark",
      name: `Spark Savings ${v.asset} (${v.ticker})`,
      ticker: v.ticker,
      asset: v.asset,
      kind: "Vault",
      category: "Savings rate",
      chain: "Ethereum",
      apy: rayRateToApy(rate),
      apyNote: v.rate === "ssr" ? "Sky Savings Rate" : "Spark vault savings rate",
      apy7d: null,
      apy30d: null,
      tvlUsd: Number(total) / 10 ** Number(decimals),
      manager: "Spark",
      redemption: "Instant (if liquidity)",
      stablecoin: true,
      url: "https://app.spark.fi/",
      address: v.address,
    } satisfies Opportunity;
  });
  // USDS per sUSDS, from the mainnet vault; L2 sUSDS is the same token bridged.
  const usdsPerShare = Number(await p.readContract({ address: SUSDS, abi: ERC4626, functionName: "convertToAssets", args: [BigInt(1e18)] })) / 1e18;
  const l2 = await mapLimit(SPARK_PSM3, 4, async (s) => {
    const supply = await client(s.chainId).readContract({ address: s.susds, abi: ERC20, functionName: "totalSupply" });
    return {
      id: `spark:${s.chainId}:${s.susds}`,
      protocol: "Spark",
      name: "Savings USDS (sUSDS)",
      ticker: "sUSDS",
      asset: "USDC",
      kind: "Vault",
      category: "Savings rate",
      chain: evmChainName(s.chainId),
      apy: ssrApy,
      apyNote: "Sky Savings Rate",
      apy7d: null,
      apy30d: null,
      tvlUsd: (Number(supply) / 1e18) * usdsPerShare,
      manager: "Sky",
      redemption: "Instant (PSM swap)",
      stablecoin: true,
      url: "https://app.spark.fi/",
      address: s.susds,
      details: [{ label: "Deposit route", value: `Spark PSM3 ${s.psm} (USDC or USDS → sUSDS)` }],
    } satisfies Opportunity;
  });
  return [...savings, ...l2].flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

export async function spark(): Promise<Opportunity[]> {
  const parts = await Promise.allSettled([...SPARK_POOLS.map((s) => sparkLend(s.chainId, s.pool)), sparkSavings()]);
  const out = parts.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (out.length === 0) throw new Error(parts.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason?.message ?? "Spark returned nothing");
  return out;
}
