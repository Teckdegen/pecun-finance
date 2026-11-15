/** Where "Launch App" points. Set NEXT_PUBLIC_APP_URL in production (e.g. https://app.pecun.finance). */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Public address of this landing page, for metadata. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001").replace(/\/$/, "");

export const SITE_NAME = "PECUN Finance";
export const SITE_TAGLINE = "Put your money to work.";
export const SITE_DESCRIPTION =
  "PECUN finds the best yield across lending markets, vaults and staking on Ethereum, Solana, Sui, Hyperliquid and more, and puts your money to work on-chain.";

/** Shown on the privacy policy, the terms and the contact form. Override with env vars. */
export const LEGAL = {
  entity: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "PECUN",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@pecun.finance",
  effectiveDate: "14 November 2026",
};

/** Regions PECUN does not serve. Same list as the app. */
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

/** Turnkey: the wallet infrastructure behind every PECUN wallet (logo from its GitHub organisation, tkhq). */
export const TURNKEY = { name: "Turnkey", logo: "https://avatars.githubusercontent.com/u/104513330?v=4", infra: true };

/**
 * Partners shown on the landing page: the yield platforms PECUN integrates, plus Turnkey.
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
