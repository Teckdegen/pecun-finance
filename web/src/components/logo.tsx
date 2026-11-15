"use client";

import { useState } from "react";

/** A round logo image that falls back to a coloured letter if the image can't load. */
export function Logo({ src, label, size = 32, className = "" }: { src?: string; label: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const hue = [...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    return (
      <span
        role="img"
        aria-label={`${label} logo`}
        className={`grid shrink-0 place-items-center rounded-full font-medium text-white ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4, background: `radial-gradient(circle at 30% 25%, hsl(${hue} 55% 60%), hsl(${hue} 50% 34%))` }}
      >
        {label.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- logos come from many external hosts
    <img
      src={src}
      alt={`${label} logo`}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full bg-white object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The Pecun mark: a leaf split down its vein. On light backgrounds the top half is black and the bottom half lime (a touch deeper, so it holds up on white);
 * `tone="dark"` swaps the black for white so it still reads on dark backgrounds.
 */
export function PecunMark({ size = 28, tone = "light" }: { size?: number; tone?: "light" | "dark" }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="12 12 40 40" className="shrink-0">
      <path d="M14 50C14 28 28 14 50 14Z" fill={tone === "dark" ? "#ffffff" : "#0a0a0a"} />
      <path d="M50 14C50 36 36 50 14 50Z" fill={tone === "dark" ? "#b8ff9d" : "#9aee78"} />
    </svg>
  );
}
