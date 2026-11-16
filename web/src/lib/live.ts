import { unstable_cache } from "next/cache";
import { APP_URL, CHAINS, PARTNERS } from "./site";

type Opp = {
  slug?: string;
  protocol: string;
  name: string;
  asset: string;
  kind: string;
  chain: string;
  manager: string;
  redemption?: string;
  stablecoin: boolean;
  apy: number | null;
  apy30d: number | null;
  apy7d: number | null;
  tvlUsd: number;
  protocolLogo?: string;
  assetLogo?: string;
  chainLogo?: string;
};

export type ChainMark = { name: string; logo: string };

export type Featured = {
  name: string;
  asset: string;
  protocol: string;
  manager: string;
  chain: string;
  kind: string;
  apy: number;
  tvlUsd: number;
  redemption: string;
  logo?: string;
  protocolLogo?: string;
  href: string;
};
export type Live = {
  rows: Featured[];
  example: Featured;
  vaults: number;
  vaultProducts: number;
  platforms: number;
  chains: number;
  chainMarks: ChainMark[];
  worthMarks: ChainMark[];
  tvlUsd: number;
  topLendingApy: number;
  featured: Featured[];
  isLive: boolean;
};

/** "Up to" quotes lending markets this big only: smaller markets and trading pools can show outlier rates. */
const MIN_TVL_FOR_HEADLINE = 50_000_000;
const MAX_SANE = 0.5;
/** Landing card: real high rates, big enough that a thin pool can't lead it, and under 35% so a one-off spike stays out. */
const MIN_SPOT_TVL = 1_000_000;
const MIN_SPOT_APY = 0.1;
const MAX_SPOT_APY = 0.35;

const tw = (addr?: string) =>
  `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/${addr ? `assets/${addr}/` : "info/"}logo.png`;
