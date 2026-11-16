/**
 * The app: where "Launch App" points and where the live figures come from. Production builds use
 * https://app.pecun.finance. Keyed on NODE_ENV (not a Vercel-only variable)
 * because client components read it too, and only NEXT_PUBLIC_ and NODE_ENV values reach the browser.
 */
/** The yields app. Set PECUN_APP_URL to point the landing page at another deployment (e.g. a Vercel preview). */
export const APP_URL = process.env.PECUN_APP_URL || (process.env.NODE_ENV === "production" ? "https://app.pecun.finance" : "http://localhost:3000");

/**
 * Public address of this landing page: the base for the share image, canonical links, sitemap and robots.txt.
 * Link previews (Telegram, X, Discord) need it to be a real public address, so on Vercel it falls back to the
 * project's production domain rather than localhost.
 */
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3001";

/** The docs site. Production builds use https://docs.pecun.finance. */
export const DOCS_URL = process.env.NODE_ENV === "production" ? "https://docs.pecun.finance" : "http://localhost:3002";

/**
 * Pecun's social accounts, shown as icons in the footer.
 * PLACEHOLDERS: swap in the real X profile and Discord invite before launch.
 */
export const SOCIALS = {
  x: "https://x.com/pecunfinance",
  discord: "https://discord.gg/pecunfinance",
};

export const SITE_NAME = "Pecun Finance";
export const SITE_TAGLINE = "Put your money to work.";
export const SITE_DESCRIPTION =
  "Pecun finds the best yield across lending markets, vaults and staking from the top protocols and platforms, and puts your money to work on-chain.";

/** Shown on the legal pages and the contact form. */
export const LEGAL = {
  entity: "Pecun",
  contactEmail: "contact@pecun.finance",
  effectiveDate: "14 November 2026",
};

/** Regions Pecun does not serve. Same list as the app. */
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

const chain = (k: string, name: string) => ({ name, logo: `https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/${k}.svg` });

export const CHAINS = [
  chain("ethereum", "Ethereum"),
  chain("solana", "Solana"),
  chain("sui", "Sui"),
  chain("hyperevm", "Hyperliquid"),
  chain("base", "Base"),
  chain("arbitrum", "Arbitrum"),
];

const debank = (path: string) => `https://static.debank.com/image/${path}`;

/** Turnkey: the wallet infrastructure behind every Pecun wallet (logo from its GitHub organisation, tkhq). */
export const TURNKEY = { name: "Turnkey", logo: "https://avatars.githubusercontent.com/u/104513330?v=4", infra: true };

/**
 * Partners shown on the landing page: the yield platforms Pecun integrates, plus Turnkey.
 * `infra` marks partners that aren't yield platforms, so counts and yield badges can leave them out.
 */
/** Routing the app actually uses: two bridges, plus Aftermath, the Sui aggregator. */
export const INTEGRATIONS: { name: string; logo: string }[] = [
  { name: "Relay", logo: "/logos/integrations/relay.webp" },
  { name: "LI.FI", logo: "/logos/integrations/lifi.webp" },
  { name: "Aftermath", logo: "/logos/integrations/aftermath.webp" },
];

export const PARTNERS: { name: string; logo: string; infra?: boolean }[] = [
  { name: "Aave", logo: "/logos/protocols/aave.png" },
  { name: "Morpho", logo: "/logos/protocols/morpho.ico" },
  TURNKEY,
  { name: "Euler", logo: debank("eth_token/logo_url/0xd9fcd98c322942075a5c3860693e9f4f03aae07b/4af0cfbf57569f8fdb31e4a2fb9d8651.png") },
  { name: "Compound", logo: debank("eth_token/logo_url/0xc00e94cb662c3520282e6f5717214004a7f26888/dd174d3d7083fa027a433dc50edaf0bc.png") },
  { name: "Spark", logo: debank("eth_token/logo_url/0xc20059e0317de91738d13af027dfc4a50781b066/0a37a6ea8ac42a95d75ee255142c102c.png") },
  { name: "Sky", logo: debank("eth_token/logo_url/0x56072c95faa701256059aa122697b133aded9279/6ee24b04e01abbd4f2ace465a430fad4.png") },
  { name: "Lido", logo: "/logos/protocols/lido.png" },
  { name: "Kamino", logo: "/logos/protocols/kamino.png" },
  { name: "Pendle", logo: "/logos/protocols/pendle.ico" },
  { name: "Hyperliquid", logo: "/logos/protocols/hyperliquid.png" },
];
