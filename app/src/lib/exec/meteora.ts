"use client";

import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { formatUnits, parseUnits } from "viem";
import { ExecError, IN_STEPS, OUT_STEPS, registerAdapters, sendSol, type Adapter, type Opp, type Step } from "../execute";
import { lamports, solana } from "../solana";
import { buildTx, fromSolana, jupQuote, jupSwap, jupSwapTx, needSol, previewFromSolana, previewToSolana, solBalance, timeout, toSolana, WSOL } from "./solana-kit";

/**
 * Meteora DLMM pools (meteora:solana:<lbPair>). A pool takes two tokens, so a deposit is a zap:
 *   USDC → the pool's quote token Y (Relay, or Relay + Jupiter) → swap about half into X (Jupiter) → open a position
 *   with Meteora's Spot strategy over the bins around the current price (both sides, one position of up to 69 bins).
 * Withdrawing removes the liquidity (claiming fees, closing the position when it's all), swaps X back into Y, and
 * routes Y to USDC. Amounts and the position value are in Y.
 *
 * A DLMM position is its own account and must be created by a new keypair. Pecun derives that keypair from the user's
 * address, the pool and a slot number, so positions are found again without an indexer (free RPCs block
 * getProgramAccounts). The key only matters at creation; afterwards the position belongs to the user's wallet alone.
 * Opening a position locks ~0.057 SOL of rent (more if a bin array has to be created), paid from the deposit and
 * returned when the position is closed.
 */

const SLOTS = 4; // positions per user and pool (a new one only if a slot is taken by someone else)
const HALF_WIDTH = 34; // bins either side of the active bin: 69 bins, the most one position holds
const KEEP = BigInt(10_000_000); // 0.01 SOL kept for fees on top of the rent
const ZERO = BigInt(0);
const toLamports = (sol: number) => BigInt(Math.ceil(sol * 1e9));

type Sdk = typeof import("@meteora-ag/dlmm");
let sdk: Promise<Sdk> | null = null;
/** The DLMM SDK (and Anchor) are large, so they load only when a Meteora pool is used. */
const loadSdk = () => (sdk ??= import("@meteora-ag/dlmm").catch((e) => ((sdk = null), Promise.reject(e))));
type Pool = Awaited<ReturnType<Sdk["default"]["create"]>>;

const pools = new Map<string, { at: number; p: Promise<Pool> }>();
async function pool(address: string): Promise<Pool> {
  const hit = pools.get(address);
  if (hit && Date.now() - hit.at < 30_000) return hit.p;
  const p = loadSdk().then((m) => m.default.create(solana(), new PublicKey(address)));
  p.catch(() => pools.delete(address));
  pools.set(address, { at: Date.now(), p });
  return p;
}

