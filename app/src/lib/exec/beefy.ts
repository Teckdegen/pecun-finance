"use client";

import { encodeAbiParameters, encodeFunctionData, erc20Abi, formatUnits, parseAbi, parseAbiParameters, parseUnits, type Abi, type AbiFunction, type Address } from "viem";
import { chainIdByName } from "../exec-chains";
import { ROBINHOOD_CHAIN_ID, USDG, USDG_DECIMALS } from "../wallet";
import {
  ExecError,
  IN_STEPS,
  OUT_STEPS,
  USDC_ON,
  chainClient,
  erc20Balance,
  evmProtocols,
  evmVault,
  isAddr,
  isHomeUsdg,
  lazy,
  legSlippageBpsNow,
  netOfFee,
  planRoute,
  registerAdapters,
  routeCostPct,
  runRoute,
  sendEvm,
  takeUsdgFee,
  tokenMeta,
  usdgOf,
  waitForArrival,
  type Adapter,
  type Call,
  type Opp,
  type Preview,
  type Progress,
  type Proto,
  type Signer,
  type Step,
  type TokenMeta,
  type Who,
} from "../execute";

/**
 * Beefy (every active vault type Pecun can build in the browser) and Yearn's Curve-LP vaults.
 *
 * - Single-asset Beefy vaults: USDG → the vault's `want` through Relay, then approve + deposit (the shared evmVault).
 * - LP vaults: USDG → one token of the pool through Relay, then
 *     Curve: add_liquidity with that one coin (Beefy's own zap metadata says which method and coins), and back with
 *            remove_liquidity_one_coin;
 *     Beefy CLM (concentrated-liquidity manager) and Solidly / Uniswap-v2 pairs: swap the right share into the other
 *            token on the vault's chain (Relay), add both, and on the way out remove both and route each back.
 *   The LP token is then deposited into the Beefy (or Yearn) vault.
 * Beefy LP positions are shown in USD (Beefy's LP price), since LP-token units mean little to people.
 */

