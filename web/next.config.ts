import type { NextConfig } from "next";

const DOCS_URL = (
  process.env.NEXT_PUBLIC_DOCS_URL ?? (process.env.NODE_ENV === "production" ? "https://docs.pecun.finance" : "http://localhost:3002")
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  // The Terms, the Privacy Policy and the Risk Disclosure live on the docs site.
  async redirects() {
    return [
      { source: "/terms", destination: `${DOCS_URL}/terms`, permanent: true },
      { source: "/privacy", destination: `${DOCS_URL}/privacy`, permanent: true },
      { source: "/risk-disclosure", destination: `${DOCS_URL}/risk-disclosure`, permanent: true },
    ];
  },
};

export default nextConfig;
