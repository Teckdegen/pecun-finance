import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Nav } from "@/components/nav";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
import "./globals.css";

const inter = localFont({
  src: [
    { path: "./fonts/inter-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

const interTight = localFont({
  src: [{ path: "./fonts/inter-tight-500.woff2", weight: "500", style: "normal" }],
  variable: "--font-inter-tight",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} · ${SITE_TAGLINE}`, template: "%s · PECUN Finance" },
  description: SITE_DESCRIPTION,
  applicationName: "PECUN",
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: "/",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "PECUN Finance: put your money to work across EVM, Solana, Sui and Hyperliquid" }],
  },
  twitter: { card: "summary_large_image", title: `${SITE_NAME} · ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <Nav />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
