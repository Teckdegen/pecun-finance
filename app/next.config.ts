import type { NextConfig } from "next";

const DOCS_URL = (
  process.env.NEXT_PUBLIC_DOCS_URL ?? (process.env.NODE_ENV === "production" ? "https://docs.pecun.finance" : "http://localhost:3002")
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Heavy chain SDKs are loaded at runtime on the server instead of being bundled.
  serverExternalPackages: ["@suilend/sdk", "@mysten/sui", "@gearbox-protocol/sdk", "viem"],
  // Vault pages moved from /vault/* to /earn/*; keep old links working.
  async redirects() {
    return [
      { source: "/vault/:slug", destination: "/earn/:slug", permanent: true },
      // The Terms, the Privacy Policy and the Risk Disclosure live on the docs site.
      { source: "/terms", destination: `${DOCS_URL}/terms`, permanent: true },
      { source: "/privacy", destination: `${DOCS_URL}/privacy`, permanent: true },
      { source: "/risk-disclosure", destination: `${DOCS_URL}/risk-disclosure`, permanent: true },
    ];
  },
};

export default nextConfig;
