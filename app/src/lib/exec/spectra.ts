"use client";

import { encodeFunctionData, formatUnits, parseAbi, parseUnits, type Address } from "viem";
import { evmChain } from "../exec-chains";
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
  type Adapter,
  type Who,
  legSlippageBpsNow,
} from "../execute";
import { USDG_DECIMALS } from "../wallet";
import { approveIfNeeded, fmt, previewIn, previewOut, runIn, runOut, stepPreview } from "./pt-route";

/** This run's per-leg slippage tolerance in bps (set from the 0.5% route budget). */
const slipBps = () => BigInt(legSlippageBpsNow());

/**
 * Spectra fixed yield. Catalog id `spectra:<chainId>:<pool>`, `address` = the principal token (PT).
 * Every Spectra pool is a Curve StableSwap-NG pool with coins(0) = the interest-bearing token (IBT, an ERC-4626 vault
 * over the underlying) and coins(1) = the PT (checked on-chain for every listed pool).
 *
 * Buy:  USDG -> underlying (Relay, or Relay + LI.FI) -> IBT.deposit -> pool.exchange(IBT -> PT).
 * Sell: before maturity pool.exchange(PT -> IBT) -> IBT.redeem; at maturity PT.redeem (1 PT -> its underlying value).
 * Then underlying -> USDG. The position is the PT balance, shown in PT units.
 * Flare (chain 14) pools switch on by themselves once chain 14 is in EVM_CHAINS (Relay doesn't serve Flare; the
 * route goes Relay -> USDC on Base -> LI.FI/Stargate -> FXRP / WFLR).
 */

const BPS = BigInt(10_000);
const IBT_I = BigInt(0);
const PT_I = BigInt(1);

