/**
 * Writes DROPPED_VAULTS.md: every open vault Explore doesn't list, grouped by chain, with why (from route-check.json).
 * Run with the dev server up, after scripts/check-routes.ts:
 *   npx tsx scripts/list-dropped.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

type O = { id: string; chain: string; protocol: string; asset: string; tvlUsd?: number };
type Result = { dep?: number; wd?: number; error?: string };

const CATALOG = process.env.CATALOG_URL ?? "http://localhost:3000/api/opportunities";

async function main() {
  const f = JSON.parse(readFileSync("src/lib/route-check.json", "utf8")) as { generatedAt: string; limitPct: number; results: Record<string, Result> };
  const c = (await fetch(CATALOG).then((r) => r.json())) as { opportunities: O[]; unlisted: O[] };
  const groups = new Map<string, { chain: string; protocol: string; asset: string; why: string; n: number; tvl: number }>();
  const counts = { costly: 0, noRoute: 0, unchecked: 0 };
  for (const o of c.unlisted) {
    const r = f.results[o.id];
    const why = !r ? "Not checked yet" : r.error ? `No route: ${r.error.slice(0, 90)}` : `Too costly at $100 (${r.dep}% in / ${r.wd}% out)`;
    counts[!r ? "unchecked" : r.error ? "noRoute" : "costly"]++;
    const k = `${o.chain}|${o.protocol}|${o.asset}|${why}`;
    const g = groups.get(k) ?? { chain: o.chain, protocol: o.protocol, asset: o.asset, why, n: 0, tvl: 0 };
    g.n++;
    g.tvl += o.tvlUsd ?? 0;
    groups.set(k, g);
  }
  const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`);
  let out = `# Vaults not listed in Explore\n\nFrom the route check on ${f.generatedAt.slice(0, 10)} (scripts/check-routes.ts, $100 in and out, limit ${f.limitPct}%).\n`;
  out += `These vaults keep their pages so holders can still withdraw; they just aren't listed. To revisit later.\n\n`;
  out += `- Listed in Explore: ${c.opportunities.length} vaults\n- Too costly at $100: ${counts.costly}\n- No route / error: ${counts.noRoute}\n- Not checked yet (LI.FI quota or no one-click): ${counts.unchecked}\n\nTotal not listed: ${c.unlisted.length}\n`;
  let chain = "";
  for (const g of [...groups.values()].sort((a, b) => a.chain.localeCompare(b.chain) || b.tvl - a.tvl)) {
    if (g.chain !== chain) {
      chain = g.chain;
      out += `\n## ${chain}\n\n| Protocol | Asset | Vaults | TVL | Why |\n|---|---|---|---|---|\n`;
    }
    out += `| ${g.protocol} | ${g.asset} | ${g.n} | ${usd(g.tvl)} | ${g.why.replace(/\|/g, "/")} |\n`;
  }
  writeFileSync("DROPPED_VAULTS.md", out);
  console.log(`listed ${c.opportunities.length}; not listed ${c.unlisted.length}`, counts);
}
main();