/** Deterministic position keypair for (user, pool, slot). */
async function positionKey(user: string, lbPair: string, slot: number): Promise<Keypair> {
  const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pecun:meteora-dlmm:v1:${user}:${lbPair}:${slot}`)));
  return Keypair.fromSeed(seed);
}

type Held = { key: PublicKey; lower: number; upper: number; x: bigint; y: bigint };

/** The user's Pecun positions in this pool (owner checked), and the first free slot for a new one. */
async function positions(p: Pool, user: string): Promise<{ held: Held[]; free: Keypair | null }> {
  const keys = await Promise.all(Array.from({ length: SLOTS }, (_, i) => positionKey(user, p.pubkey.toBase58(), i)));
  const accs = await solana().getMultipleAccountsInfo(keys.map((k) => k.publicKey));
  const held: Held[] = [];
  let free: Keypair | null = null;
  for (let i = 0; i < keys.length; i++) {
    const a = accs[i];
    if (!a) {
      free ??= keys[i];
      continue;
    }
    if (!a.owner.equals(p.program.programId)) continue;
    const pos = await p.getPosition(keys[i].publicKey);
    if (!pos.positionData.owner.equals(new PublicKey(user))) continue; // someone else took this slot
    const d = pos.positionData;
    held.push({
      key: keys[i].publicKey,
      lower: d.lowerBinId,
      upper: d.upperBinId,
      x: BigInt(d.totalXAmount.split(".")[0]) + BigInt(d.feeX.toString()),
      y: BigInt(d.totalYAmount.split(".")[0]) + BigInt(d.feeY.toString()),
    });
  }
  return { held, free };
}

/** Value of X in Y's smallest units, at the pool's current price. */
async function xInY(p: Pool, x: bigint): Promise<bigint> {
  if (x === ZERO) return ZERO;
  const price = Number((await p.getActiveBin()).pricePerToken); // Y per X, whole tokens
  const dx = p.tokenX.mint.decimals;
  const dy = p.tokenY.mint.decimals;
  return BigInt(Math.floor((Number(x) / 10 ** dx) * price * 10 ** dy));
}

/** Lamports needed to open a position here: its rent, any missing bin arrays, plus a margin for fees. */
async function rentNeeded(p: Pool, lower: number, upper: number): Promise<bigint> {
  const m = await loadSdk();
  const { BN } = await import("@coral-xyz/anchor");
  const lo = m.binIdToBinArrayIndex(new BN(lower));
  const hi = m.binIdToBinArrayIndex(new BN(upper));
  const arrays: PublicKey[] = [];
  for (let i = lo.toNumber(); i <= hi.toNumber(); i++) arrays.push(m.deriveBinArray(p.pubkey, new BN(i), p.program.programId)[0]);
  const missing = (await solana().getMultipleAccountsInfo(arrays)).filter((a) => !a).length;
  return toLamports(m.POSITION_FEE) + BigInt(missing) * toLamports(m.BIN_ARRAY_FEE) + KEEP;
}

const legacyToHex = (sol: string, tx: Transaction, signers: Keypair[] = []) => buildTx(sol, tx.instructions, [], signers);

function meteoraPool(lbPair: string, pair: string): Adapter {
  const [xSym, ySym] = (() => {
    const i = pair.indexOf("-", 1);
    return i > 0 ? [pair.slice(0, i), pair.slice(i + 1)] : ["X", "Y"];
  })();
  const get = () => timeout(pool(lbPair), 30_000, "Meteora");
  const depositSteps: Step[] = [IN_STEPS[0], IN_STEPS[1], { id: "swap", label: `Swap part into ${xSym}` }, { id: "deposit", label: "Add liquidity" }];
  const withdrawSteps: Step[] = [{ id: "withdraw", label: "Remove liquidity" }, { id: "swap", label: `Swap ${xSym} to ${ySym}` }, OUT_STEPS[1], OUT_STEPS[2]];

  /** Total position value in Y's smallest units. */
  const valueY = async (p: Pool, held: Held[]) => {
    const x = held.reduce((t, h) => t + h.x, ZERO);
    const y = held.reduce((t, h) => t + h.y, ZERO);
    return (await xInY(p, x)) + y;
  };

  return {
    positionSymbol: ySym,
    depositSteps,
    withdrawSteps,

    position: async (s) => {
      if (!s.solanaAddress) return 0;
      // Cheap check first: no Pecun position account in any slot means no position (and no SDK download).
      const keys = await Promise.all(Array.from({ length: SLOTS }, (_, i) => positionKey(s.solanaAddress!, lbPair, i)));
      if ((await timeout(solana().getMultipleAccountsInfo(keys.map((k) => k.publicKey)), 30_000, "Solana")).every((a) => !a)) return 0;
      const p = await get();
      const { held } = await timeout(positions(p, s.solanaAddress), 30_000, "Meteora");
      if (!held.length) return 0;
      return Number(formatUnits(await valueY(p, held), p.tokenY.mint.decimals));
    },
    previewDeposit: async (s, usdg) => previewToSolana(s, usdg, (await get()).tokenY.publicKey.toBase58(), ySym),
    previewWithdraw: async (s, amount) => {
      const p = await get();
      return previewFromSolana(s, p.tokenY.publicKey.toBase58(), parseUnits(amount, p.tokenY.mint.decimals));
    },

    deposit: async (s, usdg, on) => {
      const sol = needSol(s);
      const p0 = await get();
      const X = p0.tokenX.publicKey.toBase58();
      const Y = p0.tokenY.publicKey.toBase58();
      const { free } = await positions(p0, sol);
      if (!free) throw new ExecError("You already have the most positions Pecun opens in this pool. Withdraw one first.");
      let y = await toSolana(s, usdg, Y, ySym, on);

      on("swap", "running");
      const active = p0.lbPair.activeId;
      const rent = await rentNeeded(p0, active - HALF_WIDTH, active + HALF_WIDTH);
      const bal = await lamports(sol);
      if (Y === WSOL) {
        // SOL is the quote token: the rent comes out of what arrived.
        const room = bal - rent;
        if (room <= ZERO) throw new ExecError("The deposit is too small to cover Meteora's position rent (~0.06 SOL, refunded when you withdraw).");
        if (y > room) y = room;
      } else if (bal < rent) {
        // Buy just the SOL the position's rent needs (refunded as SOL when the position closes).
        const need = rent - bal;
        const before = await solBalance(sol, Y);
        await sendSol(s, async () => jupSwapTx(await jupQuote(Y, WSOL, need, true), sol));
        const spent = before - (await solBalance(sol, Y));
        y = y > spent ? y - spent : ZERO;
        if ((await lamports(sol)) < rent) throw new ExecError("Couldn't cover Meteora's position rent. Your funds are in your Solana wallet.");
      }
      if (y <= ZERO) throw new ExecError("The deposit is too small to cover Meteora's position rent (~0.06 SOL, refunded when you withdraw).");
      const half = y / BigInt(2);
      const x = await jupSwap(s, Y, X, half);
      y -= half;
      if (X === WSOL) {
        const room = (await lamports(sol)) - rent;
        if (room <= ZERO) throw new ExecError("Not enough SOL left for Meteora's position rent.");
      }
      on("swap", "done", `${formatUnits(x, p0.tokenX.mint.decimals)} ${xSym} + ${formatUnits(y, p0.tokenY.mint.decimals)} ${ySym}`);

      on("deposit", "running");
      await sendSol(s, async () => meteoraDepositTx(sol, lbPair, free, x, y));
      const { held } = await positions(await pool(lbPair), sol);
      if (!held.some((h) => h.key.equals(free.publicKey))) throw new ExecError("The position didn't open. Your tokens are in your Solana wallet.");
      on("deposit", "done");
      return `${formatUnits(x, p0.tokenX.mint.decimals)} ${xSym} + ${formatUnits(y, p0.tokenY.mint.decimals)} ${ySym}`;
    },

    withdraw: async (s, amount, on) => {
      const sol = needSol(s);
      const p = await get();
      const X = p.tokenX.publicKey.toBase58();
      const Y = p.tokenY.publicKey.toBase58();
      on("withdraw", "running");
      const { held } = await positions(p, sol);
      if (!held.length) throw new ExecError("You don't have a position in this pool.");
      const total = await valueY(p, held);
      const want = amount === "max" ? total : parseUnits(amount, p.tokenY.mint.decimals);
      if (want <= ZERO) throw new ExecError("Enter an amount to withdraw.");
      const bps = want >= total ? 10_000 : Math.max(1, Math.ceil((Number(want) / Number(total)) * 10_000));
      const [x0, y0, l0] = await Promise.all([X === WSOL ? ZERO : solBalance(sol, X), Y === WSOL ? ZERO : solBalance(sol, Y), lamports(sol)]);
      for (const h of held) {
        for (const hex of await meteoraWithdrawTxs(sol, lbPair, h, bps)) await sendSol(s, async () => hex());
      }
      const [x1, y1, l1] = await Promise.all([X === WSOL ? ZERO : solBalance(sol, X), Y === WSOL ? ZERO : solBalance(sol, Y), lamports(sol)]);
      const solGain = l1 > l0 ? l1 - l0 : ZERO; // SOL leg (if any) plus the position rent coming back
      let xGot = X === WSOL ? solGain : x1 - x0;
      let yGot = Y === WSOL ? solGain : y1 - y0;
      on("withdraw", "done", `${formatUnits(xGot, p.tokenX.mint.decimals)} ${xSym} + ${formatUnits(yGot, p.tokenY.mint.decimals)} ${ySym}`);

      on("swap", "running");
      if (xGot > ZERO) {
        if (X === WSOL) xGot = solGain > KEEP ? solGain - KEEP : ZERO;
        if (xGot > ZERO) yGot += await jupSwap(s, X, Y, xGot);
      }
      // Pools with no SOL side: the returned rent is SOL too, so it goes back with the rest.
      if (X !== WSOL && Y !== WSOL && solGain > toLamports(0.02)) yGot += await jupSwap(s, WSOL, Y, solGain - KEEP);
      on("swap", "done", `${formatUnits(yGot, p.tokenY.mint.decimals)} ${ySym}`);
      if (yGot <= ZERO) throw new ExecError("The pool didn't release any funds.");
      return fromSolana(s, Y, yGot, on);
    },
  };
}

/** Unsigned "open position + add liquidity" (Spot, both sides of the active bin), co-signed by the position key. */
export async function meteoraDepositTx(sol: string, lbPair: string, position: Keypair, x: bigint, y: bigint): Promise<string> {
  const m = await loadSdk();
  const { BN } = await import("@coral-xyz/anchor");
  const p = await m.default.create(solana(), new PublicKey(lbPair)); // fresh active bin
  const active = p.lbPair.activeId;
  const tx = await p.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: position.publicKey,
    user: new PublicKey(sol),
    totalXAmount: new BN(x.toString()),
    totalYAmount: new BN(y.toString()),
    strategy: { minBinId: active - HALF_WIDTH, maxBinId: active + HALF_WIDTH, strategyType: m.StrategyType.Spot },
    slippage: 1,
  });
  return legacyToHex(sol, tx, [position]);
}

/** Unsigned transactions removing `bps` of a position (claiming its fees; closing it when it's all). Built lazily. */
export async function meteoraWithdrawTxs(sol: string, lbPair: string, h: { key: PublicKey; lower: number; upper: number }, bps: number): Promise<(() => Promise<string>)[]> {
  const m = await loadSdk();
  const { BN } = await import("@coral-xyz/anchor");
  const build = async () => {
    const p = await m.default.create(solana(), new PublicKey(lbPair));
    return p.removeLiquidity({ user: new PublicKey(sol), position: h.key, fromBinId: h.lower, toBinId: h.upper, bps: new BN(bps), shouldClaimAndClose: bps >= 10_000 });
  };
  const n = (await build()).length;
  // Each one is rebuilt right before it's sent, so its blockhash is fresh.
  return Array.from({ length: n }, (_, i) => async () => legacyToHex(sol, (await build())[i]));
}

registerAdapters((o: Opp) => {
  if (o.chain !== "Solana" || o.protocol !== "Meteora" || !o.id.startsWith("meteora:solana:")) return null;
  const lbPair = o.id.slice("meteora:solana:".length);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(lbPair)) return null;
  return meteoraPool(lbPair, o.asset);
});

/** Exported for scripts and tests. */
export const meteoraInternals = { pool, positions, positionKey, rentNeeded, xInY };
