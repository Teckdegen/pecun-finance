import { isStable } from "../chains.ts";
import { getJson, mapLimit, num, numOrNull } from "../http.ts";
import type { Opportunity } from "../types.ts";

/* ---------------- Ember (v2 API: every vault, every chain) ---------------- */

type EmberApy = { reportedApyE9?: string | null; rewardApyE9?: string | null };
type EmberCoin = { symbol: string; logoUrl?: string; name?: string; priceE9?: string };
type EmberDeployment = {
  address: string;
  chainIdentifier: string;
  status: string;
  baseDepositCoin: EmberCoin;
  receiptCoin?: EmberCoin;
  totalDepositsInUsdE9: string | null;
  activeDepositorsCount?: string;
  instantWithdrawConfig?: {
    atomicVaultAddress: string;
    availableCapacityInUsdE9?: string;
    effectiveFeePercentageE18?: string;
    holdbackPercentageE18?: string;
  }[] | null;
};
type EmberVaultV2 = {
  id: string;
  name: string;
  status: string;
  isPrivate: boolean;
  category?: string;
  strategy?: string;
  description?: string;
  createdAt?: number | string;
  logoUrl?: string;
  managers: { name: string; logoUrl?: string; websiteUrl?: string }[] | null;
  withdrawalPeriod: string | null;
  withdrawalPeriodDays: number | null;
  priceUpdatesFrequencyRemarks?: string;
  managementFeePercentE18?: string;
  weeklyPerformanceFeeBpsE9?: string;
  rateE18?: string;
  maxDepositsAllowedE18?: string;
  reportedApy: EmberApy | null;
  apyAverages: Record<string, EmberApy> | null;
  defiIntegrations?: { appName: string; chain?: string; description: string; logoUrl?: string; url: string }[];
  tags?: { slug: string }[];
  detailsByChain: Record<string, EmberDeployment>;
};

const fmtPct = (f: number) => `${(f * 100).toFixed(f * 100 % 1 === 0 ? 0 : 2)}%`;

const EMBER_CHAIN: Record<string, string> = {
  ethereum: "Ethereum", sui: "Sui", arbitrum: "Arbitrum", base: "Base", monad: "Monad", pharos: "Pharos", canton: "Canton",
};

/** Ember shows APY as reported yield plus reward yield. E9 = fraction × 1e9. */
const emberApy = (a?: EmberApy | null) =>
  a && (a.reportedApyE9 || a.rewardApyE9) ? (num(a.reportedApyE9) + num(a.rewardApyE9)) / 1e9 : null;

