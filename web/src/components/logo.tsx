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

/** The PECUN mark: lime tile, black letter. */
export function PecunMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[7px] bg-lime font-tight font-medium leading-none text-ink"
      style={{ width: size, height: size, fontSize: size * 0.56, letterSpacing: "-0.04em" }}
    >
      P
    </span>
  );
}
