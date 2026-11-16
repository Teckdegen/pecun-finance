import type { Metadata, Viewport } from "next";
import { OG_IMAGE } from "@/lib/meta";
import localFont from "next/font/local";
import { AuthProvider } from "@/components/auth-provider";
import { AppShell } from "@/components/shell";
import { CookieBanner } from "@/components/cookie-banner";
import { TermsGate } from "@/components/terms-gate";
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

const robotoMono = localFont({
  src: [{ path: "./fonts/roboto-mono-500.woff2", weight: "500", style: "normal" }],
  variable: "--font-roboto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Pages set their own title; the template adds the brand.
  title: { default: `${SITE_NAME} · ${SITE_TAGLINE}`, template: "%s · Pecun" },
  description: SITE_DESCRIPTION,
  applicationName: "Pecun",
  openGraph: { type: "website", siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION, url: "/", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION, images: [OG_IMAGE.url] },
  appleWebApp: { capable: true, title: "Pecun", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0c0c",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${robotoMono.variable}`}>
      <body className="antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
        <TermsGate />
        <CookieBanner />
      </body>
    </html>
  );
}