export async function ember(): Promise<Opportunity[]> {
  // v1 only returns Sui vaults; v2 returns all vaults with a per-chain breakdown.
  const [vaults, chains] = await Promise.all([
    getJson<EmberVaultV2[]>("https://vaults.api.sui-prod.bluefin.io/api/v2/vaults"),
    getJson<{ identifier: string; logoUrl?: string }[]>("https://vaults.api.sui-prod.bluefin.io/api/v2/vaults/supported-chains").catch(
      () => [] as { identifier: string; logoUrl?: string }[],
    ),
  ]);
  const chainLogo = new Map(chains.map((c) => [c.identifier, c.logoUrl]));
  const out: Opportunity[] = [];
  for (const v of vaults) {
    if (v.isPrivate || (v.status !== "active" && v.status !== "beta")) continue;
    const apy30d = emberApy(v.apyAverages?.["30d"]);
    const apy7d = emberApy(v.apyAverages?.["7d"]);
    const days = v.withdrawalPeriodDays ?? 0;
    const redemption =
      v.withdrawalPeriod?.trim() ||
      (days <= 0 ? "Instant" : days === 1 ? "1 day" : days % 7 === 0 ? `${days / 7} week${days > 7 ? "s" : ""}` : `${days} days`);
    const perfFee = num(v.weeklyPerformanceFeeBpsE9) / 1e9;
    const mgmtFee = num(v.managementFeePercentE18) / 1e18;
    const rate = num(v.rateE18) / 1e18; // shares per unit of deposit asset
    const reward30 = num(v.apyAverages?.["30d"]?.rewardApyE9) / 1e9;
    const created = v.createdAt ? new Date(Number(v.createdAt)) : null;
    const featured = v.category === "Featured" || !!v.tags?.some((t) => t.slug === "featured" || t.slug === "highlighted");
    const redemptionLabel = /^0\s|^none$/i.test(redemption) ? "Instant" : redemption;
    for (const [key, d] of Object.entries(v.detailsByChain ?? {})) {
      if (d.status !== "active") continue;
      const asset = d.baseDepositCoin?.symbol ?? "?";
      const ticker = d.receiptCoin?.symbol;
      const chain = EMBER_CHAIN[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
      out.push({
        id: `ember:${key}:${d.address}`,
        protocol: "Ember",
        name: v.name,
        ticker,
        asset,
        kind: "Vault",
        category: v.strategy || undefined,
        chain,
        apy: apy30d ?? apy7d ?? emberApy(v.reportedApy),
        apy7d,
        apy30d,
        rewardApy: reward30 || null,
        tvlUsd: num(d.totalDepositsInUsdE9) / 1e9,
        manager: v.managers?.map((m) => m.name).join(" · ") || "Ember",
        managers: v.managers?.map((m) => ({ name: m.name, logoUrl: m.logoUrl })) ?? [],
        redemption: redemptionLabel,
        stablecoin: isStable(asset),
        featured,
        url: ticker ? `https://ember.so/earn/${ticker}` : "https://ember.so/earn",
        address: d.address,
        description: v.description || undefined,
        sharePrice: rate > 0 ? 1 / rate : undefined,
        capUsd: v.maxDepositsAllowedE18 && d.baseDepositCoin?.priceE9
          ? (num(v.maxDepositsAllowedE18) / 1e18) * (num(d.baseDepositCoin.priceE9) / 1e9)
          : undefined,
        details: [
          ...(v.category ? [{ label: "Vault type", value: v.category }] : []),
          ...(v.strategy ? [{ label: "Strategy", value: v.strategy }] : []),
          { label: "Deposit asset", value: asset },
          ...(ticker ? [{ label: "Vault token", value: ticker }] : []),
          { label: "Performance fee", value: fmtPct(perfFee) },
          { label: "Management fee", value: fmtPct(mgmtFee) },
          ...(v.priceUpdatesFrequencyRemarks ? [{ label: "Price updates", value: v.priceUpdatesFrequencyRemarks }] : []),
          { label: "Yield type", value: "Share-based growth" },
          { label: "Withdrawal duration", value: redemptionLabel },
          ...(d.activeDepositorsCount ? [{ label: "Depositors", value: Number(d.activeDepositorsCount).toLocaleString() }] : []),
          ...(created ? [{ label: "Deployment date", value: created.toLocaleDateString("en-GB") }] : []),
        ],
        integrations: (v.defiIntegrations ?? []).map((i) => ({
          name: i.appName,
          description: i.description,
          url: i.url,
          logoUrl: i.logoUrl,
          chain: i.chain ? (EMBER_CHAIN[i.chain] ?? i.chain) : undefined,
        })),
        ref: { source: "ember", id: v.id },
        instantExit: (() => {
          const a = d.instantWithdrawConfig?.[0];
          if (!a) return undefined;
          return {
            via: "Ember Atomic",
            instantPct: 1 - num(a.holdbackPercentageE18) / 1e18,
            feePct: num(a.effectiveFeePercentageE18) / 1e18,
            capacityUsd: num(a.availableCapacityInUsdE9) / 1e9,
            settlement: redemptionLabel,
            facilityAddress: a.atomicVaultAddress,
          };
        })(),
        logoUrl: v.logoUrl,
        assetLogo: d.baseDepositCoin?.logoUrl,
        chainLogo: chainLogo.get(key),
      });
    }
  }
  return out;
}

/* ---------------- NAVI (Sui lending) ---------------- */

type NaviPool = {
  id: number;
  isDeprecated: boolean;
  token: { symbol: string; decimals: number; price: number | string };
  totalSupplyAmount: string;
  supplyIncentiveApyInfo?: { apy?: string | number; vaultApr?: string | number } | null;
  currentSupplyRate: string;
  currentBorrowRate?: string;
  borrowedAmount?: string;
  ltv?: string;
  supplyCapCeiling?: string;
};

export async function navi(): Promise<Opportunity[]> {
  const res = await getJson<{ data: NaviPool[] } | NaviPool[]>("https://open-api.naviprotocol.io/api/navi/pools");
  const pools = Array.isArray(res) ? res : res.data;
  return pools
    .map((p) => {
      // totalSupplyAmount is scaled by 1e9 on NAVI; supply rate is a ray (1e27).
      const tvlUsd = (num(p.totalSupplyAmount) / 1e9) * num(p.token.price);
      const incentive = numOrNull(p.supplyIncentiveApyInfo?.apy);
      const base = num(p.currentSupplyRate) / 1e27;
      const apy = incentive !== null ? incentive / 100 : base;
      const asset = p.token.symbol;
      return {
        id: `navi:sui:${p.id}`,
        ...(p.isDeprecated ? { status: "withdraw-only" as const, statusReason: "Deprecated by NAVI. You can still withdraw." } : {}),
        protocol: "NAVI",
        name: `${asset} lending`,
        asset,
        kind: "Lending",
        chain: "Sui",
        apy,
        apy7d: null,
        apy30d: null,
        tvlUsd,
        manager: "NAVI",
        redemption: "Instant",
        stablecoin: isStable(asset),
        url: "https://app.naviprotocol.io/",
        lending: (() => {
          const px = num(p.token.price);
          const supplied = num(p.totalSupplyAmount) / 1e9;
          const borrowed = num(p.borrowedAmount) / 1e9;
          return {
            totalSuppliedUsd: supplied * px,
            totalBorrowedUsd: borrowed * px,
            liquidityUsd: Math.max(0, supplied - borrowed) * px,
            utilization: supplied > 0 ? borrowed / supplied : undefined,
            supplyApy: apy,
            borrowApy: p.currentBorrowRate ? num(p.currentBorrowRate) / 1e27 : undefined,
            maxLtv: p.ltv ? num(p.ltv) / 1e27 : undefined,
            canBeCollateral: p.ltv ? num(p.ltv) > 0 : undefined,
            priceUsd: px || undefined,
          };
        })(),
      } satisfies Opportunity;
    });
}

/* ---------------- Scallop (Sui lending) ---------------- */

type ScallopPool = {
  symbol: string; coinType: string; coinPrice: number; supplyApy: number; supplyCoin: number;
  borrowApy?: number; borrowCoin?: number; utilizationRate?: number; reserveFactor?: number;
  baseBorrowApr?: number; midKink?: number; borrowAprOnMidKink?: number; highKink?: number; borrowAprOnHighKink?: number; maxBorrowApr?: number;
};

export async function scallop(): Promise<Opportunity[]> {
  const d = await getJson<{ pools: ScallopPool[] }>("https://sdk.api.scallop.io/api/market/migrate");
  return d.pools.map((p) => ({
    id: `scallop:sui:${p.coinType}`,
    protocol: "Scallop",
    name: `${p.symbol} lending`,
    asset: p.symbol,
    kind: "Lending",
    chain: "Sui",
    apy: num(p.supplyApy),
    apy7d: null,
    apy30d: null,
    tvlUsd: num(p.supplyCoin) * num(p.coinPrice),
    manager: "Scallop",
    redemption: "Instant",
    stablecoin: isStable(p.symbol),
    url: "https://app.scallop.io/",
    lending: {
      totalSuppliedUsd: num(p.supplyCoin) * num(p.coinPrice),
      totalBorrowedUsd: num(p.borrowCoin) * num(p.coinPrice),
      liquidityUsd: Math.max(0, num(p.supplyCoin) - num(p.borrowCoin)) * num(p.coinPrice),
      utilization: p.utilizationRate,
      supplyApy: num(p.supplyApy),
      borrowApy: p.borrowApy,
      reserveFactor: p.reserveFactor,
      priceUsd: p.coinPrice || undefined,
      rateCurve: p.midKink !== undefined && p.highKink !== undefined
        ? [[0, num(p.baseBorrowApr)], [num(p.midKink), num(p.borrowAprOnMidKink)], [num(p.highKink), num(p.borrowAprOnHighKink)], [1, num(p.maxBorrowApr)]]
        : undefined,
    },
  }));
}

/* ---------------- Kamino (Solana lending reserves + earn vaults) ---------------- */

type KaminoMarket = { name: string; lendingMarket: string; isVisibleInUi?: boolean };
type KaminoReserve = { reserve: string; liquidityToken: string; supplyApy: string; totalSupplyUsd: string; borrowApy?: string; totalBorrowUsd?: string; maxLtv?: string };
type KaminoKVault = { address: string; state: { name?: string; tokenMint: string } };
type KaminoKVaultMetrics = { apy7d?: string; apy30d?: string; apy24h?: string; tokensInvestedUsd?: string; tokensAvailableUsd?: string };

const SOL_MINTS: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": "PYUSD",
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": "USDG",
  JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD: "JupUSD",
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: "USDS",
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": "PENGU",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JitoSOL",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: "cbBTC",
};

