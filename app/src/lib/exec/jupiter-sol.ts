"use client";

import { formatUnits, parseUnits } from "viem";
import { ExecError, IN_STEPS, OUT_STEPS, registerAdapters, sendSol, waitForArrival, type Adapter, type Opp } from "../execute";
import { buildTx, createAtaIx, decompileB64, fromSolana, needSol, previewFromSolana, previewToSolana, spendableSol, timeout, toSolana, unwrapSolIx, WSOL, wrapSolIxs } from "./solana-kit";

/**
 * Jupiter Lend's SOL vault (jlWSOL). Jupiter's API builds deposits and withdrawals from a WSOL token account, so the
 * native SOL that Relay delivers is wrapped first (and unwrapped again on the way out), in the same transaction.
 */

const JUP_LEND = "https://lite-api.jup.ag/lend/v1/earn";
const ZERO = BigInt(0);

type JupToken = { address: string; assetAddress: string; decimals: number; asset: { symbol: string; decimals: number } };
let tokens: Promise<JupToken[]> | null = null;
async function jlToken(jl: string): Promise<JupToken> {
  tokens ??= fetch(`${JUP_LEND}/tokens`).then((r) => r.json() as Promise<JupToken[]>);
  tokens.catch(() => (tokens = null));
  const t = (await tokens).find((x) => x.address === jl);
  if (!t) throw new ExecError("This Jupiter Lend vault isn't available right now.");
  return t;
}

async function underlying(sol: string, jl: string): Promise<bigint> {
  const rows = (await fetch(`${JUP_LEND}/positions?users=${sol}`).then((r) => r.json())) as { token: { address: string }; underlyingAssets: string }[];
  return BigInt(rows.find((r) => r.token.address === jl)?.underlyingAssets ?? "0");
}

async function jupIxs(kind: "deposit" | "withdraw", signer: string, amount: bigint) {
  const res = await fetch(`${JUP_LEND}/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ asset: WSOL, signer, amount: amount.toString() }),
  });
  const j = (await res.json().catch(() => ({}))) as { transaction?: string; error?: string; message?: string };
  if (!j.transaction) throw new ExecError(`Jupiter Lend couldn't build the ${kind}: ${j.error ?? j.message ?? res.status}`);
  return decompileB64(j.transaction);
}

/** Unsigned deposit: wrap `lamports` of SOL, deposit it, close the WSOL account. */
export async function jlSolDepositTx(sol: string, jl: string, lamportsIn: bigint): Promise<string> {
  const { ixs, tables } = await jupIxs("deposit", sol, lamportsIn);
  return buildTx(sol, [createAtaIx(sol, jl), ...wrapSolIxs(sol, lamportsIn), ...ixs, unwrapSolIx(sol)], tables);
}

/** Unsigned withdrawal of `lamports` worth of SOL, unwrapped to native SOL. */
export async function jlSolWithdrawTx(sol: string, lamportsOut: bigint): Promise<string> {
  const { ixs, tables } = await jupIxs("withdraw", sol, lamportsOut);
  return buildTx(sol, [createAtaIx(sol, WSOL), ...ixs, unwrapSolIx(sol)], tables);
}

function jupiterLendSol(jl: string): Adapter {
  const symbol = "SOL";
  return {
    positionSymbol: symbol,
    depositSteps: IN_STEPS,
    withdrawSteps: OUT_STEPS,
    position: async (s) => (s.solanaAddress ? Number(formatUnits(await timeout(underlying(s.solanaAddress, jl), 30_000, "Jupiter"), 9)) : 0),
    previewDeposit: (s, usdg) => previewToSolana(s, usdg, WSOL, symbol),
    previewWithdraw: (s, amount) => previewFromSolana(s, WSOL, parseUnits(amount, 9)),

    deposit: async (s, usdg, on) => {
      const sol = needSol(s);
      await jlToken(jl);
      const got = await toSolana(s, usdg, WSOL, symbol, on);
      on("deposit", "running");
      const before = await underlying(sol, jl);
      let amount = got;
      await sendSol(s, async () => {
        amount = await spendableSol(sol, got);
        return jlSolDepositTx(sol, jl, amount);
      });
      await waitForArrival(() => underlying(sol, jl), before, 60_000);
      on("deposit", "done");
      return `${formatUnits(amount, 9)} ${symbol}`;
    },

    withdraw: async (s, amount, on) => {
      const sol = needSol(s);
      on("withdraw", "running");
      const held = await underlying(sol, jl);
      const amt = amount === "max" ? held : parseUnits(amount, 9);
      if (held === ZERO || amt <= ZERO || amt > held) throw new ExecError("You don't have that much in this vault.");
      const { lamports } = await import("../solana");
      const before = await lamports(sol);
      await sendSol(s, () => jlSolWithdrawTx(sol, amt));
      const out = await waitForArrival(() => lamports(sol), before, 60_000);
      on("withdraw", "done", `${formatUnits(out, 9)} ${symbol}`);
      return fromSolana(s, WSOL, out, on);
    },
  };
}

registerAdapters((o: Opp) => {
  if (o.chain !== "Solana" || o.protocol !== "Jupiter Lend" || (o.asset !== "WSOL" && o.asset !== "SOL")) return null;
  const jl = o.id.split(":")[2];
  return jl ? jupiterLendSol(jl) : null;
});
