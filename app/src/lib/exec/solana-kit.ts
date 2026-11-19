"use client";

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { formatUnits, parseUnits } from "viem";
import {
  backToUsdg,
  chainPreview,
  lifiPreview,
  lifiQuote,
  lifiRoute,
  lifiSend,
  solanaGasLeg,
  usdgOf,
  ExecError,
  netOfFee,
  outOf,
  relay,
  relayQuote,
  SOL_NEEDED,
  sendSol,
  takeUsdgFee,
  toPreview,
  waitForArrival,
  type Preview,
  type Progress,
  type Signer,
  type Who,
  legSlippageBpsNow,
} from "../execute";
import { base64ToHex, lamports, SOLANA_CHAIN_ID, solana, splBalance, splDecimals } from "../solana";

/** LI.FI's id for Solana. */
const LIFI_SOLANA = 1151111081099710;
import { ROBINHOOD_CHAIN_ID, USDG, USDG_DECIMALS } from "../wallet";

/**
 * Shared Solana plumbing for the Kamino, Meteora and Jupiter Lend (SOL) one-click modules: instruction helpers, native
 * SOL wrapping, a USDG <-> any-Solana-token route (Relay direct, or Relay to USDC plus a Jupiter swap, whichever gives
 * more), and Jupiter swaps. Everything runs in the browser and is signed with the user's own session.
 */

export const WSOL = "So11111111111111111111111111111111111111112";
/** Relay's id for native SOL. */
export const NATIVE_SOL = "11111111111111111111111111111111";
export const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSVAR_INSTRUCTIONS = new PublicKey("Sysvar1nstructions1111111111111111111111111");
export const SYSVAR_RENT = new PublicKey("SysvarRent111111111111111111111111111111111");
const ZERO = BigInt(0);

export const needSol = (s: { solanaAddress?: string }) => {
  if (!s.solanaAddress) throw new ExecError("Your Solana account is still being set up. Try again in a moment.");
  return s.solanaAddress;
};

export const pk = (a: string | PublicKey) => (typeof a === "string" ? new PublicKey(a) : a);
export const isNullKey = (k: PublicKey) => k.equals(PublicKey.default);

/** Token program (classic or Token-2022) that owns a mint, read once. */
const programs = new Map<string, Promise<PublicKey>>();
export function tokenProgramOf(mint: string): Promise<PublicKey> {
  let p = programs.get(mint);
  if (!p) {
    p = solana()
      .getAccountInfo(new PublicKey(mint))
      .then((a) => {
        if (!a) throw new ExecError("Couldn't read the token on Solana.");
        return a.owner;
      });
    p.catch(() => programs.delete(mint));
    programs.set(mint, p);
  }
  return p;
}

export const ata = (owner: string | PublicKey, mint: string | PublicKey, program: PublicKey = TOKEN_PROGRAM) =>
  PublicKey.findProgramAddressSync([pk(owner).toBuffer(), program.toBuffer(), pk(mint).toBuffer()], ATA_PROGRAM)[0];

/** Creates `owner`'s token account for `mint` if it doesn't exist (no-op otherwise). */
export const createAtaIx = (owner: string | PublicKey, mint: string | PublicKey, program: PublicKey = TOKEN_PROGRAM) =>
  new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: pk(owner), isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint, program), isSigner: false, isWritable: true },
      { pubkey: pk(owner), isSigner: false, isWritable: false },
      { pubkey: pk(mint), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: program, isSigner: false, isWritable: false },
    ],
    data: bytes([1]), // CreateIdempotent
  });

/** Wraps `amount` lamports into the owner's WSOL account (created if needed). */
export const wrapSolIxs = (owner: string, amount: bigint) => {
  const w = ata(owner, WSOL);
  return [
    createAtaIx(owner, WSOL),
    SystemProgram.transfer({ fromPubkey: pk(owner), toPubkey: w, lamports: amount }),
    new TransactionInstruction({ programId: TOKEN_PROGRAM, keys: [{ pubkey: w, isSigner: false, isWritable: true }], data: bytes([17]) }), // SyncNative
  ];
};

/** Closes a token account (an emptied or WSOL one), returning its lamports to the owner. */
export const closeAccountIx = (account: PublicKey, owner: string, program: PublicKey = TOKEN_PROGRAM) =>
  new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: pk(owner), isSigner: false, isWritable: true },
      { pubkey: pk(owner), isSigner: true, isWritable: false },
    ],
    data: bytes([9]),
  });

export const unwrapSolIx = (owner: string) => closeAccountIx(ata(owner, WSOL), owner);

export const computeLimitIx = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });

