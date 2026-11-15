import type { Metadata } from "next";
import { SITE_NAME } from "./site";

/** The share image: the X banner itself (public/og.jpg). */
export const OG_IMAGE = { url: "/og.jpg", width: 1500, height: 500, alt: "Pecun Finance: put your money to work" };

/**
 * Title, description, canonical URL and matching social tags for one page.
 * The share image is set on every page so a page's own Open Graph tags don't drop it.
 */
export function pageMeta({
  title,
  description,
  path,
  noindex,
  absolute,
}: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  /** Use the title as written, without the brand suffix. */
  absolute?: boolean;
}): Metadata {
  const full = absolute ? title : `${title} · Pecun Finance`;
  return {
    title: absolute ? { absolute: full } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, title: full, description, url: path, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: full, description, images: [OG_IMAGE.url] },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
  };
}
