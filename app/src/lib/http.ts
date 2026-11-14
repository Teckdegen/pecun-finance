const DEFAULT_TIMEOUT_MS = 45_000;
/** Identify ourselves honestly to upstream APIs. */
const UA = "PECUN/0.1 (yield catalog)";

const RETRY_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A few retries with backoff for rate limits and transient upstream errors. */
async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const retryable = RETRY_STATUSES.has(res.status);
    if (res.ok || !retryable || attempt >= 3) {
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}${body ? `: ${body.slice(0, 160).replace(/\s+/g, " ")}` : ""}`);
      }
      return res;
    }
    await sleep(1200 * (attempt + 1) + Math.random() * 800);
  }
}

// Caching is done in-memory by the catalog (several responses exceed Next's 2MB data-cache limit).
export async function getJson<T = unknown>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const res = await request(url, { headers: { accept: "application/json", "user-agent": UA } }, timeoutMs);
  return (await res.json()) as T;
}

export async function postJson<T = unknown>(url: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const res = await request(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "user-agent": UA },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  return (await res.json()) as T;
}

export async function gql<T = unknown>(url: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const body = await postJson<{ data?: T; errors?: { message: string }[] }>(url, { query, variables });
  if (body.errors?.length) throw new Error(body.errors[0].message);
  if (!body.data) throw new Error("Empty GraphQL response");
  return body.data;
}

/** Run async work over items with a concurrency cap. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};

export const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
