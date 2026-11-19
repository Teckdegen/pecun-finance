/**
 * Route check: which vaults can be entered and exited within Pecun's route-cost limit.
 *
 * For every vault with one-click, quotes a $100 deposit and the matching withdrawal and records each route's total cost
 * (bridge + swap fees + price impact, as % of what's moved). Vaults that cost at most MAX_ROUTE_COST_PCT both ways are
 * listed in Explore; the rest stay reachable by link but aren't listed (see src/lib/catalog.ts).
 *
 * Run with the dev server up (it reads the catalog from it):
 *   npx tsx scripts/check-routes.ts            # resume: only routes not checked in the last 24h
 *   npx tsx scripts/check-routes.ts --fresh    # re-check everything
 *   npx tsx scripts/check-routes.ts --only=frgmnt   # just the routes whose key or vault ids contain this text
 *
 * Results are saved after every route to src/lib/route-check.json, so a throttled or interrupted run can be resumed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { MAX_ROUTE_COST_PCT, oneClickFor, routeCostPct } from "../src/lib/exec";

const OUT = "src/lib/route-check.json";
const CATALOG = process.env.CATALOG_URL ?? "http://localhost:3000/api/opportunities";
const AMOUNT = "100";
const FRESH_MS = 24 * 3600_000;
/** Pool-specific protocols: every vault is its own route. Elsewhere vaults with the same chain + asset share a route. */
const PER_VAULT = new Set(["Pendle", "Spectra", "GMX", "Meteora", "Hyperliquid"]);
const LIFI_CHAINS = new Set(["Sui", "XDC", "Flare", "Fraxtal"]);
const who = { address: "0x8ba1f109551bD432803012645Ac136ddd64DBA72" as const, solanaAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", suiAddress: "0x1cb07661e9d22ea75885f35acf30f6e86e785807ef08ff23b8d6f5a81f77c805" };

type O = Parameters<typeof oneClickFor>[0] & { tvlUsd?: number };
type Result = { dep?: number; wd?: number; error?: string; at: number };
type File = { generatedAt: string; amountUsd: number; limitPct: number; passed: string[]; results: Record<string, Result> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 60_000))]);
const throttled = (m: string) => /Could not process|rate limit|timeout|429|fetch failed|too many/i.test(m);

async function main() {
  const fresh = process.argv.includes("--fresh");
  const cat = (await fetch(CATALOG).then((r) => r.json())) as { opportunities: O[]; unlisted?: O[] };
  const vaults = [...cat.opportunities, ...(cat.unlisted ?? [])].filter((o) => oneClickFor(o)).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  // LP vaults (Beefy, Yearn Curve) depend on their own pool, so they're checked one by one too.
  const keyOf = (o: O) => (PER_VAULT.has(o.protocol) || (o as { kind?: string }).kind === "Liquidity" ? o.id : `${o.chain}|${o.protocol}|${o.asset}`);
  const groups = new Map<string, O[]>();
  for (const o of vaults) groups.set(keyOf(o), [...(groups.get(keyOf(o)) ?? []), o]);

  const file: File = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { generatedAt: "", amountUsd: 100, limitPct: MAX_ROUTE_COST_PCT, passed: [], results: {} };
  const save = () => {
    file.generatedAt = new Date().toISOString();
    file.limitPct = MAX_ROUTE_COST_PCT;
    const ok = (r?: Result) => !!r && r.dep !== undefined && r.wd !== undefined && r.dep <= MAX_ROUTE_COST_PCT && r.wd <= MAX_ROUTE_COST_PCT;
    // Vaults missing from this catalog read (a slow source still loading) keep their earlier verdict.
    const here = new Set(vaults.map((o) => o.id));
    const kept = (file.passed ?? []).filter((id) => !here.has(id));
    file.passed = [...new Set([...kept, ...vaults.filter((o) => ok(file.results[o.id])).map((o) => o.id)])].sort();
    writeFileSync(OUT, JSON.stringify(file, null, 1));
  };

  let lifiBlocked = false;
  let done = 0;
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length).toLowerCase();
  const todo = [...groups].filter(([key, list]) =>
    only ? (key + list.map((o) => o.id).join(" ")).toLowerCase().includes(only) : fresh || !list.every((o) => file.results[o.id] && Date.now() - file.results[o.id].at < FRESH_MS),
  );
  console.log(`${vaults.length} one-click vaults in ${groups.size} routes; ${todo.length} to check`);
  for (const [key, list] of todo) {
    const o = list[0];
    if (lifiBlocked && LIFI_CHAINS.has(o.chain)) continue; // LI.FI quota used up: these wait for the next run
    const a = oneClickFor(o)!;
    let r: Result | null = null;
    for (let attempt = 0; attempt < 5 && !r; attempt++) {
      try {
        const p = await timeout(a.previewDeposit(who, AMOUNT));
        await sleep(1000);
        const w = await timeout(a.previewWithdraw(who, (Number(p.out) * 0.97).toPrecision(6)));
        r = { dep: +routeCostPct(p).toFixed(3), wd: +routeCostPct(w).toFixed(3), at: Date.now() };
      } catch (e) {
        const m = (e as Error).message.replace(/\s+/g, " ").slice(0, 120);
        if (/retry in \d+ hours?/i.test(m)) {
          lifiBlocked = true;
          break;
        }
        if (!throttled(m)) r = { error: m, at: Date.now() }; // a real answer: full, paused, no route…
        else await sleep(15_000 * (attempt + 1));
      }
    }
    if (r) for (const v of list) file.results[v.id] = r;
    save();
    done++;
    const tag = !r ? "skipped (throttled)" : r.error ? `fail: ${r.error}` : `${r.dep}% in / ${r.wd}% out${Math.max(r.dep!, r.wd!) > MAX_ROUTE_COST_PCT ? "  OVER" : ""}`;
    console.log(`[${done}/${todo.length}] ${key.length > 70 ? `${o.chain}|${o.protocol}|${o.asset}` : key} (${list.length}) → ${tag}`);
    await sleep(1000);
  }
  save();
  console.log(`listed: ${file.passed.length} of ${vaults.length}${lifiBlocked ? " (LI.FI quota hit: run again later for Sui/XDC/Flare/Fraxtal)" : ""}`);
  process.exit(0);
}
main();