const BEEFY_API = "https://api.beefy.finance";
/** Add / remove liquidity slippage: the per-leg share of Pecun's route-cost budget. */
const lpSlipBps = () => BigInt(legSlippageBpsNow());
const BPS = BigInt(10_000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const E18 = BigInt(10) ** BigInt(18);
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const withSlippage = (x: bigint) => (x * (BPS - lpSlipBps())) / BPS;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/* ---------------- Beefy's public API ---------------- */

type CurveMethod = { type: string; target: Address; coins: Address[] };
type BeefyZap = { strategyId: string; ammId?: string; poolAddress?: Address; methods?: CurveMethod[] };
export type BeefyVault = {
  id: string;
  type?: string;
  status: string;
  token: string;
  tokenAddress?: Address;
  tokenDecimals: number;
  tokenProviderId?: string;
  earnContractAddress: Address;
  oracleId: string;
  assets?: string[];
  zaps?: BeefyZap[];
};

const vaultLists = new Map<string, Promise<Map<string, BeefyVault>>>();
const loaded = new Map<string, Map<string, BeefyVault>>();
function chainVaults(chainKey: string): Promise<Map<string, BeefyVault>> {
  let p = vaultLists.get(chainKey);
  if (!p) {
    p = fetch(`${BEEFY_API}/vaults/${chainKey}`)
      .then((r) => {
        if (!r.ok) throw new ExecError(`Beefy didn't answer (${r.status}).`);
        return r.json() as Promise<BeefyVault[]>;
      })
      .then((list) => {
        const m = new Map(list.map((v) => [v.id, v]));
        loaded.set(chainKey, m);
        return m;
      });
    p.catch(() => vaultLists.delete(chainKey));
    vaultLists.set(chainKey, p);
  }
  return p;
}
async function beefyVault(chainKey: string, id: string): Promise<BeefyVault> {
  const v = (await chainVaults(chainKey)).get(id);
  if (!v) throw new ExecError("This Beefy vault isn't listed by Beefy right now.");
  return v;
}

let lpPrices: { at: number; p: Promise<Record<string, number>> } | null = null;
async function lpPrice(oracleId: string): Promise<number> {
  if (!lpPrices || Date.now() - lpPrices.at > 5 * 60_000) {
    const p = fetch(`${BEEFY_API}/lps`).then((r) => r.json() as Promise<Record<string, number>>);
    p.catch(() => (lpPrices = null));
    lpPrices = { at: Date.now(), p };
  }
  const price = Number((await lpPrices.p)[oracleId]);
  if (!(price > 0)) throw new ExecError("Beefy has no price for this LP right now.");
  return price;
}

/** Solidly / Uniswap-v2 routers per Beefy AMM id (from Beefy's own zap config). */
type PairKind = "solidly" | "uniswap-v2" | "aero-v2";
const ROUTERS: Record<string, { router: Address; kind: PairKind }> = {
  "base-aero-v2": { router: "0x0fef9e88a7b76bcdbf451780c6774fe32965ee98", kind: "aero-v2" },
  "optimism-aero-v2": { router: "0x0fef9e88a7b76bcdbf451780c6774fe32965ee98", kind: "aero-v2" },
  "avax-blackhole": { router: "0xCaD684775d7879E63f5d319dAcC8086EeCC01B01", kind: "solidly" },
  "plasma-lithos": { router: "0xD70962bd7C6B3567a8c893b55a8aBC1E151759f3", kind: "solidly" },
  "robinhood-up33": { router: "0xf5198743240fAC98db71868F34c70139b1eb0474", kind: "solidly" },
  "bsc-ooe": { router: "0xBeB43fbb2f7AEA8AC904975816BB1b4cA9f4D9c5", kind: "uniswap-v2" },
};

const CURVE_TYPES = new Set(["fixed", "fixed-deposit-int128", "fixed-deposit-uint256", "fixed-deposit-underlying", "dynamic-deposit", "pool-fixed", "pool-fixed-deposit", "pool-dynamic-deposit"]);

type Kind = { t: "single" } | { t: "curve"; method: CurveMethod; pool?: Address } | { t: "clm" } | { t: "pair"; router: Address; kind: PairKind };

/** How Pecun builds this vault's `want`, or why it can't. */
export function classify(v: BeefyVault): Kind | string {
  if (v.type && v.type !== "standard") return `${v.type} vault`;
  if (!isAddr(v.tokenAddress) || !isAddr(v.earnContractAddress)) return "no want token";
  const zaps = v.zaps ?? [];
  const ids = zaps.map((z) => z.strategyId);
  if (ids.includes("single") || (!zaps.length && (v.assets?.length ?? 1) === 1 && !v.tokenProviderId)) return { t: "single" };
  const curve = zaps.find((z) => z.strategyId === "curve");
  if (curve) {
    const m = curve.methods?.find((x) => CURVE_TYPES.has(x.type) && isAddr(x.target) && x.coins?.some((c) => !same(c, NATIVE)));
    if (!m) return "Curve method Pecun can't call";
    if (m.type.startsWith("pool-") && !isAddr(curve.poolAddress)) return "Curve zap without a pool";
    return { t: "curve", method: m, pool: curve.poolAddress };
  }
  if (ids.includes("vault-composer")) return { t: "clm" };
  const amm = zaps.find((z) => (z.strategyId === "solidly" || z.strategyId === "uniswap-v2") && z.ammId);
  if (amm) {
    const r = ROUTERS[amm.ammId!];
    return r ? { t: "pair", ...r } : `no router for ${amm.ammId}`;
  }
  return ids.length ? `${ids.join("/")} zaps` : "no zap (Balancer and similar)";
}

/* ---------------- tokens and routes ---------------- */

const metas = new Map<string, () => Promise<TokenMeta>>();
function meta(chainId: number, token: Address): Promise<TokenMeta> {
  const k = `${chainId}:${token.toLowerCase()}`;
  let f = metas.get(k);
  if (!f) metas.set(k, (f = lazy(() => tokenMeta(chainId, token))));
  return f();
}

const STABLE = /^(USDC|USDC\.E|USDBC|USDT|USDT0|USD₮0|DAI|USDS|USDE|CRVUSD|FRXUSD|PYUSD|GHO|AUSD|USD0|LUSD|FRAX|USD1|RLUSD|USDG)$/i;
const MAJOR = /^(WETH|ETH|WBNB|WAVAX|WMON|WXPL|WBTC|CBBTC)$/i;

/** Orders a pool's tokens by how cheaply Relay reaches them: the user's own USDG, USDC, stables, majors, the rest. */
async function ranked(chainId: number, tokens: Address[]): Promise<Address[]> {
  const scored = await Promise.all(
    tokens
      .filter((t) => !same(t, NATIVE) && !same(t, "0x0000000000000000000000000000000000000000"))
      .map(async (t, i) => {
        const sym = (await meta(chainId, t).catch(() => null))?.symbol ?? "";
        const s = isHomeUsdg(chainId, t) ? 0 : USDC_ON[chainId] && same(USDC_ON[chainId], t) ? 1 : STABLE.test(sym) ? 2 : MAJOR.test(sym) ? 3 : 4;
        return { t, s: s * 10 + i };
      }),
  );
  return scored.sort((a, b) => a.s - b.s).map((x) => x.t);
}

type Quote = { out: bigint; min: bigint; preview: Preview };
const ratioMin = (p: Preview) => {
  const out = Number(p.out);
  return out > 0 ? Math.min(1, Number(p.minOut) / out) : 1;
};
const scaleBy = (x: bigint, r: number) => (x * BigInt(Math.floor(r * 1e6))) / BigInt(1e6);
const free = (amount: bigint, decimals: number, symbol: string): Quote => {
  const f = formatUnits(amount, decimals);
  return { out: amount, min: amount, preview: { out: f, outSymbol: symbol, minOut: f, slippagePct: 0, impactPct: 0, feesUsd: 0, seconds: 0 } };
};

/** USDG on Robinhood → `token` on the vault's chain. */
async function quoteIn(who: Who, chainId: number, token: Address, amount: bigint): Promise<Quote> {
  if (isHomeUsdg(chainId, token)) return free(amount, USDG_DECIMALS, "USDG");
  const m = await meta(chainId, token);
  const p = await planRoute({ from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount, user: who.address, recipient: who.address }, m.symbol);
  return { out: p.out, min: scaleBy(p.out, ratioMin(p.preview)), preview: p.preview };
}

/** `token` on the vault's chain → USDG on Robinhood. */
async function quoteOut(who: Who, chainId: number, token: Address, amount: bigint): Promise<Quote> {
  if (isHomeUsdg(chainId, token)) return free(amount, USDG_DECIMALS, "USDG");
  const p = await planRoute({ from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: token, outToken: USDG, amount, user: who.address, recipient: who.address }, "USDG");
  return { out: p.out, min: scaleBy(p.out, ratioMin(p.preview)), preview: p.preview };
}

/** A swap on the vault's own chain. */
async function quoteSwap(who: Who, chainId: number, from: Address, to: Address, amount: bigint): Promise<Quote> {
  const m = await meta(chainId, to);
  const p = await planRoute({ from: chainId, to: chainId, inToken: from, outToken: to, amount, user: who.address, recipient: who.address }, m.symbol);
  return { out: p.out, min: scaleBy(p.out, ratioMin(p.preview)), preview: p.preview };
}

/** The first token (best first) Relay can route to; with its quote. */
async function pickRoute(tokens: Address[], quote: (t: Address) => Promise<Quote>): Promise<{ token: Address; q: Quote }> {
  let last: unknown;
  for (const t of tokens.slice(0, 3)) {
    try {
      return { token: t, q: await quote(t) };
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new ExecError("No route into this pool right now.");
}

const bal = (chainId: number, token: Address, owner: Address) => erc20Balance(chainId, token, owner);

/** Runs USDG → `token`; returns how much arrived. */
async function bridgeIn(s: Signer, chainId: number, token: Address, amount: bigint): Promise<bigint> {
  if (isHomeUsdg(chainId, token)) return amount;
  const read = () => bal(chainId, token, s.address);
  const before = await read();
  await runRoute(s, { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount, user: s.address, recipient: s.address });
  return waitForArrival(read, before, 10 * 60_000);
}

async function swapOnChain(s: Signer, chainId: number, from: Address, to: Address, amount: bigint): Promise<bigint> {
  const read = () => bal(chainId, to, s.address);
  const before = await read();
  await runRoute(s, { from: chainId, to: chainId, inToken: from, outToken: to, amount, user: s.address, recipient: s.address });
  return waitForArrival(read, before, 5 * 60_000);
}

/** Approves exactly `amount` (resetting a smaller allowance to zero first, for USDT-style tokens). */
async function approve(s: Signer, chainId: number, token: Address, spender: Address, amount: bigint) {
  const allowance = await chainClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [s.address, spender] });
  if (allowance >= amount) return;
  if (allowance > ZERO) await sendEvm(s, chainId, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, ZERO] }) });
  await sendEvm(s, chainId, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) });
}

