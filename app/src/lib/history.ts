import { getJson, gql, num } from "./http.ts";
import type { AllocationRow, History, Opportunity, VaultProfile } from "./types.ts";

/**
 * Chart data for the vault page. Each protocol exposes history differently; sources without
 * history return {} and the page shows current values only.
 */

const DAY_S = 86_400;
const cache = new Map<string, { at: number; h: History }>();
const TTL = 10 * 60_000;
/** Most vault histories kept in memory at once; expired and oldest entries are dropped first. */
const MAX_ENTRIES = 300;

const sortAsc = (s: [number, number][]) => s.filter(([, y]) => Number.isFinite(y)).sort((a, b) => a[0] - b[0]);

async function ember(id: string): Promise<History> {
  const B = "https://vaults.api.sui-prod.bluefin.io/api/v2/vaults";
  type ApyPt = { apyE9: string; rewardApyE9?: string; timestamp: number };
  type ApyRes = { data: ApyPt[] } & Record<string, string | ApyPt[]>;
  type PocRow = { asset: string; protocol?: string; capitalUsdE9: string; percentageOfNavE9: string; explorerUrl?: string };
  type Poc = { generatedAt: number; groups: { label: string; logoUrl?: string; percentageOfNavE9: string; rows: PocRow[] }[] };
  const [apy, tvl, sp, poc] = await Promise.all([
    getJson<ApyRes>(`${B}/apy-history/${id}`).catch(() => null),
    getJson<{ timestamp: number; tvlUsdE9: string }[]>(`${B}/tvl-history/${id}`).catch(() => []),
    getJson<{ timestamp: number; sharePriceE9: string }[]>(`${B}/share-price-history/${id}`).catch(() => []),
    getJson<Poc>(`${B}/poc/${id}/transparency`).catch(() => null),
  ]);
  const reserves = poc?.groups?.length
    ? {
        generatedAt: poc.generatedAt * 1000,
        totalUsd: poc.groups.reduce((s, g) => s + g.rows.reduce((t, r) => t + num(r.capitalUsdE9) / 1e9, 0), 0),
        groups: poc.groups.map((g) => ({
          label: g.label.charAt(0).toUpperCase() + g.label.slice(1),
          logoUrl: g.logoUrl,
          pct: num(g.percentageOfNavE9) / 1e9,
          rows: g.rows.map((r) => ({
            asset: r.asset,
            protocol: r.protocol ?? "Wallet",
            usd: num(r.capitalUsdE9) / 1e9,
            pct: num(r.percentageOfNavE9) / 1e9,
            url: r.explorerUrl,
          })),
        })),
      }
    : undefined;
  const averages: History["averages"] = {};
  if (apy) {
    for (const w of ["7d", "30d", "60d", "90d"]) {
      const total = apy[`avg${w}TotalApyE9`];
      const deposit = apy[`avg${w}DepositApyE9`];
      if (typeof total === "string") averages[w] = { total: num(total) / 1e9, deposit: num(deposit) / 1e9 };
    }
  }
  return {
    apy: apy ? sortAsc(apy.data.map((p) => [p.timestamp, (num(p.apyE9) + num(p.rewardApyE9)) / 1e9])) : undefined,
    tvl: sortAsc(tvl.map((p) => [p.timestamp, num(p.tvlUsdE9) / 1e9])),
    sharePrice: sortAsc(sp.map((p) => [p.timestamp, num(p.sharePriceE9) / 1e9])),
    averages,
    reserves,
  };
}

const MORPHO_GQL = "https://blue-api.morpho.org/graphql";
const WAD = 1e18;
const fmtFee = (f: number) => `${(f * 100).toFixed(f * 100 % 1 === 0 ? 0 : 2)}%`;

type MAsset = { symbol: string; logoURI?: string } | null;
type MMarket = { marketId: string; lltv: string | number | null; loanAsset: MAsset; collateralAsset: MAsset; state: { utilization: number | null; liquidityAssetsUsd: number | null } | null };

function allocationRows(items: { usd: number; market: MMarket | null }[], totalUsd: number): AllocationRow[] {
  return items
    .filter((x) => x.usd > 0 && x.market)
    .map((x) => ({
      id: x.market!.marketId,
      loan: { symbol: x.market!.loanAsset?.symbol ?? "?", logo: x.market!.loanAsset?.logoURI },
      collateral: x.market!.collateralAsset ? { symbol: x.market!.collateralAsset.symbol, logo: x.market!.collateralAsset.logoURI } : undefined,
      lltv: x.market!.lltv ? num(x.market!.lltv) / WAD : undefined,
      allocationUsd: x.usd,
      pct: totalUsd ? x.usd / totalUsd : 0,
      liquidityUsd: x.market!.state?.liquidityAssetsUsd ?? undefined,
      utilization: x.market!.state?.utilization ?? undefined,
    }))
    .sort((p, q) => q.allocationUsd - p.allocationUsd);
}

