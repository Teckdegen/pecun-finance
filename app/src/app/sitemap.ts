import type { MetadataRoute } from "next";
import { buildCatalog } from "@/lib/catalog";
import { SITE_URL } from "@/lib/site";

// Built from the live catalog, so new vaults appear and delisted ones drop out.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/portfolio`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/risk-disclosure`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
  const catalog = await buildCatalog().catch(() => null);
  const vaults: MetadataRoute.Sitemap = (catalog?.opportunities ?? [])
    .filter((o) => o.slug)
    .map((o) => ({ url: `${SITE_URL}/earn/${o.slug}`, lastModified: now, changeFrequency: "daily", priority: 0.6 }));
  return [...pages, ...vaults];
}
