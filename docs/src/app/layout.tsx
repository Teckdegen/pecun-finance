import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Header } from "@/components/chrome";
import { Sidebar } from "@/components/sidebar";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
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

/** Same share image as the landing page and the app: the photo banner. */
const OG_IMAGE = { url: "/og.jpg", width: 1500, height: 500, alt: "Pecun: put your money to work" };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: "%s · Pecun Docs" },
  description: SITE_DESCRIPTION,
  applicationName: "Pecun Docs",
  openGraph: { type: "website", siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION, url: "/", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION, images: [OG_IMAGE.url] },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fafaf7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable}`}>
      <body className="antialiased">
        <Header />
        <div className="mx-auto flex max-w-7xl flex-col gap-0 px-4 md:px-6 lg:flex-row lg:gap-12">
          <Sidebar />
          {children}
        </div>
      </body>
    </html>
  );
}
