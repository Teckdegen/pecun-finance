import { notFound } from "next/navigation";
import { VaultView } from "@/components/vault-view";
import { findBySlug } from "@/lib/catalog.ts";
import { pageMeta } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { item } = await findBySlug(slug);
  if (!item) return { title: { absolute: "Vault not found · PECUN" }, robots: { index: false } };
  const apy = item.apy30d ?? item.apy7d ?? item.apy;
  const rate = apy !== null ? `${(apy * 100).toFixed(2)}% APY` : "Variable APY";
  // "Steakhouse on Morpho", but just "Aave Ethereum" when the manager already names the protocol.
  const by = !item.manager || item.manager.includes(item.protocol) ? item.manager || item.protocol : `${item.manager} on ${item.protocol}`;
  return pageMeta({
    title: item.name,
    description: `${rate} on ${item.asset} via ${by} (${item.chain}). See rates, TVL and risks, then deposit with PECUN.`,
    path: `/earn/${slug}`,
    // Closed vaults stay reachable for holders but shouldn't be found in search.
    noindex: !!item.status && item.status !== "open",
  });
}

export default async function VaultPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { item } = await findBySlug(slug);
  if (!item) notFound();

  return <VaultView o={item} deployments={[item]} />;
}
