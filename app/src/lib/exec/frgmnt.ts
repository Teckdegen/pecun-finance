"use client";

import { decodeEventLog, encodeFunctionData, formatUnits, parseAbi, parseUnits, type Address } from "viem";
import {
  ExecError,
  IN_STEPS,
  OUT_STEPS,
  chainClient,
  ensureAllowance,
  erc20Balance,
  netOfFee,
  registerAdapters,
  routeInto,
  sendEvm,
  takeUsdgFee,
  type Adapter,
  type Preview,
  type QueueState,
} from "../execute";
import { HOME_CHAIN_ID, HOME_TOKEN, USDG_DECIMALS } from "../wallet";

/**
 * Frgmnt USD (fUSD), staked as sfUSD: Frgmnt's flagship on Base. USDC mints fUSD 1:1 (TokenLogic), staking fUSD gives
 * sfUSD 1:1 (PoolLogic), and stakers earn the pool's Morpho lending yield as fUSD rewards (pendingReward), less
 * Frgmnt's 20% performance fee. 0% mint, stake and exit fees.
 *
 * Exit: unstake sfUSD to fUSD, then cash fUSD out to USDC (withdrawCashImmediate). Frgmnt only allows the cash out 24
 * hours after the wallet's last mint or yield claim; inside that window the fUSD waits in the wallet as a pending
 * withdrawal and Pecun cashes it out by itself once the window ends (queue / bringHome). Claiming yield restarts that
 * window, so on a full exit the principal comes out first and the yield is claimed after, coming home a day later.
 */

const CHAIN = 8453;
const POOL = "0x704c56974e0CA4BF8ff8fe8acc51FBF1E053878E" as Address; // PoolLogic: sfUSD
const FUSD = "0xeB82611A2B2dC9FBEAF5903d5decDf801765B759" as Address; // TokenLogic: fUSD
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
export const FRGMNT_FUSD_ID = "frgmnt:8453:fusd";
const DUST = BigInt(10) ** BigInt(15); // 0.001 fUSD
const ZERO = BigInt(0);

const POOL_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function pendingReward(address) view returns (uint256)",
  "function stake(uint256 amountFusd, uint256 minShares)",
  "function unstake(uint256 shareAmount)",
  "function harvest()",
  "function withdrawCashImmediate(uint256 fusdAmount)",
  "function isImmediateWithdrawEnabled() view returns (bool)",
  "event CashWithdrawImmediateProRata(address indexed user, uint256 fusdTotal, uint256 fusdNet, uint256 fusdFee, address[] assets, uint256[] amounts)",
]);
const TOKEN_ABI = parseAbi([
  "function deposit(address asset, uint256 amount, address to, uint256 minFusdAmount)",
  "function balanceOf(address) view returns (uint256)",
  "function getExitRemainingCooldown(address user) view returns (uint256)",
  "function minDepositUSD() view returns (uint256)",
  "function assetConfigs(address) view returns (bool allowed, uint256 decimals, uint256 cap, uint256 totalDeposited)",
  "function paused() view returns (bool)",
]);

if (HOME_CHAIN_ID !== CHAIN || HOME_TOKEN.toLowerCase() !== USDC.toLowerCase()) {
  // This adapter deposits straight from the home balance; it assumes home is USDC on Base.
  console.warn("[pecun] frgmnt fUSD expects the home token to be USDC on Base.");
}

const c = () => chainClient(CHAIN);
const read = <T,>(address: Address, abi: typeof POOL_ABI | typeof TOKEN_ABI, functionName: string, args: unknown[] = []) =>
  c().readContract({ address, abi, functionName, args } as never) as Promise<T>;

const sfusdOf = (a: Address) => read<bigint>(POOL, POOL_ABI, "balanceOf", [a]);
const rewardOf = (a: Address) => read<bigint>(POOL, POOL_ABI, "pendingReward", [a]);
const fusdOf = (a: Address) => read<bigint>(FUSD, TOKEN_ABI, "balanceOf", [a]);
const cooldownOf = (a: Address) => read<bigint>(FUSD, TOKEN_ABI, "getExitRemainingCooldown", [a]);

