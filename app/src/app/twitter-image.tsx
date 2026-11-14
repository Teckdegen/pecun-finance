import OpengraphImage from "./opengraph-image";

// X (Twitter) uses the same share card as Open Graph.
export const alt = "PECUN Finance: put your money to work across EVM, Solana, Sui and Hyperliquid";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return OpengraphImage();
}
