import { beefyChainName, evmChainName, isStable } from "../chains.ts";
import { getJson, gql, mapLimit, num, numOrNull } from "../http.ts";
import type { Opportunity } from "../types.ts";

/* ---------------- Morpho (v1 + v2 listed vaults) ---------------- */

type MorphoV1 = {
  vaults: {
    items: {
      name: string;
      address: string;
      chain: { id: number };
      asset: { symbol: string } | null;
      state: { netApy: number | null; avgNetApy: number | null; totalAssetsUsd: number | null; curators: { name: string; image?: string }[] | null } | null;
    }[];
  };
};
type MorphoV2 = {
  vaultV2s: {
    items: {
      name: string;
      address: string;
      chain: { id: number };
      asset: { symbol: string } | null;
      totalAssetsUsd: number | null;
      netApy: number | null;
      avgNetApy: number | null;
      curators: { items: { name: string; image?: string }[] } | null;
    }[];
  };
};

const MORPHO = "https://blue-api.morpho.org/graphql";

export async function morpho(): Promise<Opportunity[]> {
  // Morpho caps query complexity at 1M; a v2 vault with curators + images costs ~5k, so page v2 in chunks of 150.
  const v2Items: MorphoV2["vaultV2s"]["items"] = [];
  let failure: unknown;
  const v1Promise = gql<MorphoV1>(
    MORPHO,
    "{ vaults(first:1000, where:{listed:true}){ items{ name address chain{id} asset{symbol} state{ netApy avgNetApy totalAssetsUsd curators{ name image } } } } }",
  ).catch((e) => { failure = e; return { vaults: { items: [] } } satisfies MorphoV1; });
  try {
  for (let skip = 0; skip < 2000; skip += 150) {
    const page = await gql<MorphoV2>(
      MORPHO,
      `{ vaultV2s(first:150, skip:${skip}, where:{listed:true}){ items{ name address chain{id} asset{symbol} totalAssetsUsd netApy avgNetApy curators{ items{ name image } } } } }`,
    );
    v2Items.push(...page.vaultV2s.items);
    if (page.vaultV2s.items.length < 150) break;
  }
  } catch (e) {
    failure = e;
  }
  const v1 = await v1Promise;
  const v2 = { vaultV2s: { items: v2Items } };
  const out: Opportunity[] = [];
  for (const v of v1.vaults.items) {
    const asset = v.asset?.symbol ?? "?";
    out.push({
      id: `morpho:${v.chain.id}:${v.address}`,
      protocol: "Morpho",
      name: v.name,
      asset,
      kind: "Vault",
      chain: evmChainName(v.chain.id),
      apy: numOrNull(v.state?.netApy),
      apy7d: null,
      apy30d: null, // avgNetApy is a short smoothing window, not a 30-day average
      tvlUsd: num(v.state?.totalAssetsUsd),
      manager: v.state?.curators?.[0]?.name ?? "Morpho",
      managers: v.state?.curators?.map((c) => ({ name: c.name, logoUrl: c.image })),
      redemption: "Instant",
      stablecoin: isStable(asset),
      category: "Curated lending vault",
      address: v.address,
      ref: { source: "morpho-v1", id: v.address, chainId: v.chain.id },
      url: `https://app.morpho.org/${evmChainName(v.chain.id).toLowerCase()}/vault/${v.address}`,
    });
  }
  for (const v of v2.vaultV2s.items) {
    const asset = v.asset?.symbol ?? "?";
    out.push({
      id: `morpho:${v.chain.id}:${v.address}`,
      protocol: "Morpho",
      name: v.name,
      asset,
      kind: "Vault",
      chain: evmChainName(v.chain.id),
      apy: numOrNull(v.netApy),
      apy7d: null,
      apy30d: null, // avgNetApy is a short smoothing window, not a 30-day average
      tvlUsd: num(v.totalAssetsUsd),
      manager: v.curators?.items?.[0]?.name ?? "Morpho",
      managers: v.curators?.items?.map((c) => ({ name: c.name, logoUrl: c.image })),
      redemption: "Instant",
      stablecoin: isStable(asset),
      category: "Curated lending vault",
      address: v.address,
      ref: { source: "morpho-v2", id: v.address, chainId: v.chain.id },
      url: `https://app.morpho.org/${evmChainName(v.chain.id).toLowerCase()}/vault/${v.address}`,
    });
  }

  // Direct lending markets. A failure here must not drop the vaults already collected.
  type MorphoMarkets = {
    markets: {
      items: {
        marketId: string;
        loanAsset: { symbol: string; logoURI?: string } | null;
        collateralAsset: { symbol: string; logoURI?: string } | null;
        lltv: string | number | null;
        morphoBlue: { chain: { id: number } };
        state: { supplyApy: number | null; netSupplyApy: number | null; supplyAssetsUsd: number | null; liquidityAssetsUsd: number | null; borrowApy: number | null; utilization: number | null; borrowAssetsUsd: number | null } | null;
      }[];
    };
  };
  try {
  for (let skip = 0; skip < 5000; skip += 500) {
    const page = await gql<MorphoMarkets>(
      MORPHO,
      `{ markets(first:500, skip:${skip}, where:{listed:true}){ items{ marketId lltv loanAsset{symbol logoURI} collateralAsset{symbol logoURI} morphoBlue{chain{id}} state{ supplyApy netSupplyApy supplyAssetsUsd liquidityAssetsUsd borrowApy utilization borrowAssetsUsd } } } }`,
    );
    for (const m of page.markets.items) {
      const loan = m.loanAsset?.symbol ?? "?";
      const coll = m.collateralAsset?.symbol ?? "idle";
      const chainId = m.morphoBlue.chain.id;
      out.push({
        id: `morpho:${chainId}:market:${m.marketId}`,
        protocol: "Morpho",
        name: `${coll} / ${loan} market`,
        asset: loan,
        kind: "Lending",
        category: "Direct market",
        chain: evmChainName(chainId),
        apy: numOrNull(m.state?.netSupplyApy) ?? numOrNull(m.state?.supplyApy),
        apy7d: null,
        apy30d: null,
        tvlUsd: num(m.state?.supplyAssetsUsd),
        manager: "Morpho market",
        redemption: "Instant (if liquidity)",
        stablecoin: isStable(loan),
        url: `https://app.morpho.org/${evmChainName(chainId).toLowerCase()}/market/${m.marketId}`,
        address: m.marketId,
        assetLogo: m.loanAsset?.logoURI,
        lending: {
          totalSuppliedUsd: num(m.state?.supplyAssetsUsd),
          totalBorrowedUsd: numOrNull(m.state?.borrowAssetsUsd) ?? undefined,
          liquidityUsd: numOrNull(m.state?.liquidityAssetsUsd) ?? undefined,
          utilization: numOrNull(m.state?.utilization) ?? undefined,
          supplyApy: numOrNull(m.state?.netSupplyApy) ?? numOrNull(m.state?.supplyApy) ?? undefined,
          borrowApy: numOrNull(m.state?.borrowApy) ?? undefined,
          liquidationThreshold: m.lltv ? num(m.lltv) / 1e18 : undefined,
          collateral: m.collateralAsset ? { symbol: m.collateralAsset.symbol, logo: m.collateralAsset.logoURI } : undefined,
        },
        details: [
          { label: "Collateral", value: coll },
          { label: "Loan asset", value: loan },
          { label: "Available liquidity", value: `$${Math.round(num(m.state?.liquidityAssetsUsd)).toLocaleString()}` },
        ],
      });
    }
    if (page.markets.items.length < 500) break;
  }
  } catch (e) {
    failure = e;
  }
  if (failure) console.warn("[morpho] partial load:", failure instanceof Error ? failure.message.slice(0, 300) : failure);
  if (out.length === 0) throw failure instanceof Error ? failure : new Error("Morpho returned no vaults");
  return out;
}