const fmt = (x: bigint, d = 18) => formatUnits(x, d);
const waitText = (s: bigint) => {
  const h = Number(s) / 3600;
  return h >= 1 ? `about ${Math.ceil(h)} hour${Math.ceil(h) === 1 ? "" : "s"}` : `about ${Math.max(1, Math.ceil(Number(s) / 60))} minutes`;
};

const flat = (out: string, symbol: string): Preview => ({ out, outSymbol: symbol, minOut: out, slippagePct: 0, impactPct: 0, feesUsd: 0, seconds: 20, costPct: 0, legs: 0 });

/** Cashes `fusd` out to USDC and swaps anything else the pool paid out into USDC. Returns the USDC that arrived. */
async function cashOut(s: Parameters<Adapter["deposit"]>[0], fusd: bigint): Promise<bigint> {
  if (!(await read<boolean>(POOL, POOL_ABI, "isImmediateWithdrawEnabled"))) {
    throw new ExecError("Frgmnt has paused instant cash outs for now. Your fUSD is safe in your wallet; Pecun will cash it out once they reopen.");
  }
  const usdcBefore = await erc20Balance(CHAIN, USDC, s.address);
  const hash = await sendEvm(s, CHAIN, { to: POOL, data: encodeFunctionData({ abi: POOL_ABI, functionName: "withdrawCashImmediate", args: [fusd] }) });
  const receipt = await c().getTransactionReceipt({ hash });
  // The pool pays out a share of everything it holds; anything that isn't USDC goes to USDC.
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== POOL.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics });
      if (ev.eventName !== "CashWithdrawImmediateProRata") continue;
      const { assets, amounts } = ev.args as { assets: readonly Address[]; amounts: readonly bigint[] };
      for (let i = 0; i < assets.length; i++) {
        if (assets[i].toLowerCase() === USDC.toLowerCase() || amounts[i] <= ZERO) continue;
        await routeInto(s, { from: CHAIN, to: CHAIN, inToken: assets[i], outToken: USDC, amount: amounts[i], user: s.address, recipient: s.address }).catch((e) =>
          console.error("[pecun] frgmnt: couldn't swap a payout token to USDC:", e),
        );
      }
    } catch {
      /* another event */
    }
  }
  const usdcAfter = await erc20Balance(CHAIN, USDC, s.address);
  return usdcAfter > usdcBefore ? usdcAfter - usdcBefore : ZERO;
}

