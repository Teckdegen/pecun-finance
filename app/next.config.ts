import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Heavy chain SDKs are loaded at runtime on the server instead of being bundled.
  serverExternalPackages: ["@suilend/sdk", "@mysten/sui", "@gearbox-protocol/sdk", "viem"],
  // Vault pages moved from /vault/* to /earn/*; keep old links working.
  async redirects() {
    return [{ source: "/vault/:slug", destination: "/earn/:slug", permanent: true }];
  },
};

export default nextConfig;