/* ---------------- Aave v3 (supply reserves) ---------------- */

type PV = { value?: string } | null;
type TA = { usd?: string } | null;
type AaveData = {
  markets: {
    name: string;
    address: string;
    chain: { chainId: number; name: string };
    reserves: {
      underlyingToken: { symbol: string; address: string };
      isFrozen: boolean;
      isPaused: boolean;
      usdExchangeRate?: string;
      size: { usd: string };
      supplyInfo: { apy: PV; maxLTV?: PV; liquidationThreshold?: PV; liquidationBonus?: PV; canBeCollateral?: boolean; supplyCap?: TA };
      borrowInfo?: {
        apy?: PV; total?: TA; borrowCap?: TA; utilizationRate?: PV; availableLiquidity?: TA; reserveFactor?: PV;
        baseVariableBorrowRate?: PV; variableRateSlope1?: PV; variableRateSlope2?: PV; optimalUsageRate?: PV;
      } | null;
    }[];
  }[];
};

const AAVE = "https://api.v3.aave.com/graphql";

/** Aave's two-slope interest model as [utilization, borrow APR] points. */
function aaveCurve(base: number, s1: number, s2: number, optimal: number): [number, number][] {
  if (!optimal) return [];
  const pts: [number, number][] = [];
  for (let u = 0; u <= 1.0001; u += 0.02) {
    const r = u <= optimal ? base + (u / optimal) * s1 : base + s1 + ((u - optimal) / (1 - optimal || 1)) * s2;
    pts.push([u, r]);
  }
  return pts;
}

