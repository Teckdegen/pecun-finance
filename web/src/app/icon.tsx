import { ImageResponse } from "next/og";
import { Mark } from "@/components/mark";

/** 16, 32 and 192px favicons. Next adds each one to the document head. */
export function generateImageMetadata() {
  return [16, 32, 192].map((size) => ({
    id: String(size),
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = Number(await id) || 32;
  return new ImageResponse(<Mark size={size} />, { width: size, height: size });
}
