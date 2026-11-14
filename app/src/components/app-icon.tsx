/** The PECUN app mark, drawn for next/og image generation. */
export function Icon({ size, pad = 0 }: { size: number; pad?: number }) {
  const inner = size * (1 - pad * 2);
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#15171c" }}>
      <div
        style={{
          width: inner,
          height: inner,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: pad ? inner * 0.22 : 0,
          background: "linear-gradient(140deg, #3d6df2 0%, #8a6bff 55%, #15171c 100%)",
          color: "white",
          fontSize: inner * 0.56,
          fontWeight: 700,
          letterSpacing: -inner * 0.02,
        }}
      >
        P
      </div>
    </div>
  );
}