export async function aave(): Promise<Opportunity[]> {
  const chains = await gql<{ chains: { chainId: number }[] }>(AAVE, "{ chains { chainId } }");
  const data = await gql<AaveData>(
    AAVE,
    `query($ids:[ChainId!]!){ markets(request:{chainIds:$ids}){ name address chain{chainId name} reserves{ underlyingToken{symbol address} isFrozen isPaused usdExchangeRate size{usd}
      supplyInfo{ apy{value} maxLTV{value} liquidationThreshold{value} liquidationBonus{value} canBeCollateral supplyCap{usd} }
      borrowInfo{ apy{value} total{usd} borrowCap{usd} utilizationRate{value} availableLiquidity{usd} reserveFactor{value}
        baseVariableBorrowRate{value} variableRateSlope1{value} variableRateSlope2{value} optimalUsageRate{value} } } } }`,
    { ids: chains.chains.map((c) => c.chainId) },
  );
  const out: Opportunity[] = [];
  for (const m of data.markets) {
    for (const r of m.reserves) {
      const asset = r.underlyingToken.symbol;
      const price = num(r.usdExchangeRate);
      const b = r.borrowInfo ?? undefined;
      // Aave reports "no cap" as a cap of 0 tokens, which comes back as roughly one token's price in USD.
      const cap = (t: TA | undefined) => { const v = numOrNull(t?.usd); return v !== null && v > price * 1.5 ? v : undefined; };
      const pctOf = (v: PV | undefined) => numOrNull(v?.value) ?? undefined;
      const supplied = num(r.size.usd);
      out.push({
        id: `aave:${m.chain.chainId}:${m.name}:${r.underlyingToken.address}`,
        ...(r.isPaused
          ? { status: "paused" as const, statusReason: "Paused by Aave: deposits and withdrawals are stopped for now." }
          : r.isFrozen
            ? { status: "withdraw-only" as const, statusReason: "Frozen by Aave governance: no new deposits. You can still withdraw." }
            : {}),
        protocol: "Aave",
        name: `${asset} lending`,
        asset,
        kind: "Lending",
        chain: m.chain.name || evmChainName(m.chain.chainId),
        apy: num(r.supplyInfo.apy?.value),
        apy7d: null,
        apy30d: null,
        tvlUsd: supplied,
        manager: m.name.replace(/^AaveV3/, "Aave ").trim() || "Aave",
        redemption: "Instant",
        stablecoin: isStable(asset),
        url: "https://app.aave.com/",
        address: r.underlyingToken.address,
        ref: { source: "aave", id: m.address, chainId: m.chain.chainId }, // the market's Pool contract
        lending: {
          totalSuppliedUsd: supplied,
          totalBorrowedUsd: numOrNull(b?.total?.usd) ?? undefined,
          liquidityUsd: numOrNull(b?.availableLiquidity?.usd) ?? undefined,
          utilization: pctOf(b?.utilizationRate),
          supplyApy: num(r.supplyInfo.apy?.value),
          borrowApy: pctOf(b?.apy),
          supplyCapUsd: cap(r.supplyInfo.supplyCap),
          borrowCapUsd: cap(b?.borrowCap),
          maxLtv: pctOf(r.supplyInfo.maxLTV),
          liquidationThreshold: pctOf(r.supplyInfo.liquidationThreshold),
          liquidationPenalty: pctOf(r.supplyInfo.liquidationBonus),
          canBeCollateral: r.supplyInfo.canBeCollateral,
          reserveFactor: pctOf(b?.reserveFactor),
          priceUsd: price || undefined,
          rateCurve: b ? aaveCurve(num(b.baseVariableBorrowRate?.value), num(b.variableRateSlope1?.value), num(b.variableRateSlope2?.value), num(b.optimalUsageRate?.value)) : undefined,
        },
      });
    }
  }
  return out;
}

/* ---------------- Pendle (active markets → fixed-rate PT) ---------------- */

type PendleMarket = {
  name: string;
  address: string;
  expiry: string;
  details: { liquidity: number; impliedApy: number; aggregatedApy: number };
};

