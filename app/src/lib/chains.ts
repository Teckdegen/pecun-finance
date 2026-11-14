/** EVM chain id → display name. Non-EVM chains use their own names directly. */
const EVM: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  100: "Gnosis",
  130: "Unichain",
  137: "Polygon",
  143: "Monad",
  146: "Sonic",
  250: "Fantom",
  252: "Fraxtal",
  324: "zkSync",
  480: "World Chain",
  999: "HyperEVM",
  1135: "Lisk",
  5042: "Arc",
  1329: "Sei",
  1868: "Soneium",
  1923: "Swellchain",
  2741: "Abstract",
  4217: "Tempo",
  4663: "Robinhood",
  5000: "Mantle",
  8453: "Base",
  9745: "Plasma",
  34443: "Mode",
  42161: "Arbitrum",
  42220: "Celo",
  43114: "Avalanche",
  57073: "Ink",
  59144: "Linea",
  60808: "BOB",
  80094: "Berachain",
  81457: "Blast",
  98866: "Plume",
  534352: "Scroll",
  747474: "Katana",
};

export function evmChainName(id: number | string): string {
  const n = typeof id === "string" ? Number.parseInt(id, 10) : id;
  return EVM[n] ?? `Chain ${id}`;
}

/** Beefy uses its own chain keys. */
export function beefyChainName(key: string): string {
  const map: Record<string, string> = {
    ethereum: "Ethereum", arbitrum: "Arbitrum", base: "Base", optimism: "Optimism", polygon: "Polygon",
    bsc: "BNB Chain", avax: "Avalanche", sonic: "Sonic", linea: "Linea", mantle: "Mantle", gnosis: "Gnosis",
    fraxtal: "Fraxtal", mode: "Mode", scroll: "Scroll", zksync: "zkSync", fantom: "Fantom", lisk: "Lisk",
    berachain: "Berachain", hyperevm: "HyperEVM", unichain: "Unichain", saga: "Saga", sei: "Sei", rootstock: "Rootstock",
    plasma: "Plasma", katana: "Katana", monad: "Monad", celo: "Celo", metis: "Metis", moonbeam: "Moonbeam", kava: "Kava",
    manta: "Manta", real: "Real", cronos: "Cronos", aurora: "Aurora", fuse: "Fuse", canto: "Canto", zkevm: "Polygon zkEVM",
  };
  return map[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Hue per chain for the little chain dots in the UI. */
export const CHAIN_COLOR: Record<string, string> = {
  Ethereum: "#8a9cff", Base: "#2f6bff", Arbitrum: "#3aa0ff", Optimism: "#ff4d5e", Polygon: "#9b6bff",
  "BNB Chain": "#f0b90b", Avalanche: "#e84142", Solana: "#a77bff", Sui: "#4da2ff", Hyperliquid: "#59e3c2",
  HyperEVM: "#59e3c2", Sonic: "#f7a54a", Ink: "#8f5cff", Katana: "#f4d03f", Plasma: "#64d2a8", Monad: "#8d6bff",
  Mantle: "#7ad7c5", Linea: "#61dfff", Unichain: "#ff4fb8", Berachain: "#d7953f", Gnosis: "#3e9a7a",
};

export const STABLES = new Set([
  "USDC", "USDT", "USDT0", "USD₮0", "DAI", "USDS", "USDE", "SUSDE", "PYUSD", "RLUSD", "FDUSD", "TUSD", "GHO", "LUSD",
  "FRAX", "CRVUSD", "USDA", "USDB", "USDG", "USD1", "USDTB", "AUSD", "USDSUI", "BUCK", "SUIUSDT", "WUSDC", "USDY",
  "USDM", "USD0", "USD0++", "DOLA", "EUSD", "MUSD", "SUSDS", "SDAI", "USDX", "USR", "WUSDM", "JUPUSD", "USDH", "FXUSD",
  "OUSD", "PATHUSD", "SYRUPUSDC", "SYRUPUSDT", "USDF", "USDN", "SRUSD", "DEUSD", "USDO", "USX", "CASH", "USDAI",
]);

export function isStable(symbol: string): boolean {
  const s = symbol.toUpperCase().replace(/\.E$/, "");
  if (STABLES.has(s)) return true;
  return /^(S|ST|W|A|C)?USD/.test(s) || s.endsWith("USD") || s.endsWith("USDC") || s.endsWith("USDT");
}
