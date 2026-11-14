/** Every platform PECUN lists, with the icon from its own website. Safe to import from client components. */
export const PLATFORMS: { name: string; logo: string }[] = [
  { name: "Morpho", logo: "/logos/protocols/morpho.ico" },
  { name: "Aave", logo: "/logos/protocols/aave.png" },
  { name: "Ember", logo: "/logos/protocols/ember.png" },
  { name: "Pendle", logo: "/logos/protocols/pendle.ico" },
  { name: "Lido", logo: "/logos/protocols/lido.png" },
  { name: "Kamino", logo: "/logos/protocols/kamino.png" },
  { name: "Hyperliquid", logo: "/logos/protocols/hyperliquid.png" },
  { name: "Yearn", logo: "/logos/protocols/yearn.png" },
  { name: "Beefy", logo: "/logos/protocols/beefy.png" },
  { name: "Upshift", logo: "/logos/protocols/upshift.png" },
  { name: "Lagoon", logo: "/logos/protocols/lagoon.png" },
  { name: "Jupiter Lend", logo: "/logos/protocols/jupiter-lend.png" },
  { name: "NAVI", logo: "/logos/protocols/navi.png" },
  { name: "Scallop", logo: "/logos/protocols/scallop.png" },
  { name: "Suilend", logo: "/logos/protocols/suilend.png" },
  { name: "Aftermath", logo: "https://aftermath.finance/coins/afsui.svg" },
  { name: "Gearbox", logo: "/logos/protocols/gearbox.png" },
  // Newer platforms use their governance token's logo from LI.FI's open token list.
  { name: "Euler", logo: "https://static.debank.com/image/eth_token/logo_url/0xd9fcd98c322942075a5c3860693e9f4f03aae07b/4af0cfbf57569f8fdb31e4a2fb9d8651.png" },
  { name: "Compound", logo: "https://static.debank.com/image/eth_token/logo_url/0xc00e94cb662c3520282e6f5717214004a7f26888/dd174d3d7083fa027a433dc50edaf0bc.png" },
  { name: "Moonwell", logo: "https://static.debank.com/image/mobm_token/logo_url/0x511ab53f793683763e5a8829738301368a2411e3/b82e97dd371cfdacb522ffebd7840729.png" },
  { name: "Fluid", logo: "https://etherscan.io/token/images/fluid_32.png" },
  { name: "Spark", logo: "https://static.debank.com/image/eth_token/logo_url/0xc20059e0317de91738d13af027dfc4a50781b066/0a37a6ea8ac42a95d75ee255142c102c.png" },
  { name: "Sky", logo: "https://static.debank.com/image/eth_token/logo_url/0x56072c95faa701256059aa122697b133aded9279/6ee24b04e01abbd4f2ace465a430fad4.png" },
  { name: "Marinade", logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey/logo.png" },
  { name: "Meteora", logo: "https://assets.meteora.ag/met-token.svg" },
];

export const PLATFORM_LOGO: Record<string, string> = Object.fromEntries(PLATFORMS.map((p) => [p.name, p.logo]));
