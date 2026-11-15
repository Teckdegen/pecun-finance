/**
 * The page Telegram's preview bot is shown (see src/middleware.ts): the share image and nothing else, so the
 * preview is the image alone with no title or description. The image URL is built from the request, so it works
 * on every domain the site is served from.
 */
export function GET(req: Request) {
  const image = new URL("/og.jpg", req.url).toString();
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="robots" content="noindex" />
<meta property="og:type" content="website" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1500" />
<meta property="og:image:height" content="500" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${image}" />
</head>
<body></body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