export async function kamino(): Promise<Opportunity[]> {
  const markets = (await getJson<KaminoMarket[]>("https://api.kamino.finance/v2/kamino-market")).filter((m) => m.isVisibleInUi !== false);
  const reserveResults = await mapLimit(markets, 8, async (m) => ({
    m,
    reserves: await getJson<KaminoReserve[]>(`https://api.kamino.finance/kamino-market/${m.lendingMarket}/reserves/metrics`),
  }));
  const out: Opportunity[] = [];
  for (const r of reserveResults) {
    if (r.status !== "fulfilled") continue;
    const { m, reserves } = r.value;
    for (const res of reserves) {
      out.push({
        id: `kamino:solana:${res.reserve}`,
        protocol: "Kamino",
        name: `${res.liquidityToken} lending · ${m.name}`,
        asset: res.liquidityToken,
        kind: "Lending",
        chain: "Solana",
        apy: num(res.supplyApy),
        apy7d: null,
        apy30d: null,
        tvlUsd: num(res.totalSupplyUsd),
        manager: m.name.replace(/ Market$/, "") || "Kamino",
        redemption: "Instant",
        stablecoin: isStable(res.liquidityToken),
        url: `https://app.kamino.finance/lending/reserve/${m.lendingMarket}/${res.reserve}`,
        lending: (() => {
          const sup = num(res.totalSupplyUsd);
          const bor = num(res.totalBorrowUsd);
          return {
            totalSuppliedUsd: sup,
            totalBorrowedUsd: bor,
            liquidityUsd: Math.max(0, sup - bor),
            utilization: sup > 0 ? bor / sup : undefined,
            supplyApy: num(res.supplyApy),
            borrowApy: numOrNull(res.borrowApy) ?? undefined,
            maxLtv: numOrNull(res.maxLtv) ?? undefined,
            canBeCollateral: numOrNull(res.maxLtv) !== null ? num(res.maxLtv) > 0 : undefined,
          };
        })(),
      });
    }
  }

  // Earn vaults: list + per-vault metrics (APY / TVL).
  const kvaults = await getJson<KaminoKVault[]>("https://api.kamino.finance/kvaults/vaults").catch(() => [] as KaminoKVault[]);
  const metrics = await mapLimit(kvaults, 12, async (v) => ({
    v,
    m: await getJson<KaminoKVaultMetrics>(`https://api.kamino.finance/kvaults/${v.address}/metrics`, 20_000),
  }));
  for (const r of metrics) {
    if (r.status !== "fulfilled") continue;
    const { v, m } = r.value;
    const asset = SOL_MINTS[v.state.tokenMint] ?? "Token";
    const name = (v.state.name ?? "").replace(/\u0000/g, "").trim() || `Kamino ${asset} vault`;
    out.push({
      id: `kamino:solana:kv:${v.address}`,
      protocol: "Kamino",
      name,
      asset,
      kind: "Vault",
      chain: "Solana",
      apy: numOrNull(m.apy24h) ?? numOrNull(m.apy7d),
      apy7d: numOrNull(m.apy7d),
      apy30d: numOrNull(m.apy30d),
      tvlUsd: num(m.tokensInvestedUsd) + num(m.tokensAvailableUsd),
      manager: /sentora/i.test(name) ? "Sentora" : name.split(" ")[0] || "Kamino",
      redemption: "Instant",
      stablecoin: isStable(asset),
      url: `https://app.kamino.finance/earn/lend/${v.address}`,
    });
  }
  return out;
}

