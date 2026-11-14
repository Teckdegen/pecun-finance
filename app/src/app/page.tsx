import { Explorer } from "@/components/explorer";
import { buildCatalog } from "@/lib/catalog.ts";

// Data is cached in memory by the catalog; render on each request so slow sources appear as they finish.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  const [catalog, { q, cat }] = await Promise.all([buildCatalog(), searchParams]);
  // Keyed by category so the phone tab bar (Lend, Vaults, Stake) opens a fresh, pre-filtered list.
  return <Explorer key={`${cat ?? "all"}:${q ?? ""}`} catalog={catalog} initialQuery={q ?? ""} initialCat={cat} />;
}