/** Sends a call and returns how much each of `tokens` rose by. */
async function gained(s: Signer, chainId: number, tokens: Address[], call: Call): Promise<bigint[]> {
  const before = await Promise.all(tokens.map((t) => bal(chainId, t, s.address)));
  await sendEvm(s, chainId, call);
  const after = await Promise.all(tokens.map((t) => bal(chainId, t, s.address)));
  return after.map((a, i) => (a > before[i] ? a - before[i] : ZERO));
}

/* ---------------- Beefy vault (the moo token) ---------------- */

const BEEFY_VAULT_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function getPricePerFullShare() view returns (uint256)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 shares)",
]);

/** A Beefy vault as a Proto: amounts are in `want` units (shares × pricePerFullShare / 1e18). */
function beefyHolder(chainId: number, vault: () => Promise<BeefyVault>): Proto {
  const c = () => chainClient(chainId);
  const addr = async () => (await vault()).earnContractAddress;
  const shares = async (owner: Address) => c().readContract({ address: await addr(), abi: BEEFY_VAULT_ABI, functionName: "balanceOf", args: [owner] });
  const ppfs = async () => c().readContract({ address: await addr(), abi: BEEFY_VAULT_ABI, functionName: "getPricePerFullShare" });
  return {
    asset: async () => {
      const v = await vault();
      return { address: v.tokenAddress!, decimals: v.tokenDecimals, symbol: v.token };
    },
    position: async (owner) => {
      const sh = await shares(owner);
      return sh > ZERO ? (sh * (await ppfs())) / E18 : ZERO;
    },
    spender: addr,
    deposit: async (_owner, amount) => ({ to: await addr(), data: encodeFunctionData({ abi: BEEFY_VAULT_ABI, functionName: "deposit", args: [amount] }) }),
    withdraw: async (owner, amount) => {
      const [sh, p] = await Promise.all([shares(owner), ppfs()]);
      const want = amount === "max" ? sh : (amount * E18 + p - ONE) / p; // shares for `amount`, rounded up
      return { to: await addr(), data: encodeFunctionData({ abi: BEEFY_VAULT_ABI, functionName: "withdraw", args: [want < sh ? want : sh] }) };
    },
  };
}

/* ---------------- LP builders: turn one token into the LP and back ---------------- */

type Out = { token: Address; amount: bigint }[];
type Lp = {
  want: Address;
  /** Tokens the route may end in, best first. */
  entries: Address[];
  /** Expected LP for `amount` of `entry`, plus the on-chain swap's quote when one is needed. */
  previewAdd: (who: Who, entry: Address, amount: bigint) => Promise<{ want: bigint; swap?: Quote }>;
  add: (s: Signer, entry: Address, amount: bigint) => Promise<bigint>;
  /** What removing `want` LP pays out (ending in `exit` where the pool lets us choose). */
  previewRemove: (want: bigint, exit: Address) => Promise<Out>;
  remove: (s: Signer, want: bigint, exit: Address) => Promise<Out>;
  /** True when removal pays a single chosen token (Curve), false when it pays every token (pairs, CLMs). */
  oneCoinOut: boolean;
};

/* Curve: add / remove one coin, with the method shape Beefy's zap metadata names. */

const u256 = { type: "uint256" } as const;
function curveAbi(type: string, n: number): { calc: AbiFunction; add: AbiFunction; calcOut: AbiFunction; remove: AbiFunction } {
  const pool = type.startsWith("pool-");
  const amounts = { name: "amounts", type: type.includes("dynamic") ? "uint256[]" : `uint256[${n}]` };
  const index = { name: "i", type: type === "fixed" || type === "pool-fixed" || type === "fixed-deposit-uint256" ? "uint256" : "int128" };
  const isDeposit = type !== "fixed" && type !== "pool-fixed" ? [{ name: "is_deposit", type: "bool" }] : [];
  const underlying = type === "fixed-deposit-underlying" ? [{ name: "use_underlying", type: "bool" }] : [];
  const p = pool ? [{ name: "pool", type: "address" }] : [];
  const fn = (name: string, inputs: { name: string; type: string }[], view: boolean): AbiFunction => ({
    type: "function",
    name,
    inputs,
    outputs: view ? [{ name: "", ...u256 }] : [],
    stateMutability: view ? "view" : "nonpayable",
  });
  return {
    calc: fn("calc_token_amount", [...p, amounts, ...isDeposit], true),
    add: fn("add_liquidity", [...p, amounts, { name: "min_mint_amount", type: "uint256" }, ...underlying], false),
    calcOut: fn("calc_withdraw_one_coin", [...p, { name: "token_amount", type: "uint256" }, index], true),
    remove: fn("remove_liquidity_one_coin", [...p, { name: "token_amount", type: "uint256" }, index, { name: "min_amount", type: "uint256" }, ...underlying], false),
  };
}

/** Quotes and call data for one-coin add / remove on a Curve pool (or its deposit zap). */
function curveCalls(chainId: number, m: CurveMethod, poolArg?: Address) {
  const abi = curveAbi(m.type, m.coins.length);
  const pre = m.type.startsWith("pool-") ? [poolArg!] : [];
  const flags = (deposit: boolean) => (m.type === "fixed" || m.type === "pool-fixed" ? [] : [deposit]);
  const under = m.type === "fixed-deposit-underlying" ? [true] : [];
  const idx = (coin: Address) => {
    const i = m.coins.findIndex((x) => same(x, coin));
    if (i < 0) throw new ExecError("That coin isn't in this pool.");
    return i;
  };
  const amounts = (i: number, amount: bigint) => m.coins.map((_, j) => (j === i ? amount : ZERO));
  const read = (fn: AbiFunction, args: unknown[]) => chainClient(chainId).readContract({ address: m.target, abi: [fn] as Abi, functionName: fn.name, args }) as Promise<bigint>;
  return {
    lpFor: (coin: Address, amount: bigint) => read(abi.calc, [...pre, amounts(idx(coin), amount), ...flags(true)]),
    outFor: (want: bigint, coin: Address) => read(abi.calcOut, [...pre, want, BigInt(idx(coin))]),
    addData: (coin: Address, amount: bigint, min: bigint) => encodeFunctionData({ abi: [abi.add] as Abi, functionName: "add_liquidity", args: [...pre, amounts(idx(coin), amount), min, ...under] }),
    removeData: (want: bigint, coin: Address, min: bigint) => encodeFunctionData({ abi: [abi.remove] as Abi, functionName: "remove_liquidity_one_coin", args: [...pre, want, BigInt(idx(coin)), min, ...under] }),
  };
}

