"use client";

import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, type Address, type Hex } from "viem";
import {
  BASE_CHAIN_ID,
  BASE_USDC,
  backToUsdg,
  chainClient,
  chainPreview,
  erc20Balance,
  ExecError,
  lifiFailed,
  lifiPreview,
  lifiQuote,
  lifiRoute,
  outOf,
  planRoute,
  relay,
  relayQuote,
  runRoute,
  scaledMin,
  sendEvm,
  toPreview,
  waitForArrival,
  type Preview,
  type Progress,
  type Signer,
  type Who,
} from "../execute";
import { ROBINHOOD_CHAIN_ID, USDG, USDG_DECIMALS } from "../wallet";

/**
 * Shared legs for the fixed-yield modules (Pendle, Spectra): USDG <-> a token on the vault's chain.
 * Relay first (direct or via USDC, as `planRoute` picks); when Relay has no route (Flare, or a token only DEX
 * aggregators carry, like jEURx on Base), it falls back to Relay USDG -> USDC on Base, then LI.FI to the token.
 */

export type Quoted = { preview: Preview; out: bigint; min: bigint };

const raw = (p: Preview, decimals: number, field: "out" | "minOut") => {
  try {
    return parseUnits(p[field], decimals);
  } catch {
    return BigInt(0);
  }
};

const isBaseUsdc = (chainId: number, token: string) => chainId === BASE_CHAIN_ID && token.toLowerCase() === BASE_USDC.toLowerCase();

/** Does Relay route this leg? (Quotes only; nothing is sent.) */
async function relayRoutes(leg: Parameters<typeof planRoute>[0]) {
  try {
    await planRoute(leg, "");
    return true;
  } catch {
    return false;
  }
}

/** Approves `spender` for `amount` of `token` if the current allowance is short. */
export async function approveIfNeeded(s: Signer, chainId: number, token: Address, spender: Address, amount: bigint) {
  const allowance = await chainClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [s.address, spender] });
  if (allowance < amount) await sendEvm(s, chainId, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) });
}

/** Price of `net` USDG (after Pecun's fee) -> `token` on `chainId`. */
export async function previewIn(s: Who, chainId: number, token: Address, decimals: number, symbol: string, net: bigint): Promise<Quoted> {
  const leg = { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount: net, user: s.address, recipient: s.address };
  try {
    const p = await planRoute(leg, symbol);
    return { preview: p.preview, out: p.out, min: raw(p.preview, decimals, "minOut") || p.out };
  } catch (e) {
    if (isBaseUsdc(chainId, token)) throw e;
    const rq = await relayQuote({ ...leg, to: BASE_CHAIN_ID, outToken: BASE_USDC });
    const o1 = outOf(rq);
    const r = await lifiRoute({ fromChain: BASE_CHAIN_ID, toChain: chainId, fromToken: BASE_USDC, toToken: token, amount: o1.out, from: s.address, to: s.address });
    const out = BigInt(r.toAmount);
    return {
      preview: chainPreview(toPreview(rq, "USDC"), o1.out, o1.min, lifiPreview(r), out, BigInt(r.toAmountMin), r.toToken.decimals),
      out,
      min: scaledMin(BigInt(r.toAmountMin), o1.out, o1.min),
    };
  }
}

/** Moves `net` USDG into `token` on `chainId`; returns how much of it arrived. */
export async function runIn(s: Signer, chainId: number, token: Address, net: bigint): Promise<bigint> {
  const leg = { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount: net, user: s.address, recipient: s.address };
  const read = () => erc20Balance(chainId, token, s.address);
  const before = await read();
  if (isBaseUsdc(chainId, token) || (await relayRoutes(leg))) {
    await runRoute(s, leg);
    return waitForArrival(read, before, 10 * 60_000);
  }
  // Relay to USDC on Base, then LI.FI onward.
  const usdcOnBase = () => erc20Balance(BASE_CHAIN_ID, BASE_USDC, s.address);
  const baseBefore = await usdcOnBase();
  await relay(s, { ...leg, to: BASE_CHAIN_ID, outToken: BASE_USDC });
  const usdc = await waitForArrival(usdcOnBase, baseBefore, 10 * 60_000);
  const q = await lifiQuote({ fromChain: BASE_CHAIN_ID, toChain: chainId, fromToken: BASE_USDC, toToken: token, amount: usdc, from: s.address, to: s.address });
  await approveIfNeeded(s, BASE_CHAIN_ID, BASE_USDC, q.estimate.approvalAddress ?? q.transactionRequest.to!, usdc);
  const hash = await sendEvm(s, BASE_CHAIN_ID, { to: q.transactionRequest.to!, data: q.transactionRequest.data as Hex, value: q.transactionRequest.value ? BigInt(q.transactionRequest.value) : undefined });
  return waitForArrival(read, before, 15 * 60_000, chainId === BASE_CHAIN_ID ? undefined : lifiFailed(hash, BASE_CHAIN_ID, chainId));
}

