import { ImageResponse } from "next/og";
import { Icon } from "@/components/app-icon";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Sharp PNG favicon for browsers that prefer it over favicon.ico. */
export default function AppIcon() {
  return new ImageResponse(<Icon size={32} />, size);
}
