import { ImageResponse } from "next/og";
import { Mark } from "@/components/mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPhone and iPad. */
export default function AppleIcon() {
  return new ImageResponse(<Mark size={180} backdrop />, size);
}
