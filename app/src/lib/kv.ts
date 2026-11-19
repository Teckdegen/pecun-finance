import "server-only";

/**
 * Upstash Redis over its REST API (no SDK): the small index behind Portfolio and Activity, so a wallet's history and
 * the vaults it uses follow it to any device. Server only; the token never reaches the browser.
 *
 * Env (Vercel → Settings → Environment Variables, from the Upstash console → your database → REST API):
 *   UPSTASH_REDIS_REST_URL     e.g. https://your-db.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN   the database's REST token (never NEXT_PUBLIC)
 */

const URL = process.env.UPSTASH_REDIS_REST_URL ?? "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

export const kvConfigured = () => Boolean(URL && TOKEN);

type Cmd = (string | number)[];

/** Runs several commands in one round trip; returns each one's result. */
export async function kv(commands: Cmd[]): Promise<unknown[]> {
  if (!kvConfigured()) throw new Error("Upstash isn't configured.");
  const res = await fetch(`${URL.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash answered ${res.status}.`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  const err = out.find((r) => r.error);
  if (err) throw new Error(`Upstash: ${err.error}`);
  return out.map((r) => r.result);
}
