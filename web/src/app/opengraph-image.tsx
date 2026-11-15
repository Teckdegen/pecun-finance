import { ImageResponse } from "next/og";

export const alt = "PECUN Finance: put your money to work across EVM, Solana, Sui and Hyperliquid";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social share card, matching the app's. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0c0c0c", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width={72} height={72} viewBox="12 12 40 40">
            <path d="M14 50C14 28 28 14 50 14Z" fill="#ffffff" />
            <path d="M50 14C50 36 36 50 14 50Z" fill="#b8ff9d" />
          </svg>
          <div style={{ fontSize: 36, fontWeight: 600 }}>PECUN Finance</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: -3, lineHeight: 1 }}>Put your money to work.</div>
          <div style={{ fontSize: 32, color: "#a3a3a3" }}>Vaults, lending, staking and fixed yield in one place.</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {["EVM", "Solana", "Sui", "Hyperliquid"].map((c) => (
            <div key={c} style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: "#1a1a1a", border: "1px solid #2a2a2a", fontSize: 26, color: "#d4d4d4" }}>
              {c}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