async function curveLp(chainId: number, want: Address, m: CurveMethod, poolArg?: Address): Promise<Lp> {
  const { lpFor, outFor, addData, removeData } = curveCalls(chainId, m, poolArg);
  return {
    want,
    entries: await ranked(chainId, m.coins),
    oneCoinOut: true,
    previewAdd: async (_who, entry, amount) => ({ want: await lpFor(entry, amount) }),
    add: async (s, entry, amount) => {
      const min = withSlippage(await lpFor(entry, amount));
      await approve(s, chainId, entry, m.target, amount);
      const data = addData(entry, amount, min);
      const [got] = await gained(s, chainId, [want], { to: m.target, data });
      if (got <= ZERO) throw new ExecError("The pool didn't mint any LP. Your funds are still in your wallet.");
      return got;
    },
    previewRemove: async (w, exit) => [{ token: exit, amount: await outFor(w, exit) }],
    remove: async (s, w, exit) => {
      const min = withSlippage(await outFor(w, exit));
      if (!same(m.target, want)) await approve(s, chainId, want, m.target, w); // deposit zaps pull the LP; plain pools burn it
      const data = removeData(w, exit, min);
      const [got] = await gained(s, chainId, [exit], { to: m.target, data });
      if (got <= ZERO) throw new ExecError("The pool didn't pay out. Your LP is in your wallet.");
      return [{ token: exit, amount: got }];
    },
  };
}

/** Works out a Curve pool's method shape on-chain (for vaults with no Beefy metadata, like Yearn's). */
/** Curve's MetaRegistry: finds the pool behind an LP token for older pools whose LP is a separate contract. */
const CURVE_META_REGISTRY: Record<number, Address> = { 1: "0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC" };

/** Works out a Curve pool's method shape on-chain (for vaults with no Beefy metadata, like Yearn's), from its LP. */
async function detectCurve(chainId: number, lp: Address): Promise<CurveMethod> {
  const c = chainClient(chainId);
  const coinsAbi = parseAbi(["function coins(uint256) view returns (address)", "function get_pool_from_lp_token(address) view returns (address)"]);
  // Factory pools are their own LP token; older ones are looked up in Curve's registry.
  let pool = lp;
  if (!(await c.readContract({ address: lp, abi: coinsAbi, functionName: "coins", args: [BigInt(0)] }).then(() => true, () => false)) && CURVE_META_REGISTRY[chainId]) {
    const p = await c.readContract({ address: CURVE_META_REGISTRY[chainId], abi: coinsAbi, functionName: "get_pool_from_lp_token", args: [lp] }).catch(() => null);
    if (p && !same(p, "0x0000000000000000000000000000000000000000")) pool = p;
  }
  const coins: Address[] = [];
  for (let i = 0; i < 8; i++) {
    const t = await c.readContract({ address: pool, abi: coinsAbi, functionName: "coins", args: [BigInt(i)] }).catch(() => null);
    if (!t) break;
    coins.push(t);
  }
  if (coins.length < 2) throw new ExecError("This Curve pool isn't one Pecun can add to.");
  const probe = E18 / BigInt(1000);
  for (const type of ["dynamic-deposit", "fixed-deposit-uint256", "fixed-deposit-int128", "fixed"]) {
    const abi = curveAbi(type, coins.length);
    const amounts = coins.map((_, j) => (j === 0 ? probe : ZERO));
    const ok = await Promise.all([
      c.readContract({ address: pool, abi: [abi.calc] as Abi, functionName: abi.calc.name, args: type === "fixed" ? [amounts] : [amounts, true] }).then(() => true, () => false),
      c.readContract({ address: pool, abi: [abi.calcOut] as Abi, functionName: abi.calcOut.name, args: [probe, BigInt(0)] }).then(() => true, () => false),
    ]);
    if (ok[0] && ok[1]) return { type, target: pool, coins };
  }
  throw new ExecError("This Curve pool isn't one Pecun can add to.");
}

/* Two-token pools (Beefy CLMs, Solidly and Uniswap-v2 pairs): swap the right share, add both, remove both. */

type Pair = {
  tokens: [Address, Address];
  /** The token mix a deposit must match. `hint` is a deposit-sized amount of each token (CLMs take a different mix
   *  depending on size, so `sized` pairs need it). */
  ratio: (hint?: [bigint, bigint]) => Promise<[bigint, bigint]>;
  sized?: boolean;
  quoteAdd: (a: [bigint, bigint]) => Promise<bigint>;
  addCall: (owner: Address, a: [bigint, bigint]) => Promise<{ spender: Address; call: Call }>;
  quoteRemove: (want: bigint) => Promise<[bigint, bigint]>;
  removeCall: (owner: Address, want: bigint) => Promise<{ spender?: Address; call: Call }>;
};

/** How much of `amount` (of token e) to swap into the other token so the two match the pool's ratio. */
function splitFor(amount: bigint, e: number, r: [bigint, bigint], probeIn: bigint, probeOut: bigint): bigint {
  const rE = r[e];
  const rO = r[1 - e];
  if (rO === ZERO) return ZERO;
  if (rE === ZERO || probeIn === ZERO) return amount;
  // (amount - x) / rE = x·rate / rO, with rate = probeOut / probeIn
  return (amount * rO * probeIn) / (rO * probeIn + probeOut * rE);
}