/* ---------------- Jupiter Lend (Solana) ---------------- */

type JupToken = {
  address: string;
  name: string;
  asset: { symbol: string; decimals: number; price: string };
  totalAssets: string;
  totalRate: string;
};

export async function jupiterLend(): Promise<Opportunity[]> {
  const d = await getJson<JupToken[]>("https://lite-api.jup.ag/lend/v1/earn/tokens");
  return d.map((t) => ({
    id: `jupiter:solana:${t.address}`,
    protocol: "Jupiter Lend",
    name: `${t.asset.symbol} earn`,
    asset: t.asset.symbol,
    kind: "Lending",
    chain: "Solana",
    apy: num(t.totalRate) / 10_000, // basis points
    apy7d: null,
    apy30d: null,
    tvlUsd: (num(t.totalAssets) / 10 ** t.asset.decimals) * num(t.asset.price),
    manager: "Jupiter",
    redemption: "Instant",
    stablecoin: isStable(t.asset.symbol),
    url: "https://jup.ag/lend/earn",
  }));
}

/* ---------------- Hyperliquid (all open vaults) ---------------- */

type HlVault = { apr: number; summary: { name: string; vaultAddress: string; tvl: string; isClosed: boolean; leader: string } };

export async function hyperliquid(): Promise<Opportunity[]> {
  // Large response (9k+ vaults): give it more time; the catalog loads it in the background.
  const d = await getJson<HlVault[]>("https://stats-data.hyperliquid.xyz/Mainnet/vaults", 150_000);
  return d
    .filter((v) => !v.summary.isClosed && num(v.summary.tvl) >= 1_000)
    .map((v) => {
      const isHlp = /hyperliquidity provider|^hlp/i.test(v.summary.name);
      return {
        id: `hyperliquid:${v.summary.vaultAddress}`,
        protocol: "Hyperliquid",
        name: v.summary.name,
        asset: "USDC",
        kind: "Perp vault",
        chain: "Hyperliquid",
        apy: num(v.apr),
        apy7d: null,
        apy30d: null,
        tvlUsd: num(v.summary.tvl),
        manager: isHlp ? "Hyperliquid" : `${v.summary.leader.slice(0, 6)}…${v.summary.leader.slice(-4)}`,
        redemption: isHlp ? "4-day lock-up" : "1-day lock-up",
        stablecoin: false, // USDC deposits, but returns come from trading, not stable yield
        url: `https://app.hyperliquid.xyz/vaults/${v.summary.vaultAddress}`,
      } satisfies Opportunity;
    });
}

