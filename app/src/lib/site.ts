/** Site-wide facts used by metadata, the sitemap, robots.txt, social images and the legal pages. */

/**
 * Public address of the site. Set NEXT_PUBLIC_SITE_URL in production (e.g. https://pecun.finance);
 * on Vercel the production domain is picked up automatically.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

export const SITE_NAME = "Pecun Finance";
export const SITE_TAGLINE = "Put your money to work.";
export const SITE_DESCRIPTION =
  "Earn yield on your crypto across the top protocols and platforms. Compare vaults, lending, staking and fixed yield in one place.";

/**
 * Details the legal pages need, shown on /terms, /privacy and /risk-disclosure. Each can be overridden with an env var.
 * Governing law and disputes follow each user's own country or region (see /terms).
 */
export const LEGAL = {
  entity: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "Pecun",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@pecun.finance",
  effectiveDate: "14 November 2026",
  /** Version of the terms, saved with each acceptance as a record. (The dialog shows once per device regardless.) */
  termsVersion: "2026-11-14.2",
};

/** Regions Pecun does not serve: every region blocked by a protocol or provider Pecun integrates, combined. */
export const UNSUPPORTED_REGIONS = [
  "United States",
  "United Kingdom",
  "Ontario (Canada)",
  "Panama",
  "Singapore",
  "China",
  "Russia and Belarus",
  "Venezuela",
  "Myanmar, Sudan and Zimbabwe",
  "Côte d'Ivoire, Iraq and Libya",
  "DR Congo, Mali, Nicaragua, Somalia and Yemen",
  "Liberia",
  "Cuba, Iran, North Korea and Syria",
  "Crimea, Sevastopol, Donetsk, Luhansk, Kherson and Zaporizhzhia",
  "FATF high-risk jurisdictions, and anywhere under OFAC, EU, UN or UK sanctions",
];
