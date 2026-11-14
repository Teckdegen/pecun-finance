import { aave, aaveV4, beefy, euler, fluid, lagoon, lido, morpho, pendle, savingsGho, upshift, yearn } from "./adapters/evm.ts";
import { aftermath, ember, hyperliquid, jupiterLend, kamino, marinade, meteora, navi, scallop, solanaStaking } from "./adapters/nonevm.ts";
import { compound, sky, spark } from "./adapters/onchain.ts";
import { gearbox, moonwell, suilend } from "./adapters/sdk.ts";
import { getLogoIndex, withLogos } from "./logos.ts";
import type { Catalog, Opportunity, SourceStatus } from "./types.ts";

const SOURCES: [string, () => Promise<Opportunity[]>][] = [
  ["Ember", ember],
  ["Upshift", upshift],
  ["Morpho", morpho],
  ["Aave", aave],
  ["Pendle", pendle],
  ["Yearn", yearn],
  ["Beefy", beefy],
  ["Lagoon", lagoon],
  ["Lido", lido],
  ["Kamino", kamino],
  ["Jupiter Lend", jupiterLend],
  ["NAVI", navi],
  ["Scallop", scallop],
  ["Hyperliquid", hyperliquid],
  ["Solana staking", solanaStaking],
  ["Aftermath", aftermath],
  ["Suilend", suilend],
  ["Gearbox", gearbox],
  ["Aave V4", aaveV4],
  ["Savings GHO", savingsGho],
  ["Euler", euler],
  ["Compound", compound],
  ["Moonwell", moonwell],
  ["Fluid", fluid],
  ["Spark", spark],
  ["Sky", sky],
  ["Marinade", marinade],
  ["Meteora", meteora],
];

/** Testnet deployments sometimes appear in protocol lists; never show them. */
const TESTNET = /sepolia|testnet|goerli|holesky|devnet/i;
/** Below this an APY rounds to 0.00%, so it is not listed. */
const MIN_APY = 0.00005;
/** Drop dust: anything under this TVL is not listed at all. */
const MIN_TVL_USD = 1_000;
/** APYs above this are almost always broken data or dead pools. */
const MAX_SANE_APY = 10; // 1,000%
/** How long a source's data stays fresh before a background refresh. */
const FRESH_MS = 5 * 60_000;
/** How long a page request waits for a source that has no data yet. */
const FIRST_LOAD_WAIT_MS = 25_000;
/** Sources we've already waited on once; later requests never block on them again. */
const waitedOnce = ((globalThis as unknown as { __pecunWaited?: Set<string> }).__pecunWaited ??= new Set<string>());

type Entry = { items: Opportunity[]; at: number; ms: number; error?: string };

// Module-level stale-while-revalidate cache, shared across requests in this server process.
const g = globalThis as unknown as { __pecunCache?: Map<string, Entry>; __pecunInflight?: Map<string, Promise<void>> };
const cache = (g.__pecunCache ??= new Map());
const inflight = (g.__pecunInflight ??= new Map());

function refresh(name: string, fn: () => Promise<Opportunity[]>): Promise<void> {
  const running = inflight.get(name);
  if (running) return running;
  const t0 = Date.now();
  const p = fn()
    .then((items) => {
      // An empty answer from a source that had data is treated as a glitch: keep the old data.
      const prev = cache.get(name);
      if (items.length === 0 && prev?.items.length) throw new Error("Source returned no data");
      cache.set(name, { items, at: Date.now(), ms: Date.now() - t0 });
    })
    .catch((e: unknown) => {
      const prev = cache.get(name);
      const error = e instanceof Error ? e.message : String(e);
      // Keep serving the last good data if we have it; record the error either way.
      cache.set(name, { items: prev?.items ?? [], at: Date.now(), ms: Date.now() - t0, error });
    })
    .finally(() => inflight.delete(name));
  inflight.set(name, p);
  return p;
}

async function readSource(name: string, fn: () => Promise<Opportunity[]>): Promise<{ status: SourceStatus; items: Opportunity[] }> {
  const entry = cache.get(name);
  const stale = !entry || Date.now() - entry.at > FRESH_MS;
  if (stale) {
    const p = refresh(name, fn);
    if ((!entry || entry.items.length === 0) && !waitedOnce.has(name)) {
      waitedOnce.add(name);
      await Promise.race([p, new Promise((r) => setTimeout(r, FIRST_LOAD_WAIT_MS))]);
    }
  }
  const e = cache.get(name);
  const loading = inflight.has(name) && (!e || e.items.length === 0);
  return {
    items: e?.items ?? [],
    status: {
      protocol: name,
      ok: !!e && !e.error,
      count: 0,
      ms: e?.ms ?? 0,
      error: loading ? "Still loading (slow source); refresh in a minute" : e?.error,
    },
  };
}

export async function buildCatalog(): Promise<Catalog> {
  const [settled, logos] = await Promise.all([
    Promise.all(SOURCES.map(([name, fn]) => readSource(name, fn))),
    getLogoIndex(),
  ]);

  const seen = new Set<string>();
  const opportunities: Opportunity[] = [];
  const sources: SourceStatus[] = [];
  for (const { status, items } of settled) {
    let count = 0;
    for (const raw of items) {
      if (seen.has(raw.id)) continue;
      if (!(raw.tvlUsd >= MIN_TVL_USD)) continue;
      if (TESTNET.test(raw.chain)) continue;
      const o = raw.apy !== null && (raw.apy < 0 || raw.apy > MAX_SANE_APY) ? { ...raw, apy: null } : raw;
      // Only list things that actually pay: no 0% (or unpublished) APY.
      if (o.apy === null || o.apy < MIN_APY) continue;
      seen.add(o.id);
      opportunities.push(o);
      count++;
    }
    sources.push({ ...status, count });
  }
  opportunities.sort((a, b) => b.tvlUsd - a.tvlUsd);
  return { opportunities: assignSlugs(withLogos(opportunities, logos)), sources, updatedAt: new Date().toISOString() };
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "vault";

/** /earn/<name>; add the chain, then protocol, then a counter only when names collide. Biggest TVL keeps the plain name. */
function assignSlugs(list: Opportunity[]): Opportunity[] {
  const used = new Set<string>();
  return list.map((o) => {
    const base = slugify(o.name);
    const tries = [base, `${base}-${slugify(o.chain)}`, `${base}-${slugify(o.chain)}-${slugify(o.protocol)}`];
    let slug = tries.find((t) => !used.has(t));
    for (let n = 2; !slug; n++) if (!used.has(`${tries[2]}-${n}`)) slug = `${tries[2]}-${n}`;
    used.add(slug);
    return { ...o, slug };
  });
}

/** Look up one opportunity by slug (uses the same in-memory catalog). */
export async function findBySlug(slug: string): Promise<{ item: Opportunity | undefined; catalog: Catalog }> {
  const catalog = await buildCatalog();
  return { item: catalog.opportunities.find((o) => o.slug === slug), catalog };
}
