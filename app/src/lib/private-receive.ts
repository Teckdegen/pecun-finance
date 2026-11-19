"use client";

import { createPublicClient, erc20Abi, fallback, formatUnits, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { base } from "viem/chains";

/**
 * Private funding through Gloam (gloam.trade): each Pecun wallet has its own private receive address (gloamr1.…).
 * Anyone can pay it from their Gloam private balance; Pecun then claims the payment into a note only this wallet
 * knows and cashes it out to the wallet's own USDC address on Base. The chain shows Gloam's vault paying the wallet,
 * not who paid in. Gloam keeps 0.5% on the cash out.
 *
 * The address is the same on every device: its key (and any note waiting to be cashed out) is encrypted in the
 * browser with a key made from the wallet's own signature of a fixed message, and only that ciphertext is backed up
 * (via /api/private, signed with the user's session). Pecun's server can't open it. This mirrors how Gloam backs up
 * its own wallets: a recovery store that holds ciphertext, opened by a wallet signature.
 */

type ReceiveKeyJwk = { kty?: string; crv?: string; x?: string; y?: string; d?: string; ext?: boolean; key_ops?: string[] };
type ReceiveKey = { tag: string; privateJwk: ReceiveKeyJwk; createdAt?: number };
type NoteExport = { secret: Hex; commitment: Hex; nullifier: Hex; amountWei: string; asset: Address; seed?: Hex };

/** What's encrypted and backed up. */
type Vault = {
  v: 1;
  receiveKey: ReceiveKey;
  /** Payments found but not claimed yet (the payer can still take these back until they are). */
  received: NoteExport[];
  /** Claimed notes, only this wallet knows them, waiting to be cashed out. */
  fresh: NoteExport[];
  /** Last block of the payment board read. */
  scannedTo?: string;
};

export type Signer = {
  address: `0x${string}`;
  signAccountsRequest: () => Promise<unknown | null>;
  signEvmDigest: (digestHex: `0x${string}`) => Promise<{ ok: true; signature: `0x${string}` } | { ok: false; error: string }>;
};

export type CashedOut = { amount: string; symbol: string; hash: Hex };

const MESSAGE = "Pecun private receive address v1. Signing this never moves funds.";
const BASE_RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
const NATIVE = "0x0000000000000000000000000000000000000000";
const RELAY = { url: "/api/gloam/relay" };

const client = () => createPublicClient({ chain: base, transport: fallback(BASE_RPCS.map((u) => http(u, { timeout: 20_000, retryCount: 1 }))) });
const sdk = () => import("@gloamtrade/sdk");

/* ---------------- encryption: AES-GCM under a key made from the wallet's signature ---------------- */

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function signOnce(s: Signer): Promise<Hex> {
  const r = await s.signEvmDigest(keccak256(toBytes(MESSAGE)));
  if (!r.ok) throw new Error(r.error);
  return r.signature;
}

/** A copy backed by a plain ArrayBuffer, as WebCrypto's types want. */
const ab = (u: Uint8Array) => new Uint8Array(u).buffer as ArrayBuffer;

async function aesKeyFrom(signature: Hex): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", ab(toBytes(signature)), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: ab(toBytes("pecun-private")), info: ab(toBytes("receive-vault-v1")) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(key: CryptoKey, v: Vault): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(v))));
  return `${b64u(iv)}.${b64u(ct)}`;
}

async function open(key: CryptoKey, blob: string): Promise<Vault> {
  const [iv, ct] = blob.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, key, unb64u(ct));
  return JSON.parse(new TextDecoder().decode(pt)) as Vault;
}

/* ---------------- backup: Upstash (ciphertext only) + this device ---------------- */

const localKey = (owner: string) => `pecun:private:${owner.toLowerCase()}`;

async function remoteBlob(s: Signer, blob?: string): Promise<string | null | undefined> {
  try {
    const signed = await s.signAccountsRequest();
    if (!signed) return undefined;
    const res = await fetch("/api/private", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signed, address: s.address, blob }) });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { blob?: string | null; indexed?: boolean };
    return j.indexed ? j.blob ?? null : undefined;
  } catch {
    return undefined;
  }
}

/* ---------------- unlocking (cached for the session) ---------------- */

const unlocked = new Map<string, Promise<{ key: CryptoKey; vault: Vault }>>();

async function unlockFresh(s: Signer): Promise<{ key: CryptoKey; vault: Vault }> {
  const signature = await signOnce(s);
  const key = await aesKeyFrom(signature);
  const remote = await remoteBlob(s);
  const local = (() => {
    try {
      return globalThis.localStorage?.getItem(localKey(s.address)) ?? null;
    } catch {
      return null;
    }
  })();
  for (const blob of [remote, local]) {
    if (!blob) continue;
    try {
      return { key, vault: await open(key, blob) };
    } catch {
      /* a backup this signature can't open: try the next */
    }
  }
  // First time: the address must come back on every device, so the signature has to be stable. Check it.
  if ((await signOnce(s)).toLowerCase() !== signature.toLowerCase()) {
    throw new Error("Your wallet couldn't make a stable private address. Private funding isn't available for this account yet.");
  }
  const { generateReceiveKey } = await sdk();
  // A new address can't have been paid before it existed, so its first scan starts here, not at the board's deploy.
  const now = await client().getBlockNumber().catch(() => null);
  const vault: Vault = { v: 1, receiveKey: await generateReceiveKey(), received: [], fresh: [], ...(now ? { scannedTo: (now - BigInt(1)).toString() } : {}) };
  await save(s, key, vault);
  return { key, vault };
}