async function pairLp(chainId: number, want: Address, pair: Pair): Promise<Lp> {
  const [t0, t1] = pair.tokens;
  const plan = async (who: Who, entry: Address, amount: bigint) => {
    const e = same(entry, t0) ? 0 : 1;
    const other = e === 0 ? t1 : t0;
    let r = pair.sized ? null : await pair.ratio();
    if (r && r[1 - e] === ZERO) return { e, other, x: ZERO };
    const half = amount / BigInt(2);
    const swap = await quoteSwap(who, chainId, entry, other, half);
    if (!r) {
      const otherFull = half > ZERO ? (swap.out * amount) / half : ZERO;
      r = await pair.ratio(e === 0 ? [amount, otherFull] : [otherFull, amount]);
    }
    const x = splitFor(amount, e, r, half, swap.out);
    return { e, other, x, swap: x > ZERO ? swap : undefined };
  };
  const amountsOf = (e: number, keep: bigint, got: bigint): [bigint, bigint] => (e === 0 ? [keep, got] : [got, keep]);
  return {
    want,
    entries: await ranked(chainId, [t0, t1]),
    oneCoinOut: false,
    previewAdd: async (who, entry, amount) => {
      const { e, x, swap } = await plan(who, entry, amount);
      const y = swap && x > ZERO ? (swap.out * x) / (amount / BigInt(2) || ONE) : ZERO;
      return { want: await pair.quoteAdd(amountsOf(e, amount - x, y)), swap };
    },
    add: async (s, entry, amount) => {
      const { e, other, x } = await plan(s, entry, amount);
      const y = x > ZERO ? await swapOnChain(s, chainId, entry, other, x) : ZERO;
      const a = amountsOf(e, amount - x, y);
      const { spender, call } = await pair.addCall(s.address, a);
      if (a[0] > ZERO) await approve(s, chainId, t0, spender, a[0]);
      if (a[1] > ZERO) await approve(s, chainId, t1, spender, a[1]);
      const [got] = await gained(s, chainId, [want], call);
      if (got <= ZERO) throw new ExecError("The pool didn't mint any LP. Your funds are still in your wallet.");
      return got;
    },
    previewRemove: async (w) => {
      const [a0, a1] = await pair.quoteRemove(w);
      return [
        { token: t0, amount: a0 },
        { token: t1, amount: a1 },
      ];
    },
    remove: async (s, w) => {
      const { spender, call } = await pair.removeCall(s.address, w);
      if (spender) await approve(s, chainId, want, spender, w);
      const [a0, a1] = await gained(s, chainId, [t0, t1], call);
      if (a0 + a1 <= ZERO) throw new ExecError("The pool didn't pay out. Your LP is in your wallet.");
      return [
        { token: t0, amount: a0 },
        { token: t1, amount: a1 },
      ];
    },
  };
}

const CLM_ABI = parseAbi([
  "function wants() view returns (address token0, address token1)",
  "function balances() view returns (uint256 amount0, uint256 amount1)",
  "function previewDeposit(uint256 _amount0, uint256 _amount1) view returns (uint256 shares, uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1)",
  "function previewWithdraw(uint256 _shares) view returns (uint256 amount0, uint256 amount1)",
  "function deposit(uint256 _amount0, uint256 _amount1, uint256 _minShares)",
  "function withdraw(uint256 _shares, uint256 _minAmount0, uint256 _minAmount1)",
]);

/** A Beefy CLM (cowcentrated liquidity manager): its own token is the LP. */
async function clmPair(chainId: number, clm: Address): Promise<Pair> {
  const c = () => chainClient(chainId);
  const [t0, t1] = await c().readContract({ address: clm, abi: CLM_ABI, functionName: "wants" });
  const preview = (a: [bigint, bigint]) => c().readContract({ address: clm, abi: CLM_ABI, functionName: "previewDeposit", args: a });
  const out = (w: bigint) => c().readContract({ address: clm, abi: CLM_ABI, functionName: "previewWithdraw", args: [w] });
  return {
    tokens: [t0, t1],
    // The mix the CLM takes for a deposit this size: what previewDeposit would use. (It depends on size, and a CLM whose
    // main position is out of range takes only one token whatever its balances say.)
    sized: true,
    ratio: async (hint) => {
      const a = hint ?? (await c().readContract({ address: clm, abi: CLM_ABI, functionName: "balances" }));
      if (a[0] === ZERO && a[1] === ZERO) return [a[0], a[1]];
      const [, u0, u1] = await preview([a[0], a[1]]);
      return [u0, u1];
    },
    quoteAdd: async (a) => (await preview(a))[0],
    addCall: async (_owner, a) => {
      const [shares] = await preview(a);
      if (shares === ZERO) throw new ExecError("The pool can't take this deposit right now.");
      return { spender: clm, call: { to: clm, data: encodeFunctionData({ abi: CLM_ABI, functionName: "deposit", args: [a[0], a[1], withSlippage(shares)] }) } };
    },
    quoteRemove: async (w) => [...(await out(w))] as [bigint, bigint],
    removeCall: async (_owner, w) => {
      const [a0, a1] = await out(w);
      return { call: { to: clm, data: encodeFunctionData({ abi: CLM_ABI, functionName: "withdraw", args: [w, withSlippage(a0), withSlippage(a1)] }) } };
    },
  };
}

const PAIR_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
  "function totalSupply() view returns (uint256)",
  "function stable() view returns (bool)",
  "function metadata() view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, bool st, address t0, address t1)",
]);
const SOLIDLY_ROUTER_ABI = parseAbi([
  "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256, uint256)",
  "function removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256)",
]);
const V2_ROUTER_ABI = parseAbi([
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256, uint256)",
  "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256)",
]);

