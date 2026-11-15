/** The Pecun leaf on black, drawn for next/og image generation. `pad` leaves the margin maskable icons need. */
export function Icon({ size, pad = 0 }: { size: number; pad?: number }) {
  const leaf = size * (1 - pad * 2) * 0.72;
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0c0c0c" }}>
      <svg width={leaf} height={leaf} viewBox="12 12 40 40">
        <path d="M14 50C14 28 28 14 50 14Z" fill="#ffffff" />
        <path d="M50 14C50 36 36 50 14 50Z" fill="#b8ff9d" />
      </svg>
    </div>
  );
}