async function save(s: Signer, key: CryptoKey, vault: Vault) {
  const blob = await seal(key, vault);
  try {
    globalThis.localStorage?.setItem(localKey(s.address), blob);
  } catch {
    /* storage unavailable */
  }
  await remoteBlob(s, blob);
}

function unlock(s: Signer) {
  const k = s.address.toLowerCase();
  let p = unlocked.get(k);
  if (!p) {
    p = unlockFresh(s);
    p.catch(() => unlocked.delete(k));
    unlocked.set(k, p);
  }
  return p;
}

/** Whether this wallet has a private address yet (on this device or in the backup). Doesn't ask for a signature. */
export async function hasPrivateAddress(s: Signer): Promise<boolean> {
  try {
    if (globalThis.localStorage?.getItem(localKey(s.address))) return true;
  } catch {
    /* storage unavailable */
  }
  return !!(await remoteBlob(s));
}

/** The wallet's private receive address (gloamr1.…), the same on every device. */
export async function privateAddress(s: Signer): Promise<string> {
  return (await unlock(s)).vault.receiveKey.tag;
}

/* ---------------- the inbox: find payments, claim them, cash them out ---------------- */

let running = false;

async function symbolOf(asset: Address): Promise<{ symbol: string; decimals: number }> {
  if (asset.toLowerCase() === NATIVE) return { symbol: "ETH", decimals: 18 };
  const c = client();
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }).catch(() => "tokens"),
    c.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
  ]);
  return { symbol, decimals };
}

/**
 * One pass: reads new payments to the private address, claims each into a note only this wallet knows, and cashes
 * every claimed note out to the wallet's Base address. Returns what landed. Safe to call repeatedly.
 */
export async function processPrivateInbox(s: Signer): Promise<CashedOut[]> {
  if (running) return [];
  running = true;
  try {
    const { key, vault } = await unlock(s);
    const g = await sdk();
    const net = g.mainnetNetwork("base");
    if (!net) return [];
    const c = client();
    const chain = g.sweepChainFromClient(c as never, { pool: net.pool, fromBlock: net.deployBlock, seed: g.gloamLeafSeed(net.key, { url: "/api/gloam/leaves" }) });
    let changed = false;

    // 1. New payments on the board since the last read.
    const { payments, scannedTo } = await g.scanIncomingPayments({
      client: c as never,
      network: net,
      receiveKey: vault.receiveKey,
      fromBlock: vault.scannedTo ? BigInt(vault.scannedTo) + BigInt(1) : undefined,
    });
    for (const p of payments) {
      const note = (await g.notePackageToExport(p.notePackage)) as unknown as NoteExport;
      if (!vault.received.some((r) => r.commitment === note.commitment)) vault.received.push(note);
    }
    vault.scannedTo = scannedTo.toString();
    changed = true;

    // 2. Claim: move each payment into a fresh note only this wallet knows (the relay pays the gas).
    const transferProve = g.artifactProver(g.circuitArtifactUrls("transfer", net.chainId));
    for (const note of [...vault.received]) {
      const r = await g.sweepReceivedNote({
        note: note as never,
        poolAddress: net.pool,
        chainId: net.chainId,
        prove: transferProve,
        chain,
        submit: g.relaySubmitter(RELAY),
        beforeSubmit: async (fresh) => {
          // The fresh note's secret is the money: back it up before the claim is sent.
          vault.fresh.push(fresh as unknown as NoteExport);
          await save(s, key, vault);
        },
      });
      if (r.final || r.status === "already_spent" || r.status === "bad_note") {
        vault.received = vault.received.filter((x) => x.commitment !== note.commitment);
        if (r.status !== "swept" && r.freshNote) vault.fresh = vault.fresh.filter((f) => f.commitment !== r.freshNote!.commitment);
        changed = true;
      }
    }

    // 3. Cash out every claimed note to the wallet's own Base address (the relay pays the gas).
    const unshieldProve = g.artifactProver(g.circuitArtifactUrls("unshield", net.chainId));
    const done: CashedOut[] = [];
    for (const note of [...vault.fresh]) {
      if (await chain.isSpent(note.nullifier).catch(() => false)) {
        vault.fresh = vault.fresh.filter((f) => f.commitment !== note.commitment);
        changed = true;
        continue;
      }
      const path = await chain.pathForCommitment(note.commitment);
      if (!path) continue; // the claim hasn't landed yet: next pass
      const intent = await g.buildUnshieldIntent({
        secretHex: note.secret,
        amountWei: BigInt(note.amountWei),
        asset: note.asset,
        to: s.address,
        path,
        prove: unshieldProve,
        poolAddress: net.pool,
        chainId: net.chainId,
        client: c as never,
      });
      const hash = await g.relayIntent(intent, RELAY);
      const receipt = await c.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") continue;
      vault.fresh = vault.fresh.filter((f) => f.commitment !== note.commitment);
      changed = true;
      const m = await symbolOf(note.asset);
      const plan = intent.plan as { receivesWei?: bigint };
      done.push({ amount: formatUnits(plan.receivesWei ?? BigInt(note.amountWei), m.decimals), symbol: m.symbol, hash });
    }
    if (changed) await save(s, key, vault);
    return done;
  } finally {
    running = false;
  }
}
