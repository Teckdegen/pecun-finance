import { NextResponse, type NextRequest } from "next/server";

/**
 * Telegram builds its link preview from the page title, description and image. PECUN's preview should be the
 * image alone, so Telegram's preview bot gets a bare page with just the share image. People and other crawlers
 * (Google, X, Discord) still get the normal page with its titles and descriptions.
 */
export function middleware(req: NextRequest) {
  if (/TelegramBot/i.test(req.headers.get("user-agent") ?? "")) {
    return NextResponse.rewrite(new URL("/link-preview", req.url));
  }
}

// Pages only: skip Next's assets, API routes and any file with an extension (og.jpg, icons and so on).
export const config = { matcher: ["/((?!_next/|api/|link-preview|.*\\.[a-zA-Z0-9]+$).*)"] };