/* ---------------- Solana liquid staking (Sanctum's LST registry, incl. Jito) ---------------- */

type SanctumLst = { mint: string; symbol: string; name: string; logo_uri?: string; pool?: { program?: string } | string };

async function lifiPrice(chain: string, token: string): Promise<number> {
  const t = await getJson<{ priceUSD?: string }>(`https://li.quest/v1/token?chain=${chain}&token=${encodeURIComponent(token)}`);
  return num(t.priceUSD);
}

export async function solanaStaking(): Promise<Opportunity[]> {
  const [{ lsts }, solUsd] = await Promise.all([
    getJson<{ lsts: SanctumLst[] }>("https://extra-api.sanctum.so/v1/lsts"),
    lifiPrice("SOL", "So11111111111111111111111111111111111111112"),
  ]);
  // Batch APY and TVL lookups (the API takes repeated ?lst= params).
  const batches: SanctumLst[][] = [];
  for (let i = 0; i < lsts.length; i += 40) batches.push(lsts.slice(i, i + 40));
  const apy: Record<string, number> = {};
  const tvl: Record<string, string> = {};
  await mapLimit(batches, 4, async (b) => {
    const q = b.map((l) => `lst=${encodeURIComponent(l.symbol)}`).join("&");
    const [a, t] = await Promise.all([
      getJson<{ apys: Record<string, number> }>(`https://extra-api.sanctum.so/v1/apy/inception?${q}`).catch(() => ({ apys: {} })),
      getJson<{ tvls: Record<string, string> }>(`https://extra-api.sanctum.so/v1/tvl/current?${q}`).catch(() => ({ tvls: {} })),
    ]);
    Object.assign(apy, a.apys);
    Object.assign(tvl, t.tvls);
  });
  // mSOL is listed by the Marinade adapter, which executes through Marinade's own SDK.
  return lsts.filter((l) => l.symbol !== "mSOL").map((l) => {
    const program = typeof l.pool === "string" ? l.pool : (l.pool?.program ?? "");
    return {
      id: `solstake:solana:${l.mint}`,
      protocol: "Solana staking",
      name: l.name,
      ticker: l.symbol,
      asset: "SOL",
      kind: "Liquid staking",
      category: "SOL Staking",
      chain: "Solana",
      apy: numOrNull(apy[l.symbol]),
      apyNote: "Average since launch",
      apy7d: null,
      apy30d: null,
      tvlUsd: (num(tvl[l.symbol]) / 1e9) * solUsd,
      manager: l.symbol === "JitoSOL" ? "Jito" : l.symbol === "mSOL" ? "Marinade" : program.startsWith("Sanctum") ? "Sanctum" : "SPL stake pool",
      redemption: "Instant (swap) or unstake at epoch end",
      stablecoin: false,
      url: `https://app.sanctum.so/trade/SOL-${l.symbol}`,
      address: l.mint,
      details: [
        { label: "Token", value: l.symbol },
        { label: "Mint", value: l.mint },
        ...(program ? [{ label: "Pool program", value: program }] : []),
        { label: "APY basis", value: "Average since launch (Sanctum)" },
      ],
      assetLogo: l.logo_uri,
      logoUrl: l.logo_uri,
    } satisfies Opportunity;
  });
}

