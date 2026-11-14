import type { MetadataRoute } from "next";

/** Lets phones and desktops install PECUN as an app (Add to Home Screen / Install). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PECUN Finance",
    short_name: "PECUN",
    description: "Every on-chain yield PECUN can execute, across EVM, Solana, Sui and Hyperliquid.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0c0c",
    theme_color: "#0c0c0c",
    icons: [
      { src: "/app-icon?s=192", sizes: "192x192", type: "image/png" },
      { src: "/app-icon?s=512", sizes: "512x512", type: "image/png" },
      { src: "/app-icon?s=512&m=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
