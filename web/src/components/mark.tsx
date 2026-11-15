/**
 * The PECUN leaf for next/og (favicons and the Apple icon), in the site's light colours: black top half,
 * lime bottom half. Favicons are the bare leaf on a transparent background; `backdrop` paints a white
 * square behind it for the Apple icon, since iOS fills transparent icons with black.
 */
export function Mark({ size, backdrop = false }: { size: number; backdrop?: boolean }) {
  const leaf = backdrop ? size * 0.7 : size;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: backdrop ? "#ffffff" : "transparent",
      }}
    >
      <svg width={leaf} height={leaf} viewBox="12 12 40 40">
        <path d="M14 50C14 28 28 14 50 14Z" fill="#0a0a0a" />
        <path d="M50 14C50 36 36 50 14 50Z" fill="#9aee78" />
      </svg>
    </div>
  );
}