/* ---------------- Aftermath (afSUI liquid staking) ---------------- */

export async function aftermath(): Promise<Opportunity[]> {
  const [apy, tvlRaw, rate, suiUsd] = await Promise.all([
    getJson<number>("https://aftermath.finance/api/staking/apy"),
    getJson<string>("https://aftermath.finance/api/staking/sui-tvl"),
    getJson<number>("https://aftermath.finance/api/staking/afsui-exchange-rate").catch(() => 0),
    lifiPrice("SUI", "0x2::sui::SUI"),
  ]);
  const staked = num(String(tvlRaw).replace(/n$/, "")) / 1e9;
  return [
    {
      id: "aftermath:sui:afsui",
      protocol: "Aftermath",
      name: "Aftermath staked SUI (afSUI)",
      ticker: "afSUI",
      asset: "SUI",
      kind: "Liquid staking",
      category: "SUI Staking",
      chain: "Sui",
      apy: num(apy),
      apy7d: null,
      apy30d: null,
      tvlUsd: staked * suiUsd,
      manager: "Aftermath",
      redemption: "Instant (swap) or unstake at epoch end",
      stablecoin: false,
      url: "https://aftermath.finance/liquid-staking",
      sharePrice: rate || undefined,
      details: [
        { label: "SUI staked", value: `${Math.round(staked).toLocaleString()} SUI` },
        ...(rate ? [{ label: "afSUI → SUI rate", value: rate.toFixed(4) }] : []),
      ],
    },
  ];
}

/* ---------------- Marinade (mSOL liquid staking) ---------------- */
// Execution: @marinade.finance/marinade-ts-sdk `deposit` (SOL → mSOL), `liquidUnstake` (instant) or `orderUnstake` (epoch end).