/** A Solidly-style (Aerodrome, Velodrome, Blackhole, Lithos, Up33) or Uniswap-v2 pair, through its router. */
async function routerPair(chainId: number, lp: Address, router: Address, kind: "solidly" | "uniswap-v2"): Promise<Pair> {
  const c = () => chainClient(chainId);
  const [t0, t1, stable] = await Promise.all([
    c().readContract({ address: lp, abi: PAIR_ABI, functionName: "token0" }),
    c().readContract({ address: lp, abi: PAIR_ABI, functionName: "token1" }),
    kind === "solidly"
      ? c()
          .readContract({ address: lp, abi: PAIR_ABI, functionName: "metadata" })
          .then((m) => m[4])
          .catch(() => c().readContract({ address: lp, abi: PAIR_ABI, functionName: "stable" }))
      : Promise.resolve(false),
  ]);
  const reserves = async (): Promise<[bigint, bigint]> => {
    const r = await c().readContract({ address: lp, abi: PAIR_ABI, functionName: "getReserves" });
    return [r[0], r[1]];
  };
  const supply = () => c().readContract({ address: lp, abi: PAIR_ABI, functionName: "totalSupply" });
  /** The amounts the router will actually take (it matches the reserve ratio). */
  const used = (a: [bigint, bigint], r: [bigint, bigint]): [bigint, bigint] => {
    if (r[0] === ZERO || r[1] === ZERO) return a;
    const b1 = (a[0] * r[1]) / r[0];
    return b1 <= a[1] ? [a[0], b1] : [(a[1] * r[0]) / r[1], a[1]];
  };
  const out = async (w: bigint): Promise<[bigint, bigint]> => {
    const [r, ts] = await Promise.all([reserves(), supply()]);
    return ts === ZERO ? [ZERO, ZERO] : [(w * r[0]) / ts, (w * r[1]) / ts];
  };
  return {
    tokens: [t0, t1],
    ratio: reserves,
    quoteAdd: async (a) => {
      const [r, ts] = await Promise.all([reserves(), supply()]);
      if (r[0] === ZERO || r[1] === ZERO || ts === ZERO) return ZERO;
      const l0 = (a[0] * ts) / r[0];
      const l1 = (a[1] * ts) / r[1];
      return l0 < l1 ? l0 : l1;
    },
    addCall: async (owner, a) => {
      const u = used(a, await reserves());
      const m0 = withSlippage(u[0]);
      const m1 = withSlippage(u[1]);
      const data =
        kind === "solidly"
          ? encodeFunctionData({ abi: SOLIDLY_ROUTER_ABI, functionName: "addLiquidity", args: [t0, t1, stable, a[0], a[1], m0, m1, owner, deadline()] })
          : encodeFunctionData({ abi: V2_ROUTER_ABI, functionName: "addLiquidity", args: [t0, t1, a[0], a[1], m0, m1, owner, deadline()] });
      return { spender: router, call: { to: router, data } };
    },
    quoteRemove: out,
    removeCall: async (owner, w) => {
      const [a0, a1] = await out(w);
      const data =
        kind === "solidly"
          ? encodeFunctionData({ abi: SOLIDLY_ROUTER_ABI, functionName: "removeLiquidity", args: [t0, t1, stable, w, withSlippage(a0), withSlippage(a1), owner, deadline()] })
          : encodeFunctionData({ abi: V2_ROUTER_ABI, functionName: "removeLiquidity", args: [t0, t1, w, withSlippage(a0), withSlippage(a1), owner, deadline()] });
      return { spender: router, call: { to: router, data } };
    },
  };
}

/* Aero V2 (Superchain Aerodrome) pools: no classic router; liquidity goes through the Metarouter's execute(). */

const AERO_POOL_ABI = parseAbi([
  "function metadata() view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, address t0, address t1)",
  "function factory() view returns (address)",
  "function totalSupply() view returns (uint256)",
]);
const METAROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const AERO_ADD = parseAbiParameters(
  "(address factory, address tokenA, address tokenB, bool createPool, (uint8 mode, uint256 value) spendA, (uint8 mode, uint256 value) spendB, bool payerAIsUser, bool payerBIsUser, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 liquidityMin)",
);
const AERO_REMOVE = parseAbiParameters("(address pool, (uint8 mode, uint256 value) lpSpend, bool payerIsUser, uint256 amount0Min, uint256 amount1Min, address recipient)");

async function aeroV2Pair(chainId: number, lp: Address, router: Address): Promise<Pair> {
  const c = () => chainClient(chainId);
  const md = () => c().readContract({ address: lp, abi: AERO_POOL_ABI, functionName: "metadata" });
  const [m, factory] = await Promise.all([md(), c().readContract({ address: lp, abi: AERO_POOL_ABI, functionName: "factory" })]);
  const [t0, t1] = [m[4], m[5]];
  const state = async () => {
    const [x, ts] = await Promise.all([md(), c().readContract({ address: lp, abi: AERO_POOL_ABI, functionName: "totalSupply" })]);
    return { r: [x[2], x[3]] as [bigint, bigint], ts };
  };
  const minted = (a: [bigint, bigint], r: [bigint, bigint], ts: bigint) => {
    if (r[0] === ZERO || r[1] === ZERO || ts === ZERO) return ZERO;
    const l0 = (a[0] * ts) / r[0];
    const l1 = (a[1] * ts) / r[1];
    return l0 < l1 ? l0 : l1;
  };
  const out = async (w: bigint): Promise<[bigint, bigint]> => {
    const { r, ts } = await state();
    return ts === ZERO ? [ZERO, ZERO] : [(w * r[0]) / ts, (w * r[1]) / ts];
  };
  return {
    tokens: [t0, t1],
    ratio: async () => (await state()).r,
    quoteAdd: async (a) => {
      const { r, ts } = await state();
      return minted(a, r, ts);
    },
    addCall: async (owner, a) => {
      const { r, ts } = await state();
      // Spend exactly the reserve-matched amounts; the rest stays in the wallet.
      const b1 = r[0] > ZERO ? (a[0] * r[1]) / r[0] : a[1];
      const u: [bigint, bigint] = b1 <= a[1] ? [a[0], b1] : [(a[1] * r[0]) / r[1], a[1]];
      const input = encodeAbiParameters(AERO_ADD, [
        {
          factory,
          tokenA: t0,
          tokenB: t1,
          createPool: false,
          spendA: { mode: 0, value: u[0] },
          spendB: { mode: 0, value: u[1] },
          payerAIsUser: true,
          payerBIsUser: true,
          amountAMin: withSlippage(u[0]),
          amountBMin: withSlippage(u[1]),
          recipient: owner,
          liquidityMin: withSlippage(minted(u, r, ts)),
        },
      ]);
      return { spender: router, call: { to: router, data: encodeFunctionData({ abi: METAROUTER_ABI, functionName: "execute", args: ["0x22", [input], deadline()] }) } };
    },
    quoteRemove: out,
    removeCall: async (owner, w) => {
      const [a0, a1] = await out(w);
      const input = encodeAbiParameters(AERO_REMOVE, [{ pool: lp, lpSpend: { mode: 0, value: w }, payerIsUser: true, amount0Min: withSlippage(a0), amount1Min: withSlippage(a1), recipient: owner }]);
      return { spender: router, call: { to: router, data: encodeFunctionData({ abi: METAROUTER_ABI, functionName: "execute", args: ["0x23", [input], deadline()] }) } };
    },
  };
}

/* ---------------- the LP adapter: route → LP → vault, and back ---------------- */

const LP_IN: Step[] = [IN_STEPS[0], IN_STEPS[1], { id: "lp", label: "Add liquidity" }, IN_STEPS[2]];
const LP_OUT: Step[] = [OUT_STEPS[0], { id: "lp", label: "Remove liquidity" }, OUT_STEPS[1], OUT_STEPS[2]];

