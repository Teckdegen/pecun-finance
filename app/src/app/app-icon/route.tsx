import { ImageResponse } from "next/og";
import { Icon } from "@/components/app-icon";

/** App icon at any size: ?s=192 or ?s=512; &m=1 adds the padding maskable icons need. */
export function GET(req: Request) {
  const url = new URL(req.url);
  const s = Math.min(1024, Math.max(32, Number(url.searchParams.get("s")) || 512));
  const maskable = url.searchParams.get("m") === "1";
  return new ImageResponse(<Icon size={s} pad={maskable ? 0.2 : 0} />, { width: s, height: s });
}