const adapter: Adapter = {
  positionSymbol: "fUSD",
  depositSteps: IN_STEPS,
  withdrawSteps: OUT_STEPS,

  // Staked fUSD, yield not yet claimed, and fUSD waiting in the wallet to be cashed out: all a dollar each.
  position: async (who) => {
    const [st, rw, w] = await Promise.all([sfusdOf(who.address), rewardOf(who.address).catch(() => ZERO), fusdOf(who.address)]);
    return Number(fmt(st + rw + w));
  },

  previewDeposit: async (_who, usdg) => flat(fmt(netOfFee(usdg), USDG_DECIMALS), "sfUSD"),
  previewWithdraw: async (_who, amount) => flat(amount, "USDC"),

  deposit: async (s, usdg, on) => {
    const gross = parseUnits(usdg, USDG_DECIMALS);
    const net = netOfFee(usdg);
    // Everything that could stop the deposit is checked before anything moves.
    const [paused, min, cfg] = await Promise.all([
      read<boolean>(FUSD, TOKEN_ABI, "paused"),
      read<bigint>(FUSD, TOKEN_ABI, "minDepositUSD"),
      read<readonly [boolean, bigint, bigint, bigint]>(FUSD, TOKEN_ABI, "assetConfigs", [USDC]),
    ]);
    if (paused || !cfg[0]) throw new ExecError("Frgmnt isn't taking deposits right now. Nothing was sent.");
    if (net * BigInt(10) ** BigInt(12) < min) throw new ExecError(`Frgmnt's minimum deposit is $${fmt(min)}. Nothing was sent.`);
    if (cfg[2] > ZERO && cfg[3] + net > cfg[2]) throw new ExecError(`Frgmnt USD is nearly full: $${fmt(cfg[2] - cfg[3], 6)} of room left. Nothing was sent.`);

    const kept = await takeUsdgFee(s, gross, on);
    if (kept !== net) throw new ExecError("The amount changed while preparing your deposit. Nothing was sent.");
    on("bridge", "skipped");
    on("deposit", "running");
    await ensureAllowance(s, CHAIN, USDC, FUSD, net);
    const before = await fusdOf(s.address);
    const expected = net * BigInt(10) ** BigInt(12);
    await sendEvm(s, CHAIN, { to: FUSD, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "deposit", args: [USDC, net, s.address, (expected * BigInt(995)) / BigInt(1000)] }) });
    const minted = (await fusdOf(s.address)) - before;
    if (minted <= ZERO) throw new ExecError("Frgmnt didn't mint any fUSD. Your USDC is in your wallet.");
    await ensureAllowance(s, CHAIN, FUSD, POOL, minted);
    await sendEvm(s, CHAIN, { to: POOL, data: encodeFunctionData({ abi: POOL_ABI, functionName: "stake", args: [minted, (minted * BigInt(995)) / BigInt(1000)] }) });
    on("deposit", "done");
    return `${Number(fmt(minted)).toLocaleString("en-US", { maximumFractionDigits: 4 })} sfUSD`;
  },

  withdraw: async (s, amount, on) => {
    on("withdraw", "running");
    const [shares, reward] = await Promise.all([sfusdOf(s.address), rewardOf(s.address).catch(() => ZERO)]);
    const all = amount === "max";
    const want = all ? shares : parseUnits(amount, 18);
    const unstake = want < shares ? want : shares;
    if (unstake > ZERO) await sendEvm(s, CHAIN, { to: POOL, data: encodeFunctionData({ abi: POOL_ABI, functionName: "unstake", args: [unstake] }) });
    on("withdraw", "done");

    const wait = await cooldownOf(s.address);
    const inWallet = await fusdOf(s.address);
    let cashed = ZERO;
    if (wait === ZERO && inWallet > DUST) {
      on("bridge", "running");
      cashed = await cashOut(s, inWallet);
      on("bridge", "done", `${fmt(cashed, 6)} USDC`);
    } else {
      on("bridge", "skipped");
    }
    // On a full exit, claim the yield last: claiming restarts Frgmnt's 24-hour window, so it comes home a day later.
    if (all && reward > DUST) await sendEvm(s, CHAIN, { to: POOL, data: encodeFunctionData({ abi: POOL_ABI, functionName: "harvest", args: [] }) }).catch(() => null);

    if (cashed === ZERO) {
      on("fee", "skipped");
      const left = await cooldownOf(s.address);
      return `${Number(fmt(await fusdOf(s.address))).toLocaleString("en-US", { maximumFractionDigits: 4 })} fUSD unstaked. Frgmnt releases it to USDC in ${waitText(left)}, and Pecun brings it to your wallet then.`;
    }
    const kept = await takeUsdgFee(s, cashed, on);
    return `${fmt(kept, USDG_DECIMALS)} USDC`;
  },

  queue: async (who) => {
    const [w, wait] = await Promise.all([fusdOf(who.address), cooldownOf(who.address)]);
    const n = w > DUST ? Number(fmt(w)) : 0;
    return { symbol: "fUSD", pending: wait > ZERO ? n : 0, arrived: wait > ZERO ? 0 : n, wait: wait > ZERO ? waitText(wait) : "" } satisfies QueueState;
  },

  bringHome: async (s, on) => {
    const [w, wait] = await Promise.all([fusdOf(s.address), cooldownOf(s.address)]);
    if (w <= DUST || wait > ZERO) return null;
    on("bridge", "running");
    const cashed = await cashOut(s, w);
    on("bridge", "done", `${fmt(cashed, 6)} USDC`);
    if (cashed === ZERO) return null;
    const kept = await takeUsdgFee(s, cashed, on);
    return `${fmt(kept, USDG_DECIMALS)} USDC`;
  },
};

registerAdapters((o) => (o.id === FRGMNT_FUSD_ID ? adapter : null));