type Valuer = {
  symbol: string;
  /** Position units per LP unit (Beefy: USD per LP; Yearn: 1, shown in LP units). */
  perLp: () => Promise<number>;
};

function sumPreviews(parts: Quote[], out: string, outSymbol: string, minOut: string, impactPct: number): Preview {
  return {
    out,
    outSymbol,
    minOut,
    slippagePct: parts.reduce((m, p) => Math.max(m, p.preview.slippagePct), 0),
    impactPct,
    feesUsd: parts.reduce((t, p) => t + p.preview.feesUsd, 0),
    seconds: parts.reduce((t, p) => t + p.preview.seconds, 0),
  };
}

/**
 * Route cost and leg count for the 0.5% guard. USD-valued (Beefy) previews compare dollars in vs dollars out, which
 * covers the LP step too; otherwise the bridge/swap legs' own costs add up. The LP add/remove counts as one more leg.
 */
function withCost(p: Preview, parts: Quote[], usdValued: boolean) {
  p.costPct = usdValued ? Math.max(0, -p.impactPct) : parts.reduce((t, x) => t + routeCostPct(x.preview), 0);
  p.legs = parts.reduce((t, x) => t + (x.preview.legs ?? 1), 0) + 1;
}

const fmt = (x: number) => (x >= 1 ? x.toFixed(4) : x.toPrecision(6)).replace(/\.?0+$/, "");

export function lpVault(chainId: number, holder: Proto, lp: () => Promise<Lp>, value: Valuer): Adapter {
  const wantMeta = lazy(holder.asset);
  const display = async (raw: bigint) => Number(formatUnits(raw, (await wantMeta()).decimals)) * (await value.perLp());
  /** Position units ("12.5" USD) → LP raw, capped at what the user holds. */
  const toWant = async (amount: string, held: bigint) => {
    const [m, per] = await Promise.all([wantMeta(), value.perLp()]);
    const lpUnits = Number(amount) / per;
    const raw = parseUnits(lpUnits.toFixed(m.decimals), m.decimals);
    return held > ZERO && raw > held ? held : raw;
  };
  const exitFor = async (who: Who, L: Lp, w: bigint) =>
    pickRoute(L.entries, async (t) => {
      const [o] = await L.previewRemove(w, t);
      return quoteOut(who, chainId, t, o.amount);
    });

  /** Routes every non-dust token back to USDG; returns the USDG that arrived and what stayed behind. */
  const allBack = async (s: Signer, outs: Out, on: Progress) => {
    on("bridge", "running");
    let total = ZERO;
    const left: string[] = [];
    for (const o of outs) {
      if (o.amount <= ZERO) continue;
      if (isHomeUsdg(chainId, o.token)) {
        total += o.amount;
        continue;
      }
      try {
        const before = await usdgOf(s)();
        await runRoute(s, { from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: o.token, outToken: USDG, amount: o.amount, user: s.address, recipient: s.address });
        total += await waitForArrival(usdgOf(s), before, 10 * 60_000);
      } catch (e) {
        if (!total && outs.filter((x) => x.amount > ZERO).length === 1) throw e;
        const m = await meta(chainId, o.token).catch(() => ({ decimals: 18, symbol: "tokens" }));
        left.push(`${formatUnits(o.amount, m.decimals)} ${m.symbol}`);
      }
    }
    if (total <= ZERO) throw new ExecError("Nothing came back yet. Your tokens are in your wallet on the vault's chain.");
    on("bridge", "done", `${formatUnits(total, USDG_DECIMALS)} USDG`);
    return { total, left };
  };

  return {
    positionSymbol: value.symbol,
    depositSteps: LP_IN,
    withdrawSteps: LP_OUT,

    position: async (s) => display(await holder.position(s.address)),

    previewDeposit: async (s, usdg) => {
      const L = await lp();
      const net = netOfFee(usdg);
      const { token, q } = await pickRoute(L.entries, (t) => quoteIn(s, chainId, t, net));
      const add = await L.previewAdd(s, token, q.out);
      const v = await display(add.want);
      const parts = add.swap ? [q, add.swap] : [q];
      const minRatio = ratioMin(q.preview) * (add.swap ? ratioMin(add.swap.preview) : 1) * (1 - Number(lpSlipBps()) / 1e4);
      const netUsd = Number(formatUnits(net, USDG_DECIMALS));
      const p = sumPreviews(parts, fmt(v), value.symbol, fmt(v * minRatio), value.symbol === "USD" && netUsd > 0 ? (v / netUsd - 1) * 100 : parts.reduce((t, x) => t + x.preview.impactPct, 0));
      p.slippagePct = parts.reduce((t, x) => t + x.preview.slippagePct, 0) + Number(lpSlipBps()) / 100;
      withCost(p, parts, value.symbol === "USD");
      return p;
    },

    previewWithdraw: async (s, amount) => {
      const L = await lp();
      const w = await toWant(amount, await holder.position(s.address).catch(() => ZERO));
      let quotes: Quote[];
      if (L.oneCoinOut) quotes = [(await exitFor(s, L, w)).q];
      else quotes = await Promise.all((await L.previewRemove(w, L.entries[0])).filter((o) => o.amount > ZERO).map((o) => quoteOut(s, chainId, o.token, o.amount)));
      if (!quotes.length) throw new ExecError("That amount is too small to withdraw.");
      const out = quotes.reduce((t, q) => t + q.out, ZERO);
      const min = quotes.reduce((t, q) => t + q.min, ZERO);
      const outN = Number(formatUnits(out, USDG_DECIMALS));
      const inN = Number(amount);
      const p = sumPreviews(quotes, formatUnits(out, USDG_DECIMALS), "USDG", formatUnits(withSlippage(min), USDG_DECIMALS), value.symbol === "USD" && inN > 0 ? (outN / inN - 1) * 100 : quotes.reduce((t, q) => t + q.preview.impactPct, 0));
      p.slippagePct += Number(lpSlipBps()) / 100;
      withCost(p, quotes, value.symbol === "USD");
      return p;
    },

    deposit: async (s, usdg, on) => {
      const L = await lp();
      const w = await wantMeta();
      const { token } = await pickRoute(L.entries, (t) => quoteIn(s, chainId, t, netOfFee(usdg)));
      const tm = isHomeUsdg(chainId, token) ? { decimals: USDG_DECIMALS, symbol: "USDG" } : await meta(chainId, token);
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      if (isHomeUsdg(chainId, token)) on("bridge", "skipped");
      else on("bridge", "running");
      const got = await bridgeIn(s, chainId, token, net);
      if (!isHomeUsdg(chainId, token)) on("bridge", "done", `${formatUnits(got, tm.decimals)} ${tm.symbol}`);

      on("lp", "running");
      const lpGot = await L.add(s, token, got);
      on("lp", "done", `${fmt(await display(lpGot))} ${value.symbol}`);

      on("deposit", "running");
      const spender = await holder.spender();
      await approve(s, chainId, w.address, spender, lpGot);
      const before = await holder.position(s.address);
      await sendEvm(s, chainId, await holder.deposit(s.address, lpGot));
      if ((await holder.position(s.address)) <= before) throw new ExecError("The vault didn't accept the deposit. Your LP tokens are in your wallet.");
      on("deposit", "done");
      return `${fmt(await display(lpGot))} ${value.symbol}`;
    },

    withdraw: async (s, amount, on) => {
      const L = await lp();
      const w = await wantMeta();
      on("withdraw", "running");
      const held = await holder.position(s.address);
      if (held === ZERO) throw new ExecError("You don't have a position in this vault.");
      const take = amount === "max" ? "max" : await toWant(amount, held);
      const [lpOut] = await gained(s, chainId, [w.address], await holder.withdraw(s.address, take));
      if (lpOut <= ZERO) throw new ExecError("The vault didn't release any funds.");
      on("withdraw", "done", `${fmt(await display(lpOut))} ${value.symbol}`);

      on("lp", "running");
      const exit = L.oneCoinOut ? (await exitFor(s, L, lpOut)).token : L.entries[0];
      const outs = await L.remove(s, lpOut, exit);
      const shown = await Promise.all(outs.filter((o) => o.amount > ZERO).map(async (o) => {
        const m = isHomeUsdg(chainId, o.token) ? { decimals: USDG_DECIMALS, symbol: "USDG" } : await meta(chainId, o.token);
        return `${formatUnits(o.amount, m.decimals)} ${m.symbol}`;
      }));
      on("lp", "done", shown.join(" + "));

      const { total, left } = await allBack(s, outs, on);
      const kept = await takeUsdgFee(s, total, on);
      return `${formatUnits(kept, USDG_DECIMALS)} USDG${left.length ? ` (${left.join(", ")} stayed in your wallet: too small to move)` : ""}`;
    },
  };
}

