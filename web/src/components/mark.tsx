/** Lime tile, black P. Drawn for next/og so the favicon set and Apple icon match the site. */
export function Mark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#b8ff9d",
        color: "#0a0a0a",
        fontSize: Math.round(size * 0.56),
        fontWeight: 600,
        borderRadius: Math.max(2, Math.round(size * 0.22)),
        letterSpacing: `${-size * 0.04}px`,
      }}
    >
      P
    </div>
  );
}
