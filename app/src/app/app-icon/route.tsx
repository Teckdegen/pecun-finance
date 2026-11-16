import { ImageResponse } from "next/og";
import { Mark } from "@/components/mark";

/** Install icon at any size (?s=192 or ?s=512): the same leaf as the landing page and docs, on white. */
export function GET(req: Request) {
  const s = Math.min(1024, Math.max(32, Number(new URL(req.url).searchParams.get("s")) || 512));
  return new ImageResponse(<Mark size={s} backdrop />, { width: s, height: s });
}