type Reward = { asset: { symbol: string; logoURI?: string | null } | null; supplyApr: number | null };

/** Morpho's APY parts: native yield, each reward token, and the curator's fees. */
function apyParts(native: number | null, net: number | null, rewards: Reward[], performanceFee: number, managementFee: number): VaultProfile["apy"] {
  return {
    native: native ?? undefined,
    net: net ?? undefined,
    rewards: rewards.filter((r) => r.asset && num(r.supplyApr) > 0.00005).map((r) => ({ symbol: r.asset!.symbol, logo: r.asset!.logoURI ?? undefined, apr: num(r.supplyApr) })),
    performanceFee,
    managementFee,
  };
}

async function morpho(address: string, chainId: number, v2: boolean): Promise<History> {
  const now = Math.floor(Date.now() / 1000);
  // Daily points for the long view, hourly points for the last week (what the 7D chart shows).
  const day = `(options:{interval:DAY, startTimestamp:${now - 90 * DAY_S}})`;
  const hour = `(options:{interval:HOUR, startTimestamp:${now - 7 * DAY_S}})`;
  type Pt = { x: number; y: number | null }[];
  const toMs = (pts: Pt) => sortAsc(pts.map((p) => [p.x * 1000, p.y ?? Number.NaN] as [number, number]));
  const join = (daily: Pt, hourly: Pt) => {
    const h = toMs(hourly);
    const from = h.length ? h[0][0] : Number.POSITIVE_INFINITY;
    return [...toMs(daily).filter(([t]) => t < from), ...h];
  };
  const root = v2 ? "vaultV2ByAddress" : "vaultByAddress";
  const at = `(address:"${address}", chainId:${chainId})`;
  const [apyF, spF] = v2 ? ["avgNetApy", "sharePrice"] : ["netApy", "sharePriceNumber"];
  const series = (o: string) => `apy${o === day ? "" : "H"}: ${apyF}${o}{x y} tvl${o === day ? "" : "H"}: totalAssetsUsd${o}{x y} sp${o === day ? "" : "H"}: ${spF}${o}{x y}`;
  const histQ = `{ v: ${root}${at}{ historicalState{ ${series(day)} ${series(hour)} } } }`;
  const mkt = "market{ marketId lltv loanAsset{symbol logoURI} collateralAsset{symbol logoURI} state{ utilization liquidityAssetsUsd } }";

  // Morpho caps query complexity, so history, facts and allocation are separate requests.
  const histP = gql<{ v: { historicalState: Record<"apy" | "tvl" | "sp" | "apyH" | "tvlH" | "spH", Pt> } }>(MORPHO_GQL, histQ);
  let profile: VaultProfile = { version: v2 ? "Vault V2" : "Vault V1 (MetaMorpho)" };
  try {
    if (v2) {
      type A = { v: { creationTimestamp: number; performanceFee: number; managementFee: number; liquidityUsd: number; idleAssetsUsd: number; totalAssetsUsd: number;
        owner: { address: string } | null; curator: { address: string } | null; sentinels: { sentinel: { address: string } }[]; allocators: { allocator: { address: string } }[];
        timelocks: { functionName: string; duration: number }[]; metadata: { description?: string } | null;
        apy: number | null; netApy: number | null; rewards: Reward[] } };
      type B = { v: { adapters: { items: { type: string; assetsUsd: number; positions?: { items: { state: { supplyAssetsUsd: number } | null; market: MMarket }[] } }[] } } };
      const [a, b] = await Promise.all([
        gql<A>(MORPHO_GQL, `{ v: ${root}${at}{ creationTimestamp performanceFee managementFee liquidityUsd idleAssetsUsd totalAssetsUsd owner{ address } curator{ address } sentinels{ sentinel{ address } } allocators{ allocator{ address } } timelocks{ functionName duration } metadata{ description } apy netApy rewards{ asset{ symbol logoURI } supplyApr } } }`),
        gql<B>(MORPHO_GQL, `{ v: ${root}${at}{ adapters(first:10){ items{ type assetsUsd ... on MorphoMarketV1Adapter{ positions(first:25){ items{ state{ supplyAssetsUsd } ${mkt} } } } } } } }`).catch(() => null),
      ]);
      const v = a.v;
      const items = (b?.v.adapters.items ?? []).flatMap((ad) => ad.positions?.items.map((p) => ({ usd: num(p.state?.supplyAssetsUsd), market: p.market })) ?? []);
      const alloc = allocationRows(items, v.totalAssetsUsd);
      if (v.idleAssetsUsd > 0) alloc.push({ id: "idle", loan: { symbol: "Idle liquidity" }, allocationUsd: v.idleAssetsUsd, pct: v.totalAssetsUsd ? v.idleAssetsUsd / v.totalAssetsUsd : 0 });
      profile = {
        ...profile,
        createdAt: v.creationTimestamp * 1000,
        description: v.metadata?.description || undefined,
        liquidityUsd: v.liquidityUsd,
        idleUsd: v.idleAssetsUsd,
        fees: [
          { label: "Performance fee", value: fmtFee(num(v.performanceFee)) },
          { label: "Management fee", value: fmtFee(num(v.managementFee)) },
        ],
        roles: [
          ...(v.owner ? [{ label: "Owner", address: v.owner.address }] : []),
          ...(v.curator ? [{ label: "Curator", address: v.curator.address }] : []),
          ...v.sentinels.map((x, i) => ({ label: `Sentinel ${i + 1}`, address: x.sentinel.address })),
        ],
        allocators: v.allocators.map((x) => x.allocator.address),
        timelocks: v.timelocks.filter((t) => t.duration > 0).map((t) => ({ label: t.functionName.replace(/^set/, "").replace(/([A-Z])/g, " $1").trim(), seconds: t.duration })),
        allocation: alloc,
        apy: apyParts(v.apy, v.netApy, v.rewards, num(v.performanceFee), num(v.managementFee)),
      };
    } else {
      type V1 = { v: { creationTimestamp: number; metadata: { description?: string } | null; liquidity: { usd: number } | null; allocators: { address: string }[];
        state: { totalAssetsUsd: number; fee: number; timelock: number; owner: string | null; curator: string | null; guardian: string | null; apy: number | null; netApy: number | null; allRewards: Reward[] | null;
          allocation: { supplyAssetsUsd: number; market: MMarket }[] } } };
      const { v } = await gql<V1>(MORPHO_GQL, `{ v: ${root}${at}{ creationTimestamp metadata{ description } liquidity{ usd } allocators{ address } state{ totalAssetsUsd fee timelock owner curator guardian apy netApy allRewards{ asset{ symbol logoURI } supplyApr } allocation{ supplyAssetsUsd ${mkt} } } } }`);
      profile = {
        ...profile,
        createdAt: v.creationTimestamp * 1000,
        description: v.metadata?.description || undefined,
        liquidityUsd: v.liquidity?.usd,
        fees: [{ label: "Performance fee", value: fmtFee(num(v.state.fee)) }],
        roles: [
          ...(v.state.owner ? [{ label: "Owner", address: v.state.owner }] : []),
          ...(v.state.curator ? [{ label: "Curator", address: v.state.curator }] : []),
          ...(v.state.guardian ? [{ label: "Guardian", address: v.state.guardian }] : []),
        ],
        allocators: v.allocators.map((x) => x.address),
        timelocks: v.state.timelock ? [{ label: "Configuration changes", seconds: v.state.timelock }] : [],
        allocation: allocationRows(v.state.allocation.map((x) => ({ usd: num(x.supplyAssetsUsd), market: x.market })), v.state.totalAssetsUsd),
        apy: apyParts(v.state.apy, v.state.netApy, v.state.allRewards ?? [], num(v.state.fee), 0),
      };
    }
  } catch {
    // Facts are optional; the page still renders history and live numbers.
  }
  const h = (await histP).v.historicalState;
  return { apy: join(h.apy, h.apyH), tvl: join(h.tvl, h.tvlH), sharePrice: join(h.sp, h.spH), profile };
}

export async function getHistory(o: Opportunity): Promise<History> {
  if (!o.ref) return {};
  const key = `${o.ref.source}:${o.ref.id}:${o.ref.chainId ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.h;
  let h: History = {};
  try {
    if (o.ref.source === "ember") h = await ember(o.ref.id);
    else if (o.ref.source === "morpho-v1") h = await morpho(o.ref.id, o.ref.chainId ?? 1, false);
    else if (o.ref.source === "morpho-v2") h = await morpho(o.ref.id, o.ref.chainId ?? 1, true);
  } catch {
    h = {};
  }
  cache.delete(key);
  cache.set(key, { at: Date.now(), h });
  if (cache.size > MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at >= TTL) cache.delete(k);
    // Map keeps insertion order, so the first keys are the oldest.
    for (const k of cache.keys()) {
      if (cache.size <= MAX_ENTRIES) break;
      cache.delete(k);
    }
  }
  return h;
}