const PENDLE_CHAINS = [1, 10, 56, 146, 999, 5000, 8453, 9745, 42161, 80094];

export async function pendle(): Promise<Opportunity[]> {
  const results = await Promise.allSettled(
    PENDLE_CHAINS.map(async (c) => {
      const d = await getJson<{ markets: PendleMarket[] }>(`https://api-v2.pendle.finance/core/v1/${c}/markets/active`);
      return d.markets.map((m) => ({ c, m }));
    }),
  );
  const out: Opportunity[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const { c, m } of r.value) {
      const expiry = new Date(m.expiry);
      const maturity = expiry.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const liquidity = num(m.details.liquidity);
      out.push({
        id: `pendle:${c}:${m.address}`,
        protocol: "Pendle",
        name: `PT ${m.name} · ${maturity}`,
        asset: m.name,
        kind: "Fixed yield",
        chain: evmChainName(c),
        apy: num(m.details.impliedApy),
        apy7d: null,
        apy30d: null,
        tvlUsd: liquidity,
        manager: "Pendle",
        redemption: `Maturity ${maturity}`,
        stablecoin: isStable(m.name),
        url: `https://app.pendle.finance/trade/markets/${m.address}?chain=${evmChainName(c).toLowerCase()}`,
        details: [
          { label: "Maturity", value: maturity },
          { label: "Position", value: "PT, fixed rate" },
        ],
      });
      const lpApy = numOrNull(m.details.aggregatedApy);
      if (lpApy !== null && lpApy > 0) {
        out.push({
          id: `pendle:${c}:${m.address}:lp`,
          protocol: "Pendle",
          name: `LP ${m.name} · ${maturity}`,
          asset: m.name,
          kind: "Liquidity",
          chain: evmChainName(c),
          apy: lpApy,
          apy7d: null,
          apy30d: null,
          tvlUsd: liquidity,
          manager: "Pendle",
          redemption: `Maturity ${maturity}`,
          stablecoin: isStable(m.name),
          url: `https://app.pendle.finance/trade/pools/${m.address}?chain=${evmChainName(c).toLowerCase()}`,
          details: [
            { label: "Maturity", value: maturity },
            { label: "Position", value: "LP, variable" },
          ],
        });
      }
    }
  }
  return out;
}

/* ---------------- Beefy (active vaults) ---------------- */

type BeefyVault = {
  id: string;
  name: string;
  status: string;
  chain: string;
  assets?: string[];
  platformId?: string;
  earnContractAddress: string;
};

export async function beefy(): Promise<Opportunity[]> {
  const [vaults, apy, tvl] = await Promise.all([
    getJson<BeefyVault[]>("https://api.beefy.finance/vaults"),
    getJson<Record<string, number>>("https://api.beefy.finance/apy"),
    getJson<Record<string, Record<string, number>>>("https://api.beefy.finance/tvl"),
  ]);
  const tvlById: Record<string, number> = {};
  for (const chainTvls of Object.values(tvl)) Object.assign(tvlById, chainTvls);
  return vaults
    .filter((v) => v.status === "active")
    .map((v) => {
      const asset = v.assets?.join("-") ?? v.name;
      return {
        id: `beefy:${v.chain}:${v.id}`,
        protocol: "Beefy",
        name: v.name,
        asset,
        kind: (v.assets?.length ?? 1) > 1 ? "Liquidity" : "Vault",
        chain: beefyChainName(v.chain),
        apy: numOrNull(apy[v.id]),
        apy7d: null,
        apy30d: null,
        tvlUsd: num(tvlById[v.id]),
        manager: v.platformId ? `Beefy · ${v.platformId}` : "Beefy",
        redemption: "Instant",
        stablecoin: (v.assets ?? [v.name]).every(isStable),
        url: `https://app.beefy.com/vault/${v.id}`,
      } satisfies Opportunity;
    });
}

/* ---------------- Yearn (via Kong indexer) ---------------- */

const YEARN_CHAINS = [1, 10, 100, 137, 146, 250, 8453, 42161, 747474, 80094];

type KongVault = {
  name: string;
  address: string;
  yearn: boolean | null;
  v3: boolean | null;
  asset: { symbol: string } | null;
  tvl: { close: number | null } | null;
  apy: { net: number | null; weeklyNet: number | null; monthlyNet: number | null } | null;
};

