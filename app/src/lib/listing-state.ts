import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Opportunity } from "./types.ts";

/**
 * Remembers what each source listed, so Pecun notices when a vault drops off a protocol's list.
 *
 * A vault that disappears is not dropped: anyone holding it still needs to see it and withdraw.
 * It becomes a "delisted" record (withdraw-only, with the last data we had) only once it has been
 * missing from 3 successful refreshes over at least 30 minutes. Until then it keeps showing with
 * its last data, because a single miss is usually an API hiccup or one chain timing out.
 * A refresh that returns far fewer vaults than last time is treated as a partial outage and
 * doesn't count against anything.
 *
 * State is saved to app/.data/listing-state.json so a restart doesn't forget it. That works on a
 * normal server; on a serverless host (Vercel) the disk isn't kept, so this needs a database
 * before launch. Everything goes through the load/save below to keep that swap small.
 */

type Miss = { count: number; since: number };
type State = {
  /** source → every vault it returned last time, with that vault's last data */
  seen: Record<string, Record<string, Opportunity>>;
  /** id → consecutive misses and when the first one happened */
  misses: Record<string, Miss>;
  /** id → delisted record */
  delisted: Record<string, Opportunity>;
};

const MISSES_TO_DELIST = 3;
const MIN_MISSING_MS = 30 * 60_000;
/** A refresh with fewer than this share of last time's vaults is a partial outage, not delistings. */
const PARTIAL_OUTAGE_RATIO = 0.7;
const FILE = path.join(process.cwd(), ".data", "listing-state.json");

type Store = { state: State; loaded: Promise<void>; saveTimer?: ReturnType<typeof setTimeout> };
const g = globalThis as unknown as { __pecunListing?: Store };
const store: Store = (g.__pecunListing ??= (() => {
  const s: Store = { state: { seen: {}, misses: {}, delisted: {} }, loaded: Promise.resolve() };
  s.loaded = readFile(FILE, "utf8")
    .then((raw) => {
      const disk = JSON.parse(raw) as Partial<State>;
      s.state = { seen: disk.seen ?? {}, misses: disk.misses ?? {}, delisted: disk.delisted ?? {} };
    })
    .catch(() => {}); // first run, or no readable disk: start empty
  return s;
})());

function save() {
  clearTimeout(store.saveTimer);
  store.saveTimer = setTimeout(() => {
    mkdir(path.dirname(FILE), { recursive: true })
      .then(() => writeFile(FILE, JSON.stringify(store.state)))
      .catch(() => {}); // read-only disk: keep the in-memory state only
  }, 5_000);
}

/**
 * Call after a source refreshed successfully. Returns the items to show for that source:
 * the fresh ones, plus any that are missing but not yet counted as delisted (with their last data).
 */
export async function reconcile(source: string, fresh: Opportunity[]): Promise<Opportunity[]> {
  await store.loaded;
  const st = store.state;
  const before = st.seen[source] ?? {};
  const now: Record<string, Opportunity> = {};
  for (const o of fresh) {
    now[o.id] = o;
    delete st.misses[o.id];
    delete st.delisted[o.id]; // back on the list
  }
  const missing = Object.keys(before).filter((id) => !now[id]);
  const partialOutage = fresh.length < Object.keys(before).length * PARTIAL_OUTAGE_RATIO;
  const carried: Opportunity[] = [];
  const t = Date.now();
  for (const id of missing) {
    const last = before[id];
    const miss = partialOutage ? st.misses[id] : { count: (st.misses[id]?.count ?? 0) + 1, since: st.misses[id]?.since ?? t };
    if (miss && miss.count >= MISSES_TO_DELIST && t - miss.since >= MIN_MISSING_MS) {
      delete st.misses[id];
      st.delisted[id] = {
        ...last,
        status: last.status === "paused" ? "paused" : "withdraw-only",
        statusReason: `No longer listed by ${last.protocol}. Deposits are closed; you can still withdraw.`,
        delistedAt: new Date(t).toISOString(),
      };
      continue;
    }
    if (miss) st.misses[id] = miss;
    now[id] = last; // keep tracking it
    carried.push(last);
  }
  st.seen[source] = now;
  save();
  return [...fresh, ...carried];
}

/** Every vault that has dropped off its protocol's list and hasn't come back. */
export async function delistedVaults(): Promise<Opportunity[]> {
  await store.loaded;
  return Object.values(store.state.delisted);
}
