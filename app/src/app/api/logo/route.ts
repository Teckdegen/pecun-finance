import { isKnownLogo } from "@/lib/logos.ts";

/**
 * Serves token, protocol and chain logos from Pecun's own origin.
 * Logos live on many slow third-party hosts (GitHub, DeBank, IPFS…); on a weak connection the
 * browser gives up on them and the UI falls back to a letter. Here the server fetches each logo
 * once, with retries, keeps it in memory and lets the browser cache it for a week.
 */

export const runtime = "nodejs";

type Cached = { body: ArrayBuffer; type: string; at: number };
const g = globalThis as unknown as { __pecunLogoCache?: Map<string, Cached>; __pecunLogoBytes?: number };
const cache = (g.__pecunLogoCache ??= new Map());

/**
 * Memory budget for cached logos, shared by everything in this server instance. Vercel's CDN also caches each logo
 * response for a week, so this only has to absorb the first requests. An uncapped cache (4,000 logos × up to 2 MB)
 * ran instances out of memory.
 */
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_BYTES = 512 * 1024;
const TTL_MS = 7 * 24 * 60 * 60_000;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|avif)(\?|$)/i;

async function fetchLogo(url: string): Promise<Cached> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "image/*", "user-agent": "Pecun/0.1 (logo cache)" },
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
      let type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      // Some hosts send images as octet-stream; trust the file extension then.
      if (!type.startsWith("image/")) {
        if (!IMAGE_EXT.test(url)) throw new Error(`Not an image (${type || "no type"})`);
        const ext = url.match(IMAGE_EXT)![1].toLowerCase();
        type = ext === "svg" ? "image/svg+xml" : ext === "ico" ? "image/x-icon" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      }
      const body = await res.arrayBuffer();
      if (body.byteLength > MAX_BYTES) throw new Error("Logo too large");
      return { body, type, at: Date.now() };
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Adds a logo, dropping the least recently used ones until the cache fits its byte budget. */
function remember(url: string, c: Cached) {
  const old = cache.get(url);
  if (old) {
    g.__pecunLogoBytes = (g.__pecunLogoBytes ?? 0) - old.body.byteLength;
    cache.delete(url);
  }
  cache.set(url, c);
  g.__pecunLogoBytes = (g.__pecunLogoBytes ?? 0) + c.body.byteLength;
  while ((g.__pecunLogoBytes ?? 0) > MAX_TOTAL_BYTES && cache.size > 1) {
    const [oldestUrl, oldest] = cache.entries().next().value as [string, Cached];
    cache.delete(oldestUrl);
    g.__pecunLogoBytes = (g.__pecunLogoBytes ?? 0) - oldest.body.byteLength;
  }
}

function send(c: Cached): Response {
  return new Response(c.body, {
    headers: {
      "content-type": c.type,
      "cache-control": "public, max-age=604800, immutable",
      "x-content-type-options": "nosniff",
      // SVGs are served from our origin: never let one run script.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("u") ?? "";
  if (!url.startsWith("https://") || !isKnownLogo(url)) return new Response("Unknown logo", { status: 404 });
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) {
    // Move to the back so the most used logos are the last to be dropped.
    cache.delete(url);
    cache.set(url, hit);
    return send(hit);
  }
  try {
    const fresh = await fetchLogo(url);
    remember(url, fresh);
    return send(fresh);
  } catch {
    // Serve a stale copy if we have one; otherwise let the browser try the original URL.
    if (hit) return send(hit);
    return new Response("Logo unavailable", { status: 502, headers: { "cache-control": "no-store" } });
  }
}