const MSOL = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";

export async function marinade(): Promise<Opportunity[]> {
  const [apy, tlv] = await Promise.all([
    getJson<{ value: number }>("https://api.marinade.finance/msol/apy/30d"),
    getJson<{ staked_usd: number; staked_sol: number }>("https://api.marinade.finance/tlv"),
  ]);
  return [
    {
      id: `marinade:solana:${MSOL}`,
      protocol: "Marinade",
      name: "Marinade staked SOL (mSOL)",
      ticker: "mSOL",
      asset: "SOL",
      kind: "Liquid staking",
      category: "SOL Staking",
      chain: "Solana",
      apy: num(apy.value),
      apyNote: "Last 30 days",
      apy7d: null,
      apy30d: num(apy.value),
      tvlUsd: num(tlv.staked_usd),
      manager: "Marinade",
      redemption: "Instant (liquid unstake, fee) or unstake at epoch end",
      stablecoin: false,
      url: "https://app.marinade.finance/",
      address: MSOL,
      details: [{ label: "SOL staked", value: Math.round(num(tlv.staked_sol)).toLocaleString("en-US") }],
    },
  ];
}

/* ---------------- Meteora (DLMM liquidity pools) ---------------- */
// Execution: @meteora-ag/dlmm opens a position (initializePositionAndAddLiquidityByStrategy) and closes it
// (remove liquidity, then close the position). The yield is the pool's trading fees, not a fixed vault rate.

type MeteoraToken = { address: string; symbol: string; is_verified?: boolean };
type MeteoraPool = {
  address: string;
  name: string;
  token_x: MeteoraToken;
  token_y: MeteoraToken;
  tvl: number;
  is_blacklisted?: boolean;
  pool_config?: { bin_step?: number; base_fee_pct?: number };
  fee_tvl_ratio?: { "24h"?: number };
  volume?: { "24h"?: number };
};

/** Smaller pools are too thin to enter and leave cleanly. */
const METEORA_MIN_TVL = 100_000;

export async function meteora(): Promise<Opportunity[]> {
  const pools: MeteoraPool[] = [];
  for (let page = 1; page <= 5; page++) {
    const d = await getJson<{ data: MeteoraPool[] }>(`https://dlmm.datapi.meteora.ag/pools?page=${page}&page_size=200&sort_by=tvl:desc`);
    pools.push(...d.data);
    if (d.data.length < 200 || d.data[d.data.length - 1].tvl < METEORA_MIN_TVL) break;
  }
  return pools
    .filter((p) => p.tvl >= METEORA_MIN_TVL && !p.is_blacklisted && p.token_x.is_verified && p.token_y.is_verified)
    .map((p) => {
      const pair = `${p.token_x.symbol}-${p.token_y.symbol}`;
      // Fees earned over the last day, as a share of TVL, annualized without compounding.
      const apr = num(p.fee_tvl_ratio?.["24h"]) * 365;
      return {
        id: `meteora:solana:${p.address}`,
        protocol: "Meteora",
        name: `${pair} DLMM pool`,
        asset: pair,
        kind: "Liquidity",
        category: "DLMM pool",
        chain: "Solana",
        apy: apr,
        apyNote: "Last 24h trading fees, annualized",
        apy7d: null,
        apy30d: null,
        tvlUsd: p.tvl,
        manager: "Meteora",
        redemption: "Instant (withdraw liquidity)",
        stablecoin: isStable(p.token_x.symbol) && isStable(p.token_y.symbol),
        url: `https://app.meteora.ag/dlmm/${p.address}`,
        address: p.address,
        details: [
          { label: "Bin step", value: String(p.pool_config?.bin_step ?? "?") },
          { label: "Base fee", value: `${p.pool_config?.base_fee_pct ?? "?"}%` },
          { label: "24h volume", value: `$${Math.round(num(p.volume?.["24h"])).toLocaleString("en-US")}` },
        ],
      } satisfies Opportunity;
    });
}
