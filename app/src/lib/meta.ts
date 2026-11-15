import type { Metadata } from "next";
import { SITE_NAME } from "./site";

/** The share image: the Big Bend photo from the X banner, no text (public/og.jpg). */
export const OG_IMAGE = { url: "/og.jpg", width: 1200, height: 630, alt: "PECUN Finance: put your money to work" };

/**
 * Title, description, canonical URL and matching social tags for one page.
 * The share image is set explicitly: a page that sets its own Open Graph tags would otherwise lose the root one.
 */
export function pageMeta({ title, description, path, noindex }: { title: string; description: string; path: string; noindex?: boolean }): Metadata {
  const full = `${title} · PECUN`;
  return {
    title: { absolute: full },
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, title: full, description, url: path, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: full, description, images: [OG_IMAGE.url] },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
