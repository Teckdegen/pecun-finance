import { Download } from "lucide-react";
import type { Metadata } from "next";
import { Doc, H2, P } from "@/components/chrome";
import { PecunMark } from "@/components/logo";

export const metadata: Metadata = { title: "Brand kit", description: "The Pecun logo, colours and images." };

const COLOURS = [
  { name: "Lime", hex: "#B8FF9D", text: "#0a0a0a" },
  { name: "Deep green", hex: "#2F7D1C", text: "#ffffff" },
  { name: "Ink", hex: "#0A0A0A", text: "#ffffff" },
  { name: "Paper", hex: "#FAFAF7", text: "#0a0a0a" },
];

const FILES = [
  { href: "/brand/pecun-pfp-deep-green.png", name: "Profile picture", size: "1000 × 1000" },
  { href: "/brand/pecun-banner-photo.png", name: "Banner", size: "1500 × 500" },
];

export default function Brand() {
  return (
    <Doc href="/brand">
      <P>
        The Pecun mark is a leaf split down its vein. It&apos;s always a symbol on its own, with no letters. Write the name as &ldquo;Pecun&rdquo;.
      </P>

      <H2>The mark</H2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid h-44 place-items-center rounded-2xl border border-line bg-white">
          <PecunMark size={96} />
        </div>
        <div className="grid h-44 place-items-center rounded-2xl bg-[#0a0a0a]">
          <PecunMark size={96} tone="dark" />
        </div>
      </div>
      <P>On light backgrounds the leaf is black and lime. On dark backgrounds the black half turns white.</P>

      <H2>Colours</H2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {COLOURS.map((c) => (
          <div key={c.name} className="overflow-hidden rounded-2xl border border-line">
            <div className="h-20" style={{ background: c.hex }} />
            <div className="px-4 py-3">
              <p className="font-tight font-medium text-ink">{c.name}</p>
              <p className="text-sm text-[#8a8a83]">{c.hex}</p>
            </div>
          </div>
        ))}
      </div>

      <H2>Images</H2>
      <div className="grid gap-3 sm:grid-cols-2">
        {FILES.map((f) => (
          <a key={f.href} href={f.href} download className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4 hover:border-ink/30">
            <span>
              <span className="block font-tight font-medium text-ink">{f.name}</span>
              <span className="block text-sm text-[#8a8a83]">PNG · {f.size}</span>
            </span>
            <Download className="size-5 text-[#5e5e58]" />
          </a>
        ))}
      </div>
    </Doc>
  );
}