/** Little-endian byte helpers (no Node Buffer: it isn't available in the browser). */
export const bytes = (...parts: (Uint8Array | number[])[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out as Buffer;
};
export const hexBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
export const u64le = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};
export const u128le = (v: bigint) => bytes(u64le(v & ((BigInt(1) << BigInt(64)) - BigInt(1))), u64le(v >> BigInt(64)));
export const readU64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true);
export const readU128 = (d: Uint8Array, o: number) => readU64(d, o) + (readU64(d, o + 8) << BigInt(64));
export const seed = (s: string) => new TextEncoder().encode(s);
export const readKey = (d: Uint8Array, o: number) => new PublicKey(d.subarray(o, o + 32));

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const luts = new Map<string, Promise<AddressLookupTableAccount | null>>();
const lut = (a: string) => {
  let p = luts.get(a);
  if (!p) {
    p = solana()
      .getAddressLookupTable(new PublicKey(a))
      .then((r) => r.value);
    p.catch(() => luts.delete(a));
    luts.set(a, p);
  }
  return p;
};

/**
 * Compiles instructions into an unsigned v0 transaction (hex), paid by `payer`. `extraSigners` (one-off keys such as a
 * new position account) sign here; the user's own signature is added by their session when it's sent.
 */
export async function buildTx(payer: string, ixs: TransactionInstruction[], lookupTables: (string | PublicKey)[] = [], extraSigners: Keypair[] = []): Promise<string> {
  const tables = (await Promise.all(lookupTables.map((a) => lut(pk(a).toBase58())))).filter((t): t is AddressLookupTableAccount => !!t);
  const { blockhash } = await solana().getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: pk(payer), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(tables);
  const tx = new VersionedTransaction(msg);
  if (extraSigners.length) tx.sign(extraSigners);
  return hexOf(tx.serialize());
}

/** A base64 transaction from an API, unpacked into instructions and lookup tables so steps can be added around it. */
export async function decompileB64(b64: string): Promise<{ ixs: TransactionInstruction[]; tables: string[] }> {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const tables = tx.message.addressTableLookups.map((l) => l.accountKey.toBase58());
  const accounts = (await Promise.all(tables.map(lut))).filter((t): t is AddressLookupTableAccount => !!t);
  const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: accounts });
  return { ixs: msg.instructions, tables };
}

/** Balance of a Solana token in its smallest units; WSOL means the native SOL balance. */
export const solBalance = (owner: string, mint: string) => (mint === WSOL ? lamports(owner) : splBalance(owner, mint));
export const decimalsOf = async (mint: string) => (mint === WSOL ? 9 : splDecimals(mint));

/** What can be spent from a native SOL balance while leaving enough for fees and new accounts. */
export async function spendableSol(owner: string, want: bigint, keep: bigint = SOL_NEEDED): Promise<bigint> {
  const room = (await lamports(owner)) - keep;
  const amt = want < room ? want : room;
  if (amt <= ZERO) throw new ExecError("Not enough SOL left after network fees.");
  return amt;
}

/* ---------------- Jupiter swaps (lite-api, free, CORS-enabled) ---------------- */

const JUP_SWAP = "https://lite-api.jup.ag/swap/v1";
export type JupQuote = { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct?: string; slippageBps?: number; swapMode?: string };

export async function jupQuote(inMint: string, outMint: string, amount: bigint, exactOut = false, slippageBps = legSlippageBpsNow()): Promise<JupQuote> {
  const q = new URLSearchParams({ inputMint: inMint, outputMint: outMint, amount: amount.toString(), slippageBps: String(slippageBps), restrictIntermediateTokens: "true" });
  if (exactOut) q.set("swapMode", "ExactOut");
  const res = await fetch(`${JUP_SWAP}/quote?${q}`);
  const j = (await res.json().catch(() => ({}))) as JupQuote & { error?: string };
  if (!res.ok || !j.outAmount) throw new ExecError(`No swap route on Solana right now${j.error ? `: ${j.error}` : ""}.`);
  return j;
}