export async function yearn(): Promise<Opportunity[]> {
  const results = await Promise.allSettled(
    YEARN_CHAINS.map(async (c) => {
      const d = await gql<{ vaults: KongVault[] }>(
        "https://kong.yearn.fi/api/gql",
        `{ vaults(chainId:${c}){ name address yearn v3 asset{symbol} tvl{close} apy{net weeklyNet monthlyNet} } }`,
      );
      return d.vaults.filter((v) => v.yearn).map((v) => ({ c, v }));
    }),
  );
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length === results.length) throw failed[0].reason;
  const out: Opportunity[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const { c, v } of r.value) {
      const asset = v.asset?.symbol ?? "?";
      out.push({
        id: `yearn:${c}:${v.address}`,
        protocol: "Yearn",
        name: v.name,
        asset,
        kind: "Vault",
        chain: evmChainName(c),
        apy: numOrNull(v.apy?.net),
        apy7d: numOrNull(v.apy?.weeklyNet),
        apy30d: numOrNull(v.apy?.monthlyNet),
        tvlUsd: num(v.tvl?.close),
        manager: "Yearn",
        redemption: "Instant",
        stablecoin: isStable(asset),
        address: v.address,
        url: `https://yearn.fi/v3/${c}/${v.address}`,
      });
    }
  }
  return out;
}

/* ---------------- Lagoon (curated vaults; list API has TVL, no APY) ---------------- */

type LagoonVault = {
  address: string;
  name: string;
  isVisible: boolean;
  asset: { symbol: string };
  curators: { name: string }[];
  chain: { id: string; name: string };
  state: { totalAssetsUsd: number };
  logoUrl?: string;
};

export async function lagoon(): Promise<Opportunity[]> {
  const d = await getJson<{ vaults: LagoonVault[] }>("https://app.lagoon.finance/api/vaults?pageSize=1000");
  return d.vaults
    .filter((v) => v.isVisible)
    .map((v) => ({
      id: `lagoon:${v.chain.id}:${v.address}`,
      protocol: "Lagoon",
      name: v.name,
      asset: v.asset.symbol,
      kind: "Vault",
      chain: v.chain.name,
      apy: null,
      apy7d: null,
      apy30d: null,
      tvlUsd: num(v.state?.totalAssetsUsd),
      manager: v.curators?.[0]?.name ?? "Lagoon",
      redemption: "Async (settlement)",
      stablecoin: isStable(v.asset.symbol),
      url: `https://app.lagoon.finance/vault/${v.chain.id}/${v.address}`,
      logoUrl: v.logoUrl,
    }));
}

/* ---------------- Lido (stETH) ---------------- */

export async function lido(): Promise<Opportunity[]> {
  const [apr, tvl] = await Promise.all([
    getJson<{ data: { smaApr: number } }>("https://eth-api.lido.fi/v1/protocol/steth/apr/sma"),
    getJson<{ totalStaked?: string; marketCap?: number }>("https://eth-api.lido.fi/v1/protocol/steth/stats").catch(() => ({}) as { marketCap?: number }),
  ]);
  return [
    {
      id: "lido:1:steth",
      protocol: "Lido",
      name: "Lido staked ETH (stETH)",
      asset: "ETH",
      kind: "Liquid staking",
      chain: "Ethereum",
      apy: num(apr.data.smaApr) / 100,
      apy7d: num(apr.data.smaApr) / 100,
      apy30d: null,
      tvlUsd: num((tvl as { marketCap?: number }).marketCap),
      manager: "Lido",
      redemption: "Withdrawal queue",
      stablecoin: false,
      url: "https://stake.lido.fi/",
    },
  ];
}

/* ---------------- Upshift (August Digital) ---------------- */

type UpshiftVault = {
  address: string;
  chain: number | string;
  chain_type: string;
  vault_name: string;
  public_type: string | null;
  is_visible: boolean;
  status: string;
  receipt_token_symbol: string | null;
  tvl: number | null;
  reported_apy: unknown;
  historical_apy: unknown;
  hardcoded_strategists?: { strategist_name?: string; name?: string }[] | null;
  withdrawal_only?: boolean;
  requires_kyc?: boolean;
};

