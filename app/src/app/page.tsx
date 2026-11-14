import { Explorer } from "@/components/explorer";
import { buildCatalog } from "@/lib/catalog.ts";
import { pageMeta } from "@/lib/meta";
import { SITE_DESCRIPTION } from "@/lib/site";

// Data is cached in memory by the catalog; render on each request so slow sources appear as they finish.
export const dynamic = "force-dynamic";

const EARN_LABEL: Record<string, string> = {
  vaults: "Vaults",
  lending: "Lending",
  staking: "Staking",
  stable: "Stablecoin",
  fixed: "Fixed yield",
  perps: "Perps",
};

const EARN_DESCRIPTION: Record<string, string> = {
  vaults: "Curated and strategy vaults across EVM chains, Solana and Sui, with live APY and TVL.",
  lending: "Lend your crypto on Aave, Morpho, Euler, Compound, Spark, Kamino and more. Compare live supply rates.",
  staking: "Liquid staking for ETH, SOL, SUI and HYPE. Compare staking yields in one place.",
  stable: "Earn yield on USDC, USDT and other stablecoins across lending markets, vaults and savings rates.",
  fixed: "Lock in a fixed rate with Pendle and other fixed-yield markets.",
  perps: "Perpetuals liquidity vaults on Hyperliquid and more.",
};

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ earn?: string }> }) {
  const { earn } = await searchParams;
  const label = earn ? EARN_LABEL[earn] : undefined;
  if (!label) return { ...pageMeta({ title: "Explore yields", description: SITE_DESCRIPTION, path: "/" }), title: { absolute: "PECUN Finance · Put your money to work." } };
  // Filtered views share the home page's canonical URL, so search engines index one Explore page.
  return pageMeta({ title: `${label} yields`, description: EARN_DESCRIPTION[earn!] ?? SITE_DESCRIPTION, path: `/?earn=${earn}` });
}

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; earn?: string }> }) {
  const [catalog, { q, earn }] = await Promise.all([buildCatalog(), searchParams]);
  // Keyed by the earn type so Staking, Vaults and the rest open a fresh, pre-filtered list.
  // Explore lists open vaults only; closed ones stay reachable by their own page.
  return <Explorer key={`${earn ?? "all"}:${q ?? ""}`} catalog={{ ...catalog, closed: [] }} initialQuery={q ?? ""} initialEarn={earn} />;
}