export async function jupSwapTx(quote: JupQuote, user: string): Promise<string> {
  const res = await fetch(`${JUP_SWAP}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  });
  const j = (await res.json().catch(() => ({}))) as { swapTransaction?: string; error?: string };
  if (!j.swapTransaction) throw new ExecError(`Couldn't build the swap on Solana${j.error ? `: ${j.error}` : ""}.`);
  return Array.from(Uint8Array.from(atob(j.swapTransaction), (c) => c.charCodeAt(0)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function jupPreview(q: JupQuote, outDecimals: number, outSymbol: string): Preview {
  return {
    out: formatUnits(BigInt(q.outAmount), outDecimals),
    outSymbol,
    minOut: formatUnits(BigInt(q.otherAmountThreshold), outDecimals),
    slippagePct: (q.slippageBps ?? 50) / 100,
    impactPct: -Math.abs(Number(q.priceImpactPct) || 0) * 100,
    feesUsd: 0,
    seconds: 2,
  };
}

/** Swaps `amount` of `inMint` into `outMint` on Solana; returns how much arrived. */
export async function jupSwap(s: Signer, inMint: string, outMint: string, amount: bigint): Promise<bigint> {
  const sol = needSol(s);
  const read = () => solBalance(sol, outMint);
  const before = await read();
  // Quoted after the gas top-up (inside sendSol), so the price is fresh.
  await sendSol(s, async () => jupSwapTx(await jupQuote(inMint, outMint, amount), sol));
  return waitForArrival(read, before, 2 * 60_000);
}

/* ---------------- USDG <-> any Solana token ---------------- */

const relayId = (mint: string) => (mint === WSOL ? NATIVE_SOL : mint);

/** `gas`: USDG sent first as a small Relay leg into native SOL (a LI.FI plan on a wallet short of SOL). */
type InPlan = { kind: "direct" | "via" | "lifi"; preview: Preview; out: bigint; gas?: bigint };

/** Quotes Relay straight into `mint`, and Relay into USDC plus a Jupiter swap, and keeps whichever delivers more. */
async function planIn(s: Who, net: bigint, mint: string, symbol: string): Promise<InPlan> {
  const sol = needSol(s);
  const dec = await decimalsOf(mint);
  const direct = relayQuote({ from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: relayId(mint), amount: net, user: s.address, recipient: sol }).then(
    (q): InPlan => ({ kind: "direct", preview: { ...toPreview(q, symbol), outSymbol: symbol }, out: outOf(q).out }),
  );
  const via =
    mint === SOL_USDC
      ? Promise.reject(new ExecError("same"))
      : (async (): Promise<InPlan> => {
          const q1 = await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: SOL_USDC, amount: net, user: s.address, recipient: sol });
          const o1 = outOf(q1);
          const q2 = await jupQuote(SOL_USDC, mint, o1.out);
          const p = chainPreview(toPreview(q1, "USDC"), o1.out, o1.min, jupPreview(q2, dec, symbol), BigInt(q2.outAmount), BigInt(q2.otherAmountThreshold), dec);
          return { kind: "via", preview: p, out: BigInt(q2.outAmount) };
        })();
  // LI.FI's cheapest bridge into the token; a small Relay leg brings native SOL first when the wallet is short.
  const lifi = (async (): Promise<InPlan> => {
    const g = await solanaGasLeg({ from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: relayId(mint), amount: net, user: s.address, recipient: sol });
    const gas = g?.amount ?? ZERO;
    const r = await lifiRoute({ fromChain: ROBINHOOD_CHAIN_ID, toChain: LIFI_SOLANA, fromToken: USDG, toToken: relayId(mint), amount: net - gas, from: s.address, to: sol });
    const p = lifiPreview(r);
    return { kind: "lifi", preview: { ...p, outSymbol: symbol, gasReserveUsd: gas > ZERO ? Number(formatUnits(gas, USDG_DECIMALS)) : undefined }, out: BigInt(r.toAmount), gas };
  })();
  const options = (await Promise.allSettled([direct, via, lifi])).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!options.length) {
    const d = await direct.catch((e) => e);
    throw d instanceof Error ? d : new ExecError("No route right now.");
  }
  return options.reduce((best, o) => (o.out > best.out ? o : best));
}

export const previewToSolana = async (s: Who, usdg: string, mint: string, symbol: string) => (await planIn(s, netOfFee(usdg), mint, symbol)).preview;

/**
 * Takes Pecun's fee, then moves the rest from USDG into `mint` on Solana (native SOL for WSOL). Reports the "bridge"
 * step and returns how much of the token arrived.
 */
export async function toSolana(s: Signer, usdg: string, mint: string, symbol: string, on: Progress): Promise<bigint> {
  const sol = needSol(s);
  const dec = await decimalsOf(mint);
  const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
  on("bridge", "running");
  const plan = await planIn(s, net, mint, symbol);
  let got: bigint;
  if (plan.kind === "direct") {
    const read = () => solBalance(sol, mint);
    const before = await read();
    await relay(s, { from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: relayId(mint), amount: net, user: s.address, recipient: sol });
    got = await waitForArrival(read, before, 10 * 60_000);
  } else if (plan.kind === "lifi") {
    let main = net;
    if (plan.gas && plan.gas > ZERO) {
      const lb = await lamports(sol);
      await relay(s, { from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: NATIVE_SOL, amount: plan.gas, user: s.address, recipient: sol, noGasLeg: true });
      await waitForArrival(() => lamports(sol), lb, 5 * 60_000).catch(() => ZERO);
      main = net - plan.gas;
    }
    const read = () => solBalance(sol, mint);
    const before = await read();
    await lifiSend(s, { fromChain: ROBINHOOD_CHAIN_ID, toChain: LIFI_SOLANA, fromToken: USDG, toToken: relayId(mint), amount: main, from: s.address, to: sol });
    got = await waitForArrival(read, before, 15 * 60_000);
  } else {
    const read = () => splBalance(sol, SOL_USDC);
    const before = await read();
    await relay(s, { from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: SOL_USDC, amount: net, user: s.address, recipient: sol });
    const usdc = await waitForArrival(read, before, 10 * 60_000);
    got = await jupSwap(s, SOL_USDC, mint, usdc);
  }
  on("bridge", "done", `${formatUnits(got, dec)} ${symbol}`);
  return got;
}

/** Quotes `raw` of `mint` on Solana back to USDG (Relay direct, or a Jupiter swap to USDC then Relay). */
async function planOut(s: Who, mint: string, raw: bigint): Promise<InPlan> {
  const sol = needSol(s);
  const direct = relayQuote({ from: SOLANA_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: relayId(mint), outToken: USDG, amount: raw, user: sol, recipient: s.address }).then(
    (q): InPlan => ({ kind: "direct", preview: toPreview(q, "USDG"), out: outOf(q).out }),
  );
  const via =
    mint === SOL_USDC
      ? Promise.reject(new ExecError("same"))
      : (async (): Promise<InPlan> => {
          const q1 = await jupQuote(mint, SOL_USDC, raw);
          const q2 = await relayQuote({ from: SOLANA_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: SOL_USDC, outToken: USDG, amount: BigInt(q1.outAmount), user: sol, recipient: s.address });
          const o2 = outOf(q2);
          const p = chainPreview(jupPreview(q1, 6, "USDC"), BigInt(q1.outAmount), BigInt(q1.otherAmountThreshold), toPreview(q2, "USDG"), o2.out, o2.min, USDG_DECIMALS);
          return { kind: "via", preview: p, out: o2.out };
        })();
  const lifi = (async (): Promise<InPlan> => {
    const r = await lifiRoute({ fromChain: LIFI_SOLANA, toChain: ROBINHOOD_CHAIN_ID, fromToken: relayId(mint), toToken: USDG, amount: raw, from: sol, to: s.address });
    return { kind: "lifi", preview: lifiPreview(r), out: BigInt(r.toAmount) };
  })();
  const options = (await Promise.allSettled([direct, via, lifi])).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!options.length) {
    const d = await direct.catch((e) => e);
    throw d instanceof Error ? d : new ExecError("No route right now.");
  }
  return options.reduce((best, o) => (o.out > best.out ? o : best));
}

