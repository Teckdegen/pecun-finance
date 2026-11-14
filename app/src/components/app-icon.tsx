/** The PECUN app mark in Hood colours (lime tile, black letter), drawn for next/og image generation. */
export function Icon({ size, pad = 0 }: { size: number; pad?: number }) {
  const inner = size * (1 - pad * 2);
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0c0c0c" }}>
      <div
        style={{
          width: inner,
          height: inner,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: pad ? inner * 0.22 : 0,
          background: "#b8ff9d",
          color: "#0a0b0d",
          fontSize: inner * 0.56,
          fontWeight: 600,
          letterSpacing: -inner * 0.03,
        }}
      >
        P
      </div>
    </div>
  );
}