function firstApy(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["apy", "value", "net_apy", "liquidAPY30Day", "liquidAPY7Day", "30d", "7d"]) {
      const n = numOrNull(o[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

export async function upshift(): Promise<Opportunity[]> {
  // The full list endpoint streams 10MB+ too slowly to finish. Instead: take the vault index the
  // Upshift SDK uses, then fetch each vault's record (≈20s each) in parallel. Runs in the background.
  const index = await getJson<Record<string, { address: string }>>("https://app.upshift.finance/api/sdk/vaults-metadata");
  const addresses = [...new Set(Object.values(index).map((v) => v.address))];
  const settled = await mapLimit(addresses, 10, (a) =>
    getJson<UpshiftVault>(`https://api.augustdigital.io/api/v1/tokenized_vault/${a}`, 120_000),
  );
  const d = settled.filter((r): r is PromiseFulfilledResult<UpshiftVault> => r.status === "fulfilled").map((r) => r.value);
  if (d.length === 0 && addresses.length > 0) throw new Error("No Upshift vault records could be loaded");
  return d
    .filter((v) => v.is_visible && v.status === "active")
    .map((v) => {
      const hist = (v.historical_apy ?? {}) as Record<string, unknown>;
      let apy = firstApy(v.reported_apy) ?? numOrNull(hist["30"]) ?? numOrNull(hist["7"]);
      if (apy !== null && apy > 1) apy = apy / 100; // some vaults report percent
      const chain =
        v.chain_type === "evm" ? evmChainName(v.chain) : String(v.chain_type).charAt(0).toUpperCase() + String(v.chain_type).slice(1);
      const asset = (v.receipt_token_symbol ?? v.vault_name).replace(/^(up|xup|hb|ag|hg|gt|core)/i, "") || v.vault_name;
      return {
        id: `upshift:${v.chain}:${v.address}`,
        ...(v.withdrawal_only ? { status: "withdraw-only" as const, statusReason: "Upshift has closed this vault to deposits. You can still withdraw." } : {}),
        protocol: "Upshift",
        name: v.vault_name,
        asset,
        kind: "Vault",
        chain,
        apy,
        apy7d: null,
        apy30d: null,
        tvlUsd: num(v.tvl),
        manager: v.hardcoded_strategists?.[0]?.strategist_name ?? v.hardcoded_strategists?.[0]?.name ?? "Upshift",
        redemption: v.requires_kyc ? "Queued (KYC vault)" : "Queued",
        stablecoin: isStable(asset) || /usd/i.test(v.vault_name),
        url: `https://app.upshift.finance/pools/${v.chain}/${v.address}`,
      } satisfies Opportunity;
    });
}

/* ---------------- Aave V4 (hub-and-spoke supply reserves) ---------------- */
// Execution: @aave/client (V4) `supply` / `withdraw`, which return ready-to-sign transactions.

type AaveV4Amount = { amount?: { value: string }; exchange?: { value: string } };
type AaveV4Reserve = {
  onChainId: string;
  chain: { chainId: number; name: string };
  status: { frozen: boolean; paused: boolean; active: boolean };
  canSupply: boolean;
  spoke: { name: string; address: string };
  asset: { hub: { name: string }; underlying: { address: string; info: { symbol: string } } };
  summary: { supplied: AaveV4Amount; borrowed: AaveV4Amount; supplyApy: { value: string }; borrowApy: { value: string } };
  settings: { collateral: boolean; collateralFactor: { value: string }; supplyCap: AaveV4Amount };
};

const AAVE_V4 = "https://api.aave.com/graphql";

export async function aaveV4(): Promise<Opportunity[]> {
  const chains = await gql<{ chains: { chainId: number }[] }>(AAVE_V4, "{ chains(request:{query:{filter:MAINNET_ONLY}}){ chainId } }");
  const data = await gql<{ reserves: AaveV4Reserve[] }>(
    AAVE_V4,
    `query($ids:[ChainId!]!){ reserves(request:{query:{chainIds:$ids}, filter:SUPPLY, orderBy:{supplyApy:DESC}}){
      onChainId chain{chainId name} status{frozen paused active} canSupply spoke{name address}
      asset{ hub{name} underlying{ address info{symbol} } }
      summary{ supplied{ amount{value} exchange(currency:USD){value} } borrowed{ exchange(currency:USD){value} } supplyApy{value} borrowApy{value} }
      settings{ collateral collateralFactor{value} supplyCap{ exchange(currency:USD){value} } } } }`,
    { ids: chains.chains.map((c) => c.chainId) },
  );
  return data.reserves
    .map((r) => {
      const asset = r.asset.underlying.info.symbol;
      const halted = r.status.paused || !r.status.active;
      const closed = r.status.frozen || !r.canSupply;
      const supplied = num(r.summary.supplied.exchange?.value);
      const borrowed = num(r.summary.borrowed.exchange?.value);
      const cap = num(r.settings.supplyCap.exchange?.value);
      return {
        id: `aavev4:${r.chain.chainId}:${r.spoke.address}:${r.onChainId}`,
        ...(halted
          ? { status: "paused" as const, statusReason: "Paused by Aave: deposits and withdrawals are stopped for now." }
          : closed
            ? { status: "withdraw-only" as const, statusReason: "Aave has closed this reserve to new deposits. You can still withdraw." }
            : {}),
        protocol: "Aave",
        name: `${asset} lending · ${r.spoke.name} spoke`,
        asset,
        kind: "Lending",
        category: "Aave V4",
        chain: r.chain.name || evmChainName(r.chain.chainId),
        apy: num(r.summary.supplyApy.value),
        apy7d: null,
        apy30d: null,
        tvlUsd: supplied,
        manager: `Aave V4 · ${r.asset.hub.name} hub`,
        redemption: "Instant (if liquidity)",
        stablecoin: isStable(asset),
        url: "https://app.aave.com/",
        address: r.asset.underlying.address,
        lending: {
          totalSuppliedUsd: supplied,
          totalBorrowedUsd: borrowed,
          liquidityUsd: Math.max(0, supplied - borrowed),
          utilization: supplied > 0 ? borrowed / supplied : 0,
          supplyApy: num(r.summary.supplyApy.value),
          borrowApy: num(r.summary.borrowApy.value),
          supplyCapUsd: cap > 0 ? cap : undefined,
          maxLtv: num(r.settings.collateralFactor.value) || undefined,
          canBeCollateral: r.settings.collateral,
        },
        details: [
          { label: "Hub", value: r.asset.hub.name },
          { label: "Spoke", value: `${r.spoke.name} (${r.spoke.address})` },
        ],
      } satisfies Opportunity;
    });
}

/* ---------------- Savings GHO (sGHO, Ethereum) ---------------- */
// Execution: Aave's API builds the deposit/redeem transactions (`sghoVaultDeposit` / `sghoVaultRedeemShares`, no key).
// sGHO is an ERC-4626 vault, so a plain deposit/redeem works too.

const SGHO = "0xE1753F2e00940cC31213dd92013cF019DFE4ca1d";

export async function savingsGho(): Promise<Opportunity[]> {
  const { sghoVault: v } = await gql<{
    sghoVault: { totalAssets: { usd: string }; supplyCap: { usd: string }; targetRate: { value: string }; paused: boolean };
  }>("https://api.v3.aave.com/graphql", "{ sghoVault(request:{chainId:1}){ totalAssets{usd} supplyCap{usd} targetRate{value} paused } }");
  return [
    {
      id: `sgho:1:${SGHO}`,
      ...(v.paused ? { status: "paused" as const, statusReason: "Paused by Aave: deposits and withdrawals are stopped for now." } : {}),
      protocol: "Aave",
      name: "Savings GHO (sGHO)",
      ticker: "sGHO",
      asset: "GHO",
      kind: "Vault",
      category: "Savings rate",
      chain: "Ethereum",
      apy: num(v.targetRate.value),
      apyNote: "Target rate set by Aave governance",
      apy7d: null,
      apy30d: null,
      tvlUsd: num(v.totalAssets.usd),
      capUsd: num(v.supplyCap.usd) || undefined,
      manager: "Aave",
      redemption: "Instant",
      stablecoin: true,
      url: "https://app.aave.com/",
      address: SGHO,
    },
  ];
}

/* ---------------- Euler V2 (EVK lending vaults + Euler Earn) ---------------- */
// Execution: @eulerxyz/euler-v2-sdk plans deposit/withdraw as one EVC batch. Vaults are ERC-4626.

type EulerVault = {
  chainId: number;
  address: string;
  vaultType: "evk" | "earn";
  isEscrow?: boolean;
  name: string;
  symbol: string;
  asset: { address: string; symbol: string };
  totalSupplyUsd: number;
  totalBorrowsUsd?: number;
  utilization?: number;
  supplyApy: number;
  borrowApy?: number;
  apy7d?: number;
  apy30d?: number;
  visibility?: { status: string; explorableLend: boolean; decidedBy?: string; reason?: string | null };
};

const EULER = "https://v3.euler.finance";
const EULER_CHAINS = [1, 8453, 42161, 43114, 56, 130, 999, 59144, 9745];

async function eulerList(kind: "evk" | "earn", chainId: number): Promise<EulerVault[]> {
  const out: EulerVault[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await getJson<{ data: EulerVault[] }>(`${EULER}/v3/${kind}/vaults?chainId=${chainId}&offset=${offset}&limit=100`);
    out.push(...page.data);
    if (page.data.length < 100) break;
  }
  return out;
}

export async function euler(): Promise<Opportunity[]> {
  // A few requests at a time: Euler's API drops requests when all 18 lists are asked for at once.
  const jobs = EULER_CHAINS.flatMap((c) => [["evk", c], ["earn", c]] as const);
  const all = (await mapLimit(jobs, 3, ([kind, c]) => eulerList(kind, c))).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (all.length === 0) throw new Error("Euler API returned no vaults");
  return all
    // Listed vaults are open. Vaults Euler has deprecated stay reachable as withdraw-only.
    // Anything else Euler hides (unverified, spam) is never shown.
    .filter((v) => !v.isEscrow && ((v.visibility?.status === "visible" && v.visibility.explorableLend) || v.visibility?.decidedBy === "deprecated"))
    .map((v) => {
      const asset = v.asset.symbol;
      const earn = v.vaultType === "earn";
      const open = v.visibility?.status === "visible" && v.visibility.explorableLend;
      // Euler's API reports rates in percent (5.03 = 5.03%).
      const pct = (x: number | undefined) => (x === undefined || x === null ? null : x / 100);
      return {
        id: `euler:${v.chainId}:${v.address}`,
        ...(open ? {} : { status: "withdraw-only" as const, statusReason: `Deprecated by Euler${v.visibility?.reason ? `: ${v.visibility.reason.replace(/\.$/, "")}` : ""}. You can still withdraw.` }),
        protocol: "Euler",
        name: earn ? v.name : `${asset} lending · ${v.symbol}`,
        ticker: v.symbol,
        asset,
        kind: earn ? "Vault" : "Lending",
        category: earn ? "Euler Earn" : "Lending vault",
        chain: evmChainName(v.chainId),
        apy: pct(v.supplyApy),
        apy7d: pct(v.apy7d),
        apy30d: pct(v.apy30d),
        tvlUsd: v.totalSupplyUsd,
        manager: "Euler",
        redemption: "Instant (if liquidity)",
        stablecoin: isStable(asset),
        url: "https://app.euler.finance/",
        address: v.address,
        lending: earn
          ? undefined
          : {
              totalSuppliedUsd: v.totalSupplyUsd,
              totalBorrowedUsd: v.totalBorrowsUsd,
              liquidityUsd: Math.max(0, v.totalSupplyUsd - (v.totalBorrowsUsd ?? 0)),
              utilization: v.utilization,
              supplyApy: pct(v.supplyApy) ?? undefined,
              borrowApy: pct(v.borrowApy) ?? undefined,
            },
      } satisfies Opportunity;
    });
}

/* ---------------- Fluid (fTokens on EVM) ---------------- */
// Execution: fTokens are ERC-4626, so deposit/redeem are direct contract calls (no npm package needed).
// On Solana, Fluid's lending runs as Jupiter Lend, which is listed separately.

type FluidToken = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  isNativeUnderlying: boolean;
  asset: { address: string; symbol: string; decimals: number; price: string; logoUrl?: string };
  totalAssets: string;
  supplyRate: string;
  rewardsRate: string;
  totalRate: string;
};

const FLUID_CHAINS = [1, 42161, 8453, 137, 56, 9745];

export async function fluid(): Promise<Opportunity[]> {
  const res = await Promise.allSettled(
    FLUID_CHAINS.map((c) => getJson<{ data: FluidToken[] }>(`https://api.fluid.instadapp.io/v2/lending/${c}/tokens`).then((d) => ({ c, d: d.data }))),
  );
  const out: Opportunity[] = [];
  for (const r of res) {
    if (r.status !== "fulfilled") continue;
    for (const t of r.value.d) {
      const asset = t.asset.symbol;
      // Rates come in basis points × 100 (575 = 5.75%).
      const apy = num(t.totalRate) / 1e4;
      out.push({
        id: `fluid:${r.value.c}:${t.address}`,
        protocol: "Fluid",
        name: `${asset} lending (${t.symbol})`,
        ticker: t.symbol,
        asset,
        kind: "Lending",
        category: "Lending (fToken)",
        chain: evmChainName(r.value.c),
        apy,
        rewardApy: num(t.rewardsRate) / 1e4 || null,
        apy7d: null,
        apy30d: null,
        tvlUsd: (num(t.totalAssets) / 10 ** t.asset.decimals) * num(t.asset.price),
        manager: "Fluid",
        redemption: "Instant (if liquidity)",
        stablecoin: isStable(asset),
        url: "https://fluid.io/",
        address: t.address,
        assetLogo: t.asset.logoUrl,
      });
    }
  }
  if (out.length === 0) throw new Error("Fluid API returned no tokens");
  return out;
}