/** Price of `amount` of `token` on `chainId` -> USDG (before Pecun's fee, which comes off what arrives). */
export async function previewOut(s: Who, chainId: number, token: Address, amount: bigint): Promise<Quoted> {
  const leg = { from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: token, outToken: USDG, amount, user: s.address, recipient: s.address };
  try {
    const p = await planRoute(leg, "USDG");
    return { preview: p.preview, out: p.out, min: raw(p.preview, USDG_DECIMALS, "minOut") || p.out };
  } catch (e) {
    if (isBaseUsdc(chainId, token)) throw e;
    const r = await lifiRoute({ fromChain: chainId, toChain: BASE_CHAIN_ID, fromToken: token, toToken: BASE_USDC, amount, from: s.address, to: s.address });
    const usdc = BigInt(r.toAmount);
    const usdcMin = BigInt(r.toAmountMin);
    const rq = await relayQuote({ from: BASE_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: BASE_USDC, outToken: USDG, amount: usdc, user: s.address, recipient: s.address });
    const o2 = outOf(rq);
    return { preview: chainPreview(lifiPreview(r), usdc, usdcMin, toPreview(rq, "USDG"), o2.out, o2.min, USDG_DECIMALS), out: o2.out, min: scaledMin(o2.min, usdc, usdcMin) };
  }
}

/** Brings `amount` of `token` on `chainId` back to USDG on Robinhood Chain and takes Pecun's fee. */
export async function runOut(s: Signer, chainId: number, token: Address, amount: bigint, on: Progress): Promise<string> {
  const leg = { from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: token, outToken: USDG, amount, user: s.address, recipient: s.address };
  if (isBaseUsdc(chainId, token) || (await relayRoutes(leg))) return backToUsdg(s, { from: chainId, inToken: token, amount, user: s.address }, on);
  on("bridge", "running");
  const usdcOnBase = () => erc20Balance(BASE_CHAIN_ID, BASE_USDC, s.address);
  const baseBefore = await usdcOnBase();
  const q = await lifiQuote({ fromChain: chainId, toChain: BASE_CHAIN_ID, fromToken: token, toToken: BASE_USDC, amount, from: s.address, to: s.address });
  await approveIfNeeded(s, chainId, token, q.estimate.approvalAddress ?? q.transactionRequest.to!, amount);
  const hash = await sendEvm(s, chainId, { to: q.transactionRequest.to!, data: q.transactionRequest.data as Hex, value: q.transactionRequest.value ? BigInt(q.transactionRequest.value) : undefined });
  const usdc = await waitForArrival(usdcOnBase, baseBefore, 15 * 60_000, chainId === BASE_CHAIN_ID ? undefined : lifiFailed(hash, chainId, BASE_CHAIN_ID));
  return backToUsdg(s, { from: BASE_CHAIN_ID, inToken: BASE_USDC, amount: usdc, user: s.address }, on);
}

/** A one-leg preview for an on-chain swap/deposit step (Pendle or Spectra), to chain after a route preview. */
export function stepPreview(out: bigint, min: bigint, decimals: number, symbol: string, slippagePct: number, impactPct: number, feesUsd = 0, seconds = 15): Preview {
  return { out: formatUnits(out, decimals), outSymbol: symbol, minOut: formatUnits(min, decimals), slippagePct, impactPct, feesUsd, seconds };
}

export const fmt = (v: bigint, decimals: number, symbol: string) => `${formatUnits(v, decimals)} ${symbol}`;
export { ExecError };
