import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppShell } from "@/components/shell";
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
  title: "PECUN Finance",
  description: "Every on-chain yield PECUN can execute, across EVM, Solana, Sui and Hyperliquid.",
  applicationName: "PECUN",
  appleWebApp: { capable: true, title: "PECUN", statusBarStyle: "black-translucent" },
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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
