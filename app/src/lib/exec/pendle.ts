"use client";

import { erc20Abi, formatUnits, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { chainIdByName } from "../exec-chains";
import {
  chainClient,
  chainPreview,
  erc20Balance,
  ExecError,
  IN_STEPS,
  isAddr,
  lazy,
  netOfFee,
  OUT_STEPS,
  registerAdapters,
  sendEvm,
  takeUsdgFee,
  tokenMeta,
  USDC_ON,
  type Adapter,
  type Preview,
  type TokenMeta,
  type Who,
  legSlippageBpsNow,
} from "../execute";
import { USDG_DECIMALS } from "../wallet";
import { approveIfNeeded, fmt, previewIn, previewOut, runIn, runOut, stepPreview } from "./pt-route";

/** This run's per-leg slippage tolerance, as a fraction (set from the 0.5% route budget). */
const slip = () => legSlippageBpsNow() / 10_000;

/**
 * Pendle fixed yield (PT) and liquidity (LP) markets. Catalog ids: `pendle:<chainId>:<market>` (PT) and
 * `pendle:<chainId>:<market>:lp` (LP). USDG is routed into a token the market's router accepts (a stablecoin on that
 * chain, else the market's own underlying), then Pendle's hosted SDK ("convert", free, no key, CORS-open) builds the
 * Router call: token -> PT (swapExactTokenForPt), token -> LP (addLiquiditySingleToken), and back
 * (swapExactPtForToken / removeLiquiditySingleToken; after maturity, redeemPyToToken). The position is the PT (or LP)
 * balance, shown in PT (or LP) units.
 */

const PENDLE = "https://api-v2.pendle.finance/core";


/** Stablecoins to enter and leave through, per chain, in order of preference (on top of USDC_ON). */
const EXTRA_STABLES: Record<number, Address[]> = {
  9745: ["0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb"], // Plasma USDT0
  999: ["0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb"], // HyperEVM USDT0
  42161: ["0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9"], // Arbitrum USDT0
  56: ["0x55d398326f99059ff775485246999027b3197955"], // BNB Chain USDT
};
const stables = (chainId: number): Address[] => [...(USDC_ON[chainId] ? [USDC_ON[chainId]] : []), ...(EXTRA_STABLES[chainId] ?? [])];

const MARKET_ABI = parseAbi([
  "function readTokens() view returns (address _SY, address _PT, address _YT)",
  "function expiry() view returns (uint256)",
]);

type Tokens = { tokensMintSy: string[]; tokensRedeemSy: string[]; tokensIn: string[]; tokensOut: string[] };
type ConvertRoute = {
  tx: { to: Address; data: Hex; value?: string };
  outputs: { token: string; amount: string }[];
  data?: { priceImpact?: number; fee?: { usd?: number } };
};
type ConvertRes = { action?: string; requiredApprovals?: { token: Address; amount: string }[]; routes?: ConvertRoute[]; message?: string | string[] };

async function convert(chainId: number, receiver: Address, tokenIn: Address, amountIn: bigint, tokenOut: Address) {
  const q = new URLSearchParams({
    receiver,
    slippage: String(slip()),
    enableAggregator: "true",
    tokensIn: tokenIn,
    amountsIn: amountIn.toString(),
    tokensOut: tokenOut,
  });
  const res = await fetch(`${PENDLE}/v2/sdk/${chainId}/convert?${q}`);
  const j = (await res.json().catch(() => ({}))) as ConvertRes;
  if (!res.ok || !j.routes?.length) {
    const why = Array.isArray(j.message) ? j.message.join(", ") : j.message;
    throw new ExecError(res.status === 429 ? "Pendle is busy right now. Try again in a minute." : `Pendle has no route right now${why ? `: ${why}` : ""}.`);
  }
  const best = j.routes.reduce((a, b) => (BigInt(b.outputs[0]?.amount ?? "0") > BigInt(a.outputs[0]?.amount ?? "0") ? b : a));
  const out = BigInt(best.outputs[0]?.amount ?? "0");
  return {
    action: j.action ?? "",
    tx: best.tx,
    approvals: j.requiredApprovals ?? [],
    out,
    min: (out * BigInt(Math.round((1 - slip()) * 10_000))) / BigInt(10_000),
    impactPct: -(best.data?.priceImpact ?? 0) * 100,
    feesUsd: best.data?.fee?.usd ?? 0,
  };
}

function pendleMarket(chainId: number, market: Address, lp: boolean, asset: string): Adapter {
  const label = `${lp ? "LP" : "PT"} ${asset}`;
  const c = () => chainClient(chainId);
  const info = lazy(async () => {
    const [[, pt], expiry] = await Promise.all([
      c().readContract({ address: market, abi: MARKET_ABI, functionName: "readTokens" }),
      c().readContract({ address: market, abi: MARKET_ABI, functionName: "expiry" }),
    ]);
    const token = lp ? market : pt;
    const decimals = await c().readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
    return { token, decimals, expiry: Number(expiry) };
  });
  const matured = async () => Date.now() / 1000 >= (await info()).expiry;
  const tokens = lazy(async () => {
    const res = await fetch(`${PENDLE}/v1/sdk/${chainId}/markets/${market}/tokens`);
    if (!res.ok) throw new ExecError(res.status === 429 ? "Pendle is busy right now. Try again in a minute." : "Pendle didn't answer. Try again in a moment.");
    return (await res.json()) as Tokens;
  });
  /** The token we route USDG into (deposit) or out of (withdraw): a stablecoin the router takes, else the underlying. */
  const entry = (dir: "in" | "out") =>
    lazy(async (): Promise<TokenMeta> => {
      const t = await tokens();
      const ok = new Set((dir === "in" ? t.tokensIn : t.tokensOut).map((x) => x.toLowerCase()));
      const own = (dir === "in" ? t.tokensMintSy : t.tokensRedeemSy).filter((x) => isAddr(x) && !/^0x0{40}$/.test(x)) as Address[];
      const pick = [...stables(chainId), ...own].find((x) => ok.has(x.toLowerCase()) || own.includes(x));
      if (!pick) throw new ExecError("Pendle has no token Pecun can route for this market.");
      return tokenMeta(chainId, pick);
    });
  const entryIn = entry("in");
  const entryOut = entry("out");
  const held = async (owner: Address) => erc20Balance(chainId, (await info()).token, owner);

  const pendleStep = (q: Awaited<ReturnType<typeof convert>>, decimals: number, symbol: string): Preview =>
    stepPreview(q.out, q.min, decimals, symbol, slip() * 100, q.impactPct, q.feesUsd);

  return {
    positionSymbol: label,
    depositSteps: [IN_STEPS[0], IN_STEPS[1], { id: "deposit", label: lp ? `Add liquidity (${label})` : `Buy ${label}` }],
    withdrawSteps: [{ id: "withdraw", label: lp ? `Remove liquidity (${label})` : `Sell or redeem ${label}` }, OUT_STEPS[1], OUT_STEPS[2]],

    position: async (s) => {
      const [m, b] = await Promise.all([info(), held(s.address)]);
      return Number(formatUnits(b, m.decimals));
    },

    previewDeposit: async (s, usdg) => {
      if (await matured()) throw new ExecError("This market has matured and no longer takes deposits.");
      const [m, e] = await Promise.all([info(), entryIn()]);
      const r = await previewIn(s, chainId, e.address, e.decimals, e.symbol, netOfFee(usdg));
      const q = await convert(chainId, s.address, e.address, r.out, m.token);
      return chainPreview(r.preview, r.out, r.min, pendleStep(q, m.decimals, label), q.out, q.min, m.decimals);
    },

    previewWithdraw: async (s, amount) => {
      const [m, e] = await Promise.all([info(), entryOut()]);
      const q = await convert(chainId, s.address, m.token, parseUnits(amount, m.decimals), e.address);
      const r = await previewOut(s, chainId, e.address, q.out);
      return chainPreview(pendleStep(q, e.decimals, e.symbol), q.out, q.min, r.preview, r.out, r.min, USDG_DECIMALS);
    },

    deposit: async (s, usdg, on) => {
      if (await matured()) throw new ExecError("This market has matured and no longer takes deposits.");
      const [m, e] = await Promise.all([info(), entryIn()]);
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const got = await runIn(s, chainId, e.address, net);
      on("bridge", "done", fmt(got, e.decimals, e.symbol));

      on("deposit", "running");
      const before = await held(s.address);
      const q = await convert(chainId, s.address, e.address, got, m.token);
      for (const a of q.approvals) await approveIfNeeded(s, chainId, a.token, q.tx.to, BigInt(a.amount));
      await sendEvm(s, chainId, { to: q.tx.to, data: q.tx.data, value: q.tx.value ? BigInt(q.tx.value) : undefined });
      const bought = (await held(s.address)) - before;
      if (bought <= BigInt(0)) throw new ExecError(`Pendle didn't deliver any ${label}. Your ${e.symbol} is still in your wallet.`);
      const shown = fmt(bought, m.decimals, label);
      on("deposit", "done", shown);
      return shown;
    },

    withdraw: async (s, amount, on) => {
      const [m, e] = await Promise.all([info(), entryOut()]);
      on("withdraw", "running");
      const bal = await held(s.address);
      const amt = amount === "max" ? bal : parseUnits(amount, m.decimals);
      if (bal === BigInt(0)) throw new ExecError("You don't have a position in this market.");
      if (amt <= BigInt(0) || amt > bal) throw new ExecError(`You don't have that much ${label}.`);
      const read = () => erc20Balance(chainId, e.address, s.address);
      const before = await read();
      const q = await convert(chainId, s.address, m.token, amt, e.address);
      // Only approve what the user actually spends (after maturity Pendle also lists the YT, which isn't pulled).
      for (const a of q.approvals) {
        if ((await erc20Balance(chainId, a.token, s.address)) === BigInt(0)) continue;
        await approveIfNeeded(s, chainId, a.token, q.tx.to, BigInt(a.amount));
      }
      await sendEvm(s, chainId, { to: q.tx.to, data: q.tx.data, value: q.tx.value ? BigInt(q.tx.value) : undefined });
      const out = (await read()) - before;
      if (out <= BigInt(0)) throw new ExecError(`Pendle didn't return any ${e.symbol}.`);
      on("withdraw", "done", fmt(out, e.decimals, e.symbol));
      return runOut(s, chainId, e.address, out, on);
    },
  };
}

registerAdapters((o) => {
  if (o.protocol !== "Pendle" || !o.id.startsWith("pendle:")) return null;
  const [, c, market, kind] = o.id.split(":");
  const chainId = Number(c);
  if (!isAddr(market) || chainIdByName(o.chain) !== chainId) return null;
  if (kind !== undefined && kind !== "lp") return null;
  return pendleMarket(chainId, market, kind === "lp", o.asset);
});

/** Exported for scripts and tests. */
export const pendleInternals = { convert, pendleMarket, stables };