/* ---------------- which vaults ---------------- */

/** Vault id prefixes Pecun can't build in the browser (Pendle PT/LP zaps, Yield Basis, Balancer joins). */
const SKIP_IDS = /^(pendle-|yb-|balancer|aura-)/;
/** Tokens Relay can't buy, per chain: vaults that need them stay on the regular page. Robinhood: only USDG and WETH route. */
const ROUTABLE_ON: Record<number, RegExp> = { [ROBINHOOD_CHAIN_ID]: /^(USDG|WETH|ETH)$/i };

function beefyAdapter(o: Opp): Adapter | null {
  const chainId = chainIdByName(o.chain);
  const [, chainKey, vaultId] = o.id.split(":");
  if (!chainId || !chainKey || !vaultId) return null;
  const known = loaded.get(chainKey)?.get(vaultId);
  const knownKind = known ? classify(known) : null;
  if (typeof knownKind === "string") return null;
  if (!known) {
    void chainVaults(chainKey).catch(() => null);
    if (SKIP_IDS.test(vaultId)) return null;
  }
  const only = ROUTABLE_ON[chainId];
  if (only && !o.asset.split("-").every((a) => only.test(a))) return null;

  const vault = lazy(() => beefyVault(chainKey, vaultId));
  const kind = lazy(async () => {
    const k = classify(await vault());
    if (typeof k === "string") throw new ExecError(`One-click isn't available for this vault yet (${k}).`);
    return k;
  });
  const holder = beefyHolder(chainId, async () => {
    await kind();
    return vault();
  });

  if (knownKind ? knownKind.t === "single" : o.kind !== "Liquidity") {
    // Single-asset vaults: the shared EVM flow (route into `want`, approve, deposit).
    return evmVault(chainId, { ...holder, asset: async () => ((await kind()).t === "single" ? holder.asset() : Promise.reject(new ExecError("One-click isn't available for this vault yet."))) }, o.asset);
  }

  const lp = lazy(async (): Promise<Lp> => {
    const [k, v] = await Promise.all([kind(), vault()]);
    const want = v.tokenAddress!;
    if (k.t === "curve") return curveLp(chainId, want, k.method, k.pool);
    if (k.t === "clm") return pairLp(chainId, want, await clmPair(chainId, want));
    if (k.t === "pair") return pairLp(chainId, want, k.kind === "aero-v2" ? await aeroV2Pair(chainId, want, k.router) : await routerPair(chainId, want, k.router, k.kind));
    throw new ExecError("One-click isn't available for this vault yet.");
  });
  return lpVault(chainId, holder, lp, { symbol: "USD", perLp: async () => lpPrice((await vault()).oracleId) });
}

/** Yearn's Curve-LP vaults: route into one coin, add it to the Curve pool, deposit the LP into Yearn. */
function yearnCurveAdapter(o: Opp): Adapter | null {
  const chainId = chainIdByName(o.chain);
  if (!chainId || !isAddr(o.address)) return null;
  const holder = evmProtocols.yearn(chainId, o.address);
  const lp = lazy(async () => {
    const want = (await holder.asset()).address;
    return curveLp(chainId, want, await detectCurve(chainId, want));
  });
  return lpVault(chainId, holder, lp, { symbol: o.asset, perLp: async () => 1 });
}

registerAdapters((o) => {
  if (o.protocol === "Beefy" && o.id.startsWith("beefy:")) return beefyAdapter(o);
  // Iron Bank's pool holds cyTokens (Iron Bank is wound down and Relay can't buy them).
  if (o.protocol === "Yearn" && /^(Curve|LP) /.test(o.name ?? "") && !/Iron Bank/i.test(o.name ?? "")) return yearnCurveAdapter(o);
  return null;
});

/** For tests and scripts. */
export const beefyInternals = { chainVaults, classify, curveLp, curveCalls, aeroV2Pair, detectCurve, clmPair, routerPair, pairLp, beefyHolder, lpPrice, splitFor };