export const previewFromSolana = async (s: Who, mint: string, raw: bigint) => (await planOut(s, mint, raw)).preview;

/** Moves `raw` of `mint` (native SOL for WSOL) from Solana back to USDG, then takes Pecun's fee. */
export async function fromSolana(s: Signer, mint: string, raw: bigint, on: Progress): Promise<string> {
  const sol = needSol(s);
  let amount = mint === WSOL ? await spendableSol(sol, raw) : raw;
  const plan = await planOut(s, mint, amount);
  if (plan.kind === "direct") return backToUsdg(s, { from: SOLANA_CHAIN_ID, inToken: relayId(mint), amount, user: sol }, on);
  if (plan.kind === "lifi") {
    on("bridge", "running");
    const before = await usdgOf(s)();
    await sendSol(s, async () => base64ToHex((await lifiQuote({ fromChain: LIFI_SOLANA, toChain: ROBINHOOD_CHAIN_ID, fromToken: relayId(mint), toToken: USDG, amount, from: sol, to: s.address })).transactionRequest.data));
    const back = await waitForArrival(usdgOf(s), before, 15 * 60_000);
    on("bridge", "done", `${formatUnits(back, USDG_DECIMALS)} USDG`);
    const kept = await takeUsdgFee(s, back, on);
    return `${formatUnits(kept, USDG_DECIMALS)} USDG`;
  }
  on("bridge", "running");
  amount = await jupSwap(s, mint, SOL_USDC, amount);
  return backToUsdg(s, { from: SOLANA_CHAIN_ID, inToken: SOL_USDC, amount, user: sol }, on);
}

/** Pins numbers to a 30s budget so a slow API can't hang the panel. */
export const timeout = <T,>(p: Promise<T>, ms = 30_000, what = "Solana") =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new ExecError(`${what} didn't answer in time. Try again.`)), ms))]);

export const ZERO_BIG = ZERO;
