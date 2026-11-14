import { Explorer } from "@/components/explorer";
import { buildCatalog } from "@/lib/catalog.ts";

// Data is cached in memory by the catalog; render on each request so slow sources appear as they finish.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; earn?: string }> }) {
  const [catalog, { q, earn }] = await Promise.all([buildCatalog(), searchParams]);
  // Keyed by the earn type so Staking, Vaults and the rest open a fresh, pre-filtered list.
  return <Explorer key={`${earn ?? "all"}:${q ?? ""}`} catalog={catalog} initialQuery={q ?? ""} initialEarn={earn} />;
}
