/** Production builds point at the live Pecun sites; local dev points at the local servers. */
const prod = process.env.NODE_ENV === "production";

/** The app, where "Launch App" goes. */
export const APP_URL = prod ? "https://app.pecun.finance" : "http://localhost:3000";

/** The landing page. */
export const WEBSITE_URL = prod ? "https://pecun.finance" : "http://localhost:3001";

/** This docs site: the base for the share image, canonical links and the sitemap. */
export const SITE_URL = prod ? "https://docs.pecun.finance" : "http://localhost:3002";

export const SITE_NAME = "Pecun Docs";
export const SITE_DESCRIPTION =
  "How Pecun works: finding yield across the top protocols and platforms, depositing, withdrawing, fees, your wallet, risks and the Pecun token.";

export const CONTACT_EMAIL = "contact@pecun.finance";

/** Shown in the Terms, the Privacy Policy and the Risk Disclosure. Same values as the app. */
export const LEGAL = {
  entity: "Pecun",
  contactEmail: CONTACT_EMAIL,
  effectiveDate: "14 November 2026",
};

/** PLACEHOLDERS: swap in the real X profile and Discord invite before launch (same as the landing page). */
export const SOCIALS = {
  x: "https://x.com/pecunfinance",
  discord: "https://discord.gg/pecunfinance",
};

/** Regions Pecun does not serve. Same list as the app and the landing page. */
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

const debank = (path: string) => `https://static.debank.com/image/${path}`;
const local = (file: string) => `/logos/protocols/${file}`;

/** Every platform Pecun lists. Same list as the app. */
export const PROTOCOLS: { name: string; logo: string; kind: string }[] = [
  { name: "Aave", logo: local("aave.png"), kind: "Lending" },
  { name: "Morpho", logo: local("morpho.ico"), kind: "Lending and vaults" },
  { name: "Lido", logo: local("lido.png"), kind: "Liquid staking" },
  { name: "Pendle", logo: local("pendle.ico"), kind: "Fixed yield" },
  { name: "Ember", logo: local("ember.png"), kind: "Vaults" },
  { name: "Kamino", logo: local("kamino.png"), kind: "Lending and vaults" },
  { name: "Hyperliquid", logo: local("hyperliquid.png"), kind: "Vaults" },
  { name: "Yearn", logo: local("yearn.png"), kind: "Vaults" },
  { name: "Beefy", logo: local("beefy.png"), kind: "Vaults" },
  { name: "Upshift", logo: local("upshift.png"), kind: "Vaults" },
  { name: "Lagoon", logo: local("lagoon.png"), kind: "Vaults" },
  { name: "Jupiter Lend", logo: local("jupiter-lend.png"), kind: "Lending" },
  { name: "NAVI", logo: local("navi.png"), kind: "Lending" },
  { name: "Scallop", logo: local("scallop.png"), kind: "Lending" },
  { name: "Suilend", logo: local("suilend.png"), kind: "Lending" },
  { name: "Aftermath", logo: "https://aftermath.finance/coins/afsui.svg", kind: "Liquid staking" },
  { name: "Gearbox", logo: local("gearbox.png"), kind: "Lending" },
  { name: "Euler", logo: debank("eth_token/logo_url/0xd9fcd98c322942075a5c3860693e9f4f03aae07b/4af0cfbf57569f8fdb31e4a2fb9d8651.png"), kind: "Lending" },
  { name: "Compound", logo: debank("eth_token/logo_url/0xc00e94cb662c3520282e6f5717214004a7f26888/dd174d3d7083fa027a433dc50edaf0bc.png"), kind: "Lending" },
  { name: "Moonwell", logo: debank("mobm_token/logo_url/0x511ab53f793683763e5a8829738301368a2411e3/b82e97dd371cfdacb522ffebd7840729.png"), kind: "Lending" },
  { name: "Fluid", logo: local("fluid.png"), kind: "Lending" },
  { name: "Spark", logo: debank("eth_token/logo_url/0xc20059e0317de91738d13af027dfc4a50781b066/0a37a6ea8ac42a95d75ee255142c102c.png"), kind: "Savings and lending" },
  { name: "Ethena", logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x57e114B691Db790C35207b2e685D4A43181e6061/logo.png", kind: "Delta-neutral" },
  { name: "Sky", logo: debank("eth_token/logo_url/0x56072c95faa701256059aa122697b133aded9279/6ee24b04e01abbd4f2ace465a430fad4.png"), kind: "Savings" },
  { name: "Marinade", logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey/logo.png", kind: "Liquid staking" },
  { name: "Meteora", logo: "https://assets.meteora.ag/met-token.svg", kind: "Liquidity pools" },
  { name: "Venus", logo: local("venus.png"), kind: "Lending" },
  { name: "Silo", logo: local("silo.png"), kind: "Isolated lending and vaults" },
  { name: "GMX", logo: local("gmx.png"), kind: "Perps liquidity" },
  { name: "Jupiter", logo: local("jupiter.png"), kind: "Perps liquidity" },
  { name: "Volo", logo: local("volo.ico"), kind: "Liquid staking" },
  { name: "Rocket Pool", logo: local("rocketpool.png"), kind: "Liquid staking" },
  { name: "Frax", logo: local("frax.ico"), kind: "Savings and staking" },
  { name: "ether.fi", logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xFe0c30065B384F05761f15d0CC899D4F9F9Cc0eB/logo.png", kind: "Restaking" },
  { name: "Resolv", logo: local("resolv.svg"), kind: "Delta-neutral" },
  { name: "Kinetiq", logo: local("kinetiq.svg"), kind: "Liquid staking" },
  { name: "Spectra", logo: local("spectra.ico"), kind: "Fixed yield" },
  { name: "Veranta (formerly Avantis)", logo: local("avantis.png"), kind: "Perps liquidity" },
  { name: "HyperLend", logo: local("hyperlend.ico"), kind: "Lending" },
  { name: "Frgmnt", logo: local("frgmnt.png"), kind: "Curated lending vaults" },
  { name: "Solana stake pools", logo: local("jito.png"), kind: "Liquid staking: Jito, BlazeStake, Drift and more" },
];
