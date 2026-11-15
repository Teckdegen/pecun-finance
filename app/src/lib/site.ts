/** Site-wide facts used by metadata, the sitemap, robots.txt, social images and the legal pages. */

/** The app's public address: production is app.pecun.finance, local dev is localhost. */
export const SITE_URL = process.env.NODE_ENV === "production" ? "https://app.pecun.finance" : "http://localhost:3000";

/**
 * The docs site, which also hosts the Terms, the Privacy Policy and the Risk Disclosure. Keyed on NODE_ENV so client
 * components (the sidebar, the terms dialog) see the same value.
 */
export const DOCS_URL = process.env.NODE_ENV === "production" ? "https://docs.pecun.finance" : "http://localhost:3002";

export const SITE_NAME = "Pecun Finance";
export const SITE_TAGLINE = "Put your money to work.";
export const SITE_DESCRIPTION =
  "Earn yield on your crypto across the top protocols and platforms. Compare vaults, lending, staking and fixed yield in one place.";

/**
 * Details the legal pages need, shown on /terms, /privacy and /risk-disclosure. Each can be overridden with an env var.
 * Governing law and disputes follow each user's own country or region (see /terms).
 */
export const LEGAL = {
  entity: "Pecun",
  contactEmail: "contact@pecun.finance",
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
