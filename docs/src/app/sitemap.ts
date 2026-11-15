import type { MetadataRoute } from "next";
import { PAGES } from "@/lib/pages";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PAGES.map((p) => ({ url: `${SITE_URL}${p.href === "/" ? "" : p.href}`, lastModified, changeFrequency: "weekly", priority: p.href === "/" ? 1 : 0.6 }));
}
