import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { TabBar } from "@/components/tab-bar";
import { TopBar } from "@/components/topbar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PECUN Finance",
  description: "Every on-chain yield PECUN can execute, across EVM, Solana, Sui and Hyperliquid.",
  applicationName: "PECUN",
  appleWebApp: { capable: true, title: "PECUN", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eef1f8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <TopBar />
        <main className="mx-auto max-w-[1180px] px-4 pb-36 pt-[max(16px,env(safe-area-inset-top))] sm:px-8 md:pb-20 md:pt-6">{children}</main>
        <Suspense fallback={null}>
          <TabBar />
        </Suspense>
      </body>
    </html>
  );
}