const PT_ABI = parseAbi([
  "function underlying() view returns (address)",
  "function getIBT() view returns (address)",
  "function maturity() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);
const IBT_ABI = parseAbi([
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);
const POOL_ABI = parseAbi([
  "function coins(uint256) view returns (address)",
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
  "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy, address receiver) returns (uint256)",
]);

function spectraPt(chainId: number, pool: Address, pt: Address, label: string): Adapter {
  const c = () => chainClient(chainId);
  const info = lazy(async () => {
    const [underlying, ibt, maturity, decimals, c0, c1] = await Promise.all([
      c().readContract({ address: pt, abi: PT_ABI, functionName: "underlying" }),
      c().readContract({ address: pt, abi: PT_ABI, functionName: "getIBT" }),
      c().readContract({ address: pt, abi: PT_ABI, functionName: "maturity" }),
      c().readContract({ address: pt, abi: PT_ABI, functionName: "decimals" }),
      c().readContract({ address: pool, abi: POOL_ABI, functionName: "coins", args: [IBT_I] }),
      c().readContract({ address: pool, abi: POOL_ABI, functionName: "coins", args: [PT_I] }),
    ]);
    if (c0.toLowerCase() !== ibt.toLowerCase() || c1.toLowerCase() !== pt.toLowerCase()) throw new ExecError("This Spectra pool isn't laid out as expected.");
    return { und: await tokenMeta(chainId, underlying), ibt, maturity: Number(maturity), decimals };
  });
  const matured = async () => Date.now() / 1000 >= (await info()).maturity;
  const held = (owner: Address) => erc20Balance(chainId, pt, owner);
  const dy = (i: bigint, j: bigint, dx: bigint) => c().readContract({ address: pool, abi: POOL_ABI, functionName: "get_dy", args: [i, j, dx] });
  const minOf = (v: bigint) => (v * (BPS - slipBps())) / BPS;
  /** Price impact of a pool swap: the quote vs. the same trade at the rate of a 1/1000 slice. */
  const impact = async (i: bigint, j: bigint, dx: bigint, out: bigint) => {
    const slice = dx / BigInt(1000);
    if (slice === BigInt(0) || out === BigInt(0)) return 0;
    const ref = (await dy(i, j, slice)) * BigInt(1000);
    return ref > BigInt(0) ? (Number(out) / Number(ref) - 1) * 100 : 0;
  };

  /** underlying -> PT, quoted. */
  const quoteBuy = async (assets: bigint) => {
    const m = await info();
    const shares = await c().readContract({ address: m.ibt, abi: IBT_ABI, functionName: "previewDeposit", args: [assets] });
    const out = await dy(IBT_I, PT_I, shares);
    return { shares, out, impactPct: await impact(IBT_I, PT_I, shares, out) };
  };
  /** PT -> underlying, quoted. */
  const quoteSell = async (amount: bigint) => {
    const m = await info();
    if (await matured()) return { out: await c().readContract({ address: pt, abi: PT_ABI, functionName: "previewRedeem", args: [amount] }), slip: false, impactPct: 0 };
    const ibtOut = await dy(PT_I, IBT_I, amount);
    const out = await c().readContract({ address: m.ibt, abi: IBT_ABI, functionName: "previewRedeem", args: [ibtOut] });
    return { out, slip: true, impactPct: await impact(PT_I, IBT_I, amount, ibtOut) };
  };

  return {
    positionSymbol: label,
    depositSteps: [IN_STEPS[0], IN_STEPS[1], { id: "deposit", label: `Buy ${label}` }],
    withdrawSteps: [{ id: "withdraw", label: `Sell or redeem ${label}` }, OUT_STEPS[1], OUT_STEPS[2]],

    position: async (s: Who) => {
      const [m, b] = await Promise.all([info(), held(s.address)]);
      return Number(formatUnits(b, m.decimals));
    },

    previewDeposit: async (s, usdg) => {
      if (await matured()) throw new ExecError("This PT has matured and can't be bought any more.");
      const m = await info();
      const r = await previewIn(s, chainId, m.und.address, m.und.decimals, m.und.symbol, netOfFee(usdg));
      const q = await quoteBuy(r.out);
      const step = stepPreview(q.out, minOf(q.out), m.decimals, label, Number(slipBps()) / 100, q.impactPct);
      return chainPreview(r.preview, r.out, r.min, step, q.out, minOf(q.out), m.decimals);
    },

    previewWithdraw: async (s, amount) => {
      const m = await info();
      const q = await quoteSell(parseUnits(amount, m.decimals));
      const min = q.slip ? minOf(q.out) : q.out;
      const r = await previewOut(s, chainId, m.und.address, q.out);
      const step = stepPreview(q.out, min, m.und.decimals, m.und.symbol, q.slip ? Number(slipBps()) / 100 : 0, q.impactPct);
      return chainPreview(step, q.out, min, r.preview, r.out, r.min, USDG_DECIMALS);
    },

    deposit: async (s, usdg, on) => {
      if (await matured()) throw new ExecError("This PT has matured and can't be bought any more.");
      const m = await info();
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const got = await runIn(s, chainId, m.und.address, net);
      on("bridge", "done", fmt(got, m.und.decimals, m.und.symbol));

      on("deposit", "running");
      // underlying -> IBT
      const readIbt = () => erc20Balance(chainId, m.ibt, s.address);
      const ibtBefore = await readIbt();
      await approveIfNeeded(s, chainId, m.und.address, m.ibt, got);
      await sendEvm(s, chainId, { to: m.ibt, data: encodeFunctionData({ abi: IBT_ABI, functionName: "deposit", args: [got, s.address] }) });
      const shares = (await readIbt()) - ibtBefore;
      if (shares <= BigInt(0)) throw new ExecError(`The vault didn't accept the deposit. Your ${m.und.symbol} is still in your wallet.`);
      // IBT -> PT
      const before = await held(s.address);
      const min = minOf(await dy(IBT_I, PT_I, shares));
      await approveIfNeeded(s, chainId, m.ibt, pool, shares);
      await sendEvm(s, chainId, { to: pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: "exchange", args: [IBT_I, PT_I, shares, min, s.address] }) });
      const bought = (await held(s.address)) - before;
      if (bought <= BigInt(0)) throw new ExecError("The swap into PT didn't go through. Your funds are in your wallet.");
      const shown = fmt(bought, m.decimals, label);
      on("deposit", "done", shown);
      return shown;
    },

    withdraw: async (s, amount, on) => {
      const m = await info();
      on("withdraw", "running");
      const bal = await held(s.address);
      if (bal === BigInt(0)) throw new ExecError("You don't have this PT.");
      const amt = amount === "max" ? bal : parseUnits(amount, m.decimals);
      if (amt <= BigInt(0) || amt > bal) throw new ExecError(`You don't have that much ${label}.`);
      const readUnd = () => erc20Balance(chainId, m.und.address, s.address);
      const before = await readUnd();
      if (await matured()) {
        await sendEvm(s, chainId, { to: pt, data: encodeFunctionData({ abi: PT_ABI, functionName: "redeem", args: [amt, s.address, s.address] }) });
      } else {
        const readIbt = () => erc20Balance(chainId, m.ibt, s.address);
        const ibtBefore = await readIbt();
        const min = minOf(await dy(PT_I, IBT_I, amt));
        await approveIfNeeded(s, chainId, pt, pool, amt);
        await sendEvm(s, chainId, { to: pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: "exchange", args: [PT_I, IBT_I, amt, min, s.address] }) });
        const shares = (await readIbt()) - ibtBefore;
        if (shares <= BigInt(0)) throw new ExecError("The PT sale didn't go through.");
        await sendEvm(s, chainId, { to: m.ibt, data: encodeFunctionData({ abi: IBT_ABI, functionName: "redeem", args: [shares, s.address, s.address] }) });
      }
      const out = (await readUnd()) - before;
      if (out <= BigInt(0)) throw new ExecError(`Spectra didn't return any ${m.und.symbol}.`);
      on("withdraw", "done", fmt(out, m.und.decimals, m.und.symbol));
      return runOut(s, chainId, m.und.address, out, on);
    },
  };
}

registerAdapters((o) => {
  if (o.protocol !== "Spectra" || !o.id.startsWith("spectra:")) return null;
  const [, c, pool] = o.id.split(":");
  const chainId = Number(c);
  const pt = o.address ?? undefined;
  // Chains the executor can't run on yet (e.g. Flare until it's added to EVM_CHAINS) stay off.
  if (!isAddr(pool) || !isAddr(pt) || !evmChain(chainId)) return null;
  const label = o.name?.split(" · ")[0]?.trim() || `PT ${o.asset}`;
  return spectraPt(chainId, pool, pt, label);
});

/** Exported for scripts and tests. */
export const spectraInternals = { spectraPt };
