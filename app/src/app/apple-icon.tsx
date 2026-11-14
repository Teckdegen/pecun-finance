import { ImageResponse } from "next/og";
import { Icon } from "@/components/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPhone and iPad. */
export default function AppleIcon() {
  return new ImageResponse(<Icon size={180} />, size);
}