const ETH_LOGO = tw();
const USDC_LOGO = tw("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const USDE_LOGO = tw("0x4c9EDD5852cd905f086C759E8383e09bff1E68B3");
const local = (file: string) => `/logos/protocols/${file}`;

/** Lido stETH: the example vault in the deposit and earn steps. */
const LIDO: Featured = {
  name: "Lido staked ETH (stETH)",
  asset: "ETH",
  protocol: "Lido",
  manager: "Lido",
  chain: "Ethereum",
  kind: "Liquid staking",
  apy: 0.0262,
  tvlUsd: 17.4e9,
  redemption: "Withdrawal queue",
  logo: ETH_LOGO,
  protocolLogo: local("lido.png"),
  href: APP_URL,
};

/** Shown only when the app can't be reached (e.g. during a build). Round figures close to the live catalog in Nov 2026. */
const FALLBACK: Live = {
  vaults: 1900,
  vaultProducts: 600,
  platforms: 40,
  chains: 30,
  chainMarks: CHAINS,
  worthMarks: PARTNERS.filter((p) => !p.infra)
    .slice(0, 6)
    .map((p) => ({ name: p.name, logo: p.logo })),
  tvlUsd: 60e9,
  topLendingApy: 0.1,
  isLive: false,
  example: LIDO,
  featured: [
    {
      name: "Savings USDS (sUSDS)",
      asset: "USDS",
      protocol: "Sky",
      manager: "Sky",
      chain: "Ethereum",
      kind: "Vault",
      apy: 0.038,
      tvlUsd: 3.7e9,
      redemption: "Instant",
      href: APP_URL,
    },
    LIDO,
    {
      name: "Jito Staked SOL",
      asset: "SOL",
      protocol: "Solana staking",
      manager: "Jito",
      chain: "Solana",
      kind: "Liquid staking",
      apy: 0.0621,
      tvlUsd: 7.3e8,
      redemption: "Instant (swap)",
      href: APP_URL,
    },
  ],
  rows: [
    {
      name: "PT Ethena sUSDe",
      asset: "USDe",
      protocol: "Pendle",
      manager: "Pendle",
      chain: "Ethereum",
      kind: "Fixed yield",
      apy: 0.118,
      tvlUsd: 9.1e8,
      redemption: "At maturity",
      logo: USDE_LOGO,
      protocolLogo: local("pendle.ico"),
      href: APP_URL,
    },
    {
      name: "Ember USDC vault",
      asset: "USDC",
      protocol: "Ember",
      manager: "Ember",
      chain: "Sui",
      kind: "Vault",
      apy: 0.192,
      tvlUsd: 4.2e7,
      redemption: "Instant",
      logo: USDC_LOGO,
      protocolLogo: local("ember.png"),
      href: APP_URL,
    },
    {
      name: "Upshift USDC",
      asset: "USDC",
      protocol: "Upshift",
      manager: "Upshift",
      chain: "Ethereum",
      kind: "Vault",
      apy: 0.137,
      tvlUsd: 6.5e7,
      redemption: "Withdrawal queue",
      logo: USDC_LOGO,
      protocolLogo: local("upshift.png"),
      href: APP_URL,
    },
    {
      name: "Hyperliquidity Provider (HLP)",
      asset: "USDC",
      protocol: "Hyperliquid",
      manager: "Hyperliquid",
      chain: "Hyperliquid",
      kind: "Vault",
      apy: 0.141,
      tvlUsd: 3.8e8,
      redemption: "4-day lockup",
      logo: USDC_LOGO,
      protocolLogo: local("hyperliquid.png"),
      href: APP_URL,
    },
  ],
};

const rate = (o: Opp) => o.apy30d ?? o.apy7d ?? o.apy ?? 0;
const abs = (u?: string) =>
  !u ? undefined : u.startsWith("http") ? u : `${APP_URL}${u}`;

const toFeatured = (o: Opp): Featured => ({
  name: o.name,
  asset: o.asset,
  protocol: o.protocol,
  manager: o.manager,
  chain: o.chain,
  kind: o.kind,
  apy: rate(o),
  tvlUsd: o.tvlUsd,
  redemption: o.redemption || "Instant",
  logo: abs(o.assetLogo ?? o.protocolLogo),
  protocolLogo: abs(o.protocolLogo),
  href: o.slug ? `${APP_URL}/earn/${o.slug}` : APP_URL,
});

/**
 * Live figures from the app's catalog, refreshed every 5 minutes. Never throws.
 * The full catalog is over Next's 2 MB fetch-cache limit, so the raw response is not cached; only the small
 * summary below is, which keeps every render fast and stops the page flipping between live and fallback figures.
 */
const cachedLive = unstable_cache(loadLive, ["landing-live-v1"], {
  revalidate: 300,
});

export async function getLive(): Promise<Live> {
  try {
    return await cachedLive();
  } catch {
    // Failures throw so they are never cached: the next render tries the app again.
    return FALLBACK;
  }
}

/** Fetches and summarises the catalog. Throws when the app can't be reached, so a failure isn't cached. */
async function loadLive(): Promise<Live> {
  const res = await fetch(`${APP_URL}/api/opportunities`, {
    cache: "no-store",
    // The app can take up to ~25s on a cold start while it loads every source; the result is cached for 5 minutes after.
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const { opportunities: all } = (await res.json()) as {
    opportunities: Opp[];
  };
  if (!all?.length) throw new Error("empty catalog");

  const lending = all
    .filter((o) => o.kind === "Lending" && o.tvlUsd >= MIN_TVL_FOR_HEADLINE)
    .map(rate)
    .filter((r) => r > 0 && r <= MAX_SANE);

  // Featured: the biggest stablecoin, ETH and SOL products, each from a different platform.
  const byTvl = [...all].sort((a, b) => b.tvlUsd - a.tvlUsd);
  const used = new Set<string>();
  const pick = (test: (o: Opp) => boolean) => {
    const o = byTvl.find(
      (x) =>
        test(x) &&
        !used.has(x.protocol) &&
        rate(x) >= 0.01 &&
        rate(x) <= MAX_SANE,
    );
    if (o) used.add(o.protocol);
    return o;
  };
  const featured = [
    pick((o) => o.stablecoin),
    pick((o) => /ETH$/i.test(o.asset)),
    pick((o) => o.asset === "SOL"),
  ]
    .filter((o): o is Opp => !!o)
    .map(toFeatured);

  // The landing card names high rates (Ember, ~20% and the rest), one product per platform.
  // Platforms already shown in the hero logo row are left out, so a vault is not named twice.
  const heroVaults = new Set(
    PARTNERS.filter((p) => !p.infra)
      .slice(0, 8)
      .map((p) => p.name),
  );
  const spotSeen = new Set<string>();
  const high = [...all]
    .filter(
      (o) =>
        o.tvlUsd >= MIN_SPOT_TVL &&
        rate(o) >= MIN_SPOT_APY &&
        rate(o) <= MAX_SPOT_APY &&
        !heroVaults.has(o.protocol),
    )
    .sort((a, b) => rate(b) - rate(a))
    .filter(
      (o) => !spotSeen.has(o.protocol) && (spotSeen.add(o.protocol), true),
    )
    .slice(0, 8)
    .map(toFeatured);
  const seen = new Set<string>();
  const rows =
    high.length >= 4
      ? high
      : byTvl
          .filter(
            (o) =>
              rate(o) >= 0.01 &&
              rate(o) <= MAX_SANE &&
              !seen.has(o.protocol) &&
              (seen.add(o.protocol), true),
          )
          .slice(0, 6)
          .map(toFeatured);

  // Lido stETH is the example in the deposit and earn steps; the biggest Lido product, else the fallback.
  const lido = byTvl.find(
    (o) => o.protocol === "Lido" && rate(o) > 0 && rate(o) <= MAX_SANE,
  );
  const example = lido
    ? {
        ...toFeatured(lido),
        logo: abs(lido.assetLogo) ?? ETH_LOGO,
        protocolLogo: abs(lido.protocolLogo) ?? LIDO.protocolLogo,
      }
    : LIDO;

  const chainCounts = new Map<string, { n: number; logo?: string }>();
  for (const o of all) {
    const cur = chainCounts.get(o.chain) ?? { n: 0 };
    cur.n += 1;
    if (!cur.logo && o.chainLogo) cur.logo = abs(o.chainLogo);
    chainCounts.set(o.chain, cur);
  }
  const worthByProtocol = new Map<string, { tvl: number; logo?: string }>();
  for (const o of all) {
    const cur = worthByProtocol.get(o.protocol) ?? { tvl: 0 };
    cur.tvl += o.tvlUsd || 0;
    if (!cur.logo && o.protocolLogo) cur.logo = abs(o.protocolLogo);
    worthByProtocol.set(o.protocol, cur);
  }
  const worthMarks = [...worthByProtocol.entries()]
    .filter(
      (entry): entry is [string, { tvl: number; logo: string }] =>
        !!entry[1].logo,
    )
    .sort((a, b) => b[1].tvl - a[1].tvl)
    .slice(0, 6)
    .map(([name, v]) => ({ name, logo: v.logo }));

  const chainMarks = [...chainCounts.entries()]
    .filter(
      (entry): entry is [string, { n: number; logo: string }] =>
        !!entry[1].logo && entry[0] !== "Monad",
    )
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 6)
    .map(([name, v]) => ({ name, logo: v.logo }));

  return {
    vaults: all.length,
    vaultProducts: all.filter((o) => o.kind === "Vault").length,
    platforms: new Set(all.map((o) => o.protocol)).size,
    chains: chainCounts.size,
    chainMarks: chainMarks.length ? chainMarks : FALLBACK.chainMarks,
    worthMarks: worthMarks.length ? worthMarks : FALLBACK.worthMarks,
    tvlUsd: all.reduce((s, o) => s + (o.tvlUsd || 0), 0),
    topLendingApy: lending.length
      ? Math.max(...lending)
      : FALLBACK.topLendingApy,
    featured: featured.length === 3 ? featured : FALLBACK.featured,
    rows,
    example,
    isLive: true,
  };
}

export function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
