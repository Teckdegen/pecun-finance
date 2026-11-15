import type { NextConfig } from "next";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // The only Terms of Service live in the app; old links to this site's /terms go there.
  async redirects() {
    return [{ source: "/terms", destination: `${APP_URL}/terms`, permanent: true }];
  },
};

export default nextConfig;
