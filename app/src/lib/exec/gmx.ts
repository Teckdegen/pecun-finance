"use client";

import { encodeAbiParameters, encodeFunctionData, erc20Abi, formatEther, formatUnits, keccak256, parseAbi, parseEther, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { evmChain } from "../exec-chains";
import { ROBINHOOD_CHAIN_ID, USDG, USDG_DECIMALS } from "../wallet";
import {
  chainClient,
  ensureGas,
  erc20Balance,
  ExecError,
  IN_STEPS,
  isAddr,
  netOfFee,
  OUT_STEPS,
  planRoute,
  registerAdapters,
  runRoute,
  sendEvm,
  sleep,
  takeUsdgFee,
  USDC_ON,
  usdgOf,
  waitForArrival,
  type Adapter,
  type Preview,
  type Progress,
  type Signer,
} from "../execute";

/**
 * GMX v2 liquidity: GM pools and GLV vaults on Arbitrum and Avalanche.
 *
 * GMX deposits and withdrawals are two-phase: the user's transaction (ExchangeRouter / GlvRouter `multicall`: send the
 * keeper's execution fee in native gas, send the tokens to the vault, create the request) only files a request; a GMX
 * keeper executes it a few seconds later at oracle prices, minting GM/GLV or paying out the pool's tokens. If the keeper
 * can't execute (pool cap reached, price moved past the minimum), it cancels and refunds everything to the user.
 *
 * Deposits are single-sided: USDG → (Relay) one of the pool's own tokens (USDC when the pool has it), then deposited.
 * Withdrawals pay out the pool's long and short tokens; each is routed back to USDG, then Pecun's fee is taken once.
 * The position is shown in USD: GM/GLV balance × the token price GMX's own Reader contracts compute from GMX's public
 * oracle prices (arbitrum-api.gmxinfra.io / avalanche-api.gmxinfra.io).
 *
 * Contract addresses are GMX's live deployments (gmx-interface sdk/src/configs/contracts.ts), checked on-chain: both
 * routers hold ROUTER_PLUGIN in GMX's RoleStore.
 */

type Net = {
  api: string;
  dataStore: Address;
  exchangeRouter: Address;
  router: Address; // SyntheticsRouter: the ERC-20 spender for every GMX request
  depositVault: Address;
  withdrawalVault: Address;
  reader: Address;
  glvRouter: Address;
  glvVault: Address;
  glvReader: Address;
};

const NETS: Record<number, Net> = {
  42161: {
    api: "https://arbitrum-api.gmxinfra.io",
    dataStore: "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8",
    exchangeRouter: "0x6776c2b52179BC737193DE3bc75262681006AA27",
    router: "0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6",
    depositVault: "0xF89e77e8Dc11691C9e8757e84aaFbCD8A67d7A55",
    withdrawalVault: "0x0628D46b5D145f183AdB6Ef1f2c97eD1C4701C55",
    reader: "0xAda708aFf0f1D784D28cd8Ff4d6D977fF9599e5D",
    glvRouter: "0x321EB66dD95ad33715ee615AAb8dAC6394E7b3F9",
    glvVault: "0x393053B58f9678C9c28c2cE941fF6cac49C3F8f9",
    glvReader: "0x51fe0b7919e1208a717E9B16a097C1C3D70eFbf6",
  },
  43114: {
    api: "https://avalanche-api.gmxinfra.io",
    dataStore: "0x2F0b22339414ADeD7D5F06f9D604c7fF5b2fe3f6",
    exchangeRouter: "0x5b7693839ef8d767168891797B9d2f319e351672",
    router: "0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68",
    depositVault: "0x90c670825d0C62ede1c5ee9571d6d9a17A722DFF",
    withdrawalVault: "0xf5F30B10141E1F63FC11eD772931A8294a591996",
    reader: "0x9390285097B4a1997B91F61AF756DCD2509FcD0F",
    glvRouter: "0x5B8c1B498CCDDCAad36B5C81e48D773Ad338145D",
    glvVault: "0x527FB0bCfF63C47761039bB386cFE181A92a4701",
    glvReader: "0x79B6Bf52D49d215724951c5a9A541f8A2Ee165Bc",
  },
};

const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ZERO = BigInt(0);
const ONE_E18 = BigInt(10) ** BigInt(18);
const ONE_E30 = BigInt(10) ** BigInt(30);
/** Minimum-out tolerance on the GMX leg (keeper executes at a later oracle price). */
const GMX_SLIPPAGE_BPS = BigInt(100); // 1%
/** Execution fee headroom over the current gas price; GMX refunds what the keeper doesn't use. */
const FEE_BUFFER_PCT = BigInt(120);
/** Payout legs worth less than this stay in the wallet: too small to bridge. */
const DUST_USD = 0.05;
const KEEPER_TIMEOUT = 5 * 60_000;
/** Deposits GMX would value this much below what goes in are refused before anything moves. */
const MAX_DEPOSIT_LOSS = 0.05;
/** A payout token whose Relay route loses more than this is swapped to the pool's other token inside GMX instead. */
const ROUTE_LOSS = 0.03;

/* ---------------- ABIs ---------------- */

const MARKET_T = "(address marketToken, address indexToken, address longToken, address shortToken)";
const PRICE_T = "(uint256 min, uint256 max)";
const PRICES_T = `(${PRICE_T} indexTokenPrice, ${PRICE_T} longTokenPrice, ${PRICE_T} shortTokenPrice)`;

const ROUTER_ABI = parseAbi([
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function sendWnt(address receiver, uint256 amount) payable",
  "function sendTokens(address token, address receiver, uint256 amount) payable",
  "function createDeposit(((address receiver, address callbackContract, address uiFeeReceiver, address market, address initialLongToken, address initialShortToken, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minMarketTokens, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params) payable returns (bytes32)",
  "function createWithdrawal(((address receiver, address callbackContract, address uiFeeReceiver, address market, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minLongTokenAmount, uint256 minShortTokenAmount, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params) payable returns (bytes32)",
  "function createGlvDeposit(((address glv, address market, address receiver, address callbackContract, address uiFeeReceiver, address initialLongToken, address initialShortToken, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minGlvTokens, uint256 executionFee, uint256 callbackGasLimit, bool shouldUnwrapNativeToken, bool isMarketTokenDeposit, bytes32[] dataList) params) payable returns (bytes32)",
  "function createGlvWithdrawal(((address receiver, address callbackContract, address uiFeeReceiver, address market, address glv, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minLongTokenAmount, uint256 minShortTokenAmount, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params) payable returns (bytes32)",
]);

const READER_ABI = parseAbi([
  `function getMarketTokenPrice(address dataStore, ${MARKET_T} market, ${PRICE_T} indexTokenPrice, ${PRICE_T} longTokenPrice, ${PRICE_T} shortTokenPrice, bytes32 pnlFactorType, bool maximize) view returns (int256, (int256 poolValue, int256 longPnl, int256 shortPnl, int256 netPnl, uint256 longTokenAmount, uint256 shortTokenAmount, uint256 longTokenUsd, uint256 shortTokenUsd, uint256 totalBorrowingFees, uint256 borrowingFeePoolFactor, uint256 impactPoolAmount, uint256 lentImpactPoolAmount))`,
  `function getDepositAmountOut(address dataStore, ${MARKET_T} market, ${PRICES_T} prices, uint256 longTokenAmount, uint256 shortTokenAmount, address uiFeeReceiver, uint8 swapPricingType, bool includeVirtualInventoryImpact) view returns (uint256)`,
  `function getWithdrawalAmountOut(address dataStore, ${MARKET_T} market, ${PRICES_T} prices, uint256 marketTokenAmount, address uiFeeReceiver, uint8 swapPricingType) view returns (uint256, uint256)`,
]);

const GLV_READER_ABI = parseAbi([
  "function getGlvInfo(address dataStore, address glv) view returns (((address glvToken, address longToken, address shortToken) glv, address[] markets))",
  `function getGlvTokenPrice(address dataStore, address[] marketAddresses, ${PRICE_T}[] indexTokenPrices, ${PRICE_T} longTokenPrice, ${PRICE_T} shortTokenPrice, address glv, bool maximize) view returns (uint256, uint256, uint256)`,
]);

const DS_ABI = parseAbi(["function getUint(bytes32 key) view returns (uint256)", "function getBool(bytes32 key) view returns (bool)", "function getBytes32Count(bytes32 setKey) view returns (uint256)"]);

/** GMX's DataStore keys: keccak256(abi.encode(name, ...args)). */
const key = (name: string) => keccak256(encodeAbiParameters([{ type: "string" }], [name]));
const keyOf = (name: string, ...addrs: Address[]) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, ...addrs.map(() => ({ type: "address" as const }))], [key(name), ...addrs]));

const SWAP_PRICING_DEPOSIT = 3;
const SWAP_PRICING_WITHDRAWAL = 4;

/* ---------------- GMX public API (CORS-open) ---------------- */

type ApiMarket = { marketToken: Address; indexToken: Address; longToken: Address; shortToken: Address; isListed: boolean };
type ApiGlv = { glvToken: Address; longToken: Address; shortToken: Address; markets: { address: Address; balance: string; balanceUsd: string; isDisabled: boolean }[] };
type ApiToken = { address: Address; symbol: string; decimals: number };
type ApiTicker = { tokenAddress: Address; minPrice: string; maxPrice: string };
export type Px = { min: bigint; max: bigint };

async function getJson<T>(url: string, ms = 20_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new ExecError(`GMX didn't answer (${res.status}).`);
    return (await res.json()) as T;
  } catch (e) {
    throw e instanceof ExecError ? e : new ExecError("GMX's price service didn't answer. Try again in a moment.");
  } finally {
    clearTimeout(t);
  }
}

/** A value refreshed after `ttl` ms; failures aren't cached. */
function ttl<T>(ms: number, f: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let p: Promise<T> | undefined;
  return () => {
    if (!p || Date.now() - at > ms) {
      at = Date.now();
      p = f().catch((e) => ((p = undefined), Promise.reject(e)));
    }
    return p;
  };
}

const perChain = <T,>(make: (chainId: number) => () => Promise<T>) => {
  const m = new Map<number, () => Promise<T>>();
  return (chainId: number) => {
    let f = m.get(chainId);
    if (!f) m.set(chainId, (f = make(chainId)));
    return f();
  };
};

const lc = (a: string) => a.toLowerCase();
const same = (a: string, b: string) => lc(a) === lc(b);

const apiMarkets = perChain((id) =>
  ttl(10 * 60_000, async () => new Map((await getJson<{ markets: ApiMarket[] }>(`${NETS[id].api}/markets/info`)).markets.map((m) => [lc(m.marketToken), m]))),
);
const apiGlvs = perChain((id) => ttl(60_000, async () => new Map((await getJson<{ glvs: ApiGlv[] }>(`${NETS[id].api}/glvs/info`)).glvs.map((g) => [lc(g.glvToken), g]))));
const apiTokens = perChain((id) => ttl(60 * 60_000, async () => new Map((await getJson<{ tokens: ApiToken[] }>(`${NETS[id].api}/tokens`)).tokens.map((t) => [lc(t.address), t]))));
const apiTickers = perChain((id) =>
  ttl(10_000, async () => new Map((await getJson<ApiTicker[]>(`${NETS[id].api}/prices/tickers`)).map((t) => [lc(t.tokenAddress), { min: BigInt(t.minPrice), max: BigInt(t.maxPrice) }]))),
);

/** GMX oracle price: USD × 1e30 per smallest token unit. Swap-only markets have no index token (price 0). */
async function priceOf(chainId: number, token: Address): Promise<Px> {
  if (token === zeroAddress) return { min: ZERO, max: ZERO };
  const p = (await apiTickers(chainId)).get(lc(token));
  if (!p) throw new ExecError("GMX has no price for this pool's token right now.");
  return p;
}

async function tokenInfo(chainId: number, token: Address): Promise<{ symbol: string; decimals: number }> {
  const t = (await apiTokens(chainId)).get(lc(token));
  if (t) return t;
  const c = chainClient(chainId);
  const [decimals, symbol] = await Promise.all([
    c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    c.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "token"),
  ]);
  return { symbol, decimals };
}

type MarketProps = { marketToken: Address; indexToken: Address; longToken: Address; shortToken: Address };

async function marketProps(chainId: number, market: Address): Promise<MarketProps> {
  const m = (await apiMarkets(chainId)).get(lc(market));
  if (!m) throw new ExecError("GMX doesn't list this pool right now.");
  return { marketToken: m.marketToken, indexToken: m.indexToken, longToken: m.longToken, shortToken: m.shortToken };
}

async function marketPrices(chainId: number, m: MarketProps) {
  const [indexTokenPrice, longTokenPrice, shortTokenPrice] = await Promise.all([priceOf(chainId, m.indexToken), priceOf(chainId, m.longToken), priceOf(chainId, m.shortToken)]);
  return { indexTokenPrice, longTokenPrice, shortTokenPrice };
}

/* ---------------- on-chain reads ---------------- */

const reader = (chainId: number) => chainClient(chainId);

/** GM token price, USD × 1e30 per whole GM (1e18 units). Valued the way withdrawals are (min prices, withdrawal PnL cap). */
async function gmPrice(chainId: number, market: Address, maximize = false): Promise<bigint> {
  const n = NETS[chainId];
  const m = await marketProps(chainId, market);
  const p = await marketPrices(chainId, m);
  const [price] = await reader(chainId).readContract({
    address: n.reader,
    abi: READER_ABI,
    functionName: "getMarketTokenPrice",
    args: [n.dataStore, m, p.indexTokenPrice, p.longTokenPrice, p.shortTokenPrice, key(maximize ? "MAX_PNL_FACTOR_FOR_DEPOSITS" : "MAX_PNL_FACTOR_FOR_WITHDRAWALS"), maximize],
  });
  if (price <= ZERO) throw new ExecError("GMX couldn't price this pool right now.");
  return price;
}

const glvInfo = perChain((id) => {
  const cache = new Map<string, Promise<{ longToken: Address; shortToken: Address; markets: readonly Address[] }>>();
  return async () => (glv: Address) => {
    let p = cache.get(lc(glv));
    if (!p) {
      p = reader(id)
        .readContract({ address: NETS[id].glvReader, abi: GLV_READER_ABI, functionName: "getGlvInfo", args: [NETS[id].dataStore, glv] })
        .then((r) => ({ longToken: r.glv.longToken, shortToken: r.glv.shortToken, markets: r.markets }));
      p.catch(() => cache.delete(lc(glv)));
      cache.set(lc(glv), p);
    }
    return p;
  };
});
const glvOf = async (chainId: number, glv: Address) => (await glvInfo(chainId))(glv);

/** GLV token price, USD × 1e30 per whole GLV (1e18 units). */
async function glvPrice(chainId: number, glv: Address, maximize = false): Promise<bigint> {
  const n = NETS[chainId];
  const g = await glvOf(chainId, glv);
  const idx = await Promise.all(g.markets.map(async (mk) => priceOf(chainId, (await marketProps(chainId, mk)).indexToken)));
  const [longP, shortP] = await Promise.all([priceOf(chainId, g.longToken), priceOf(chainId, g.shortToken)]);
  const [price] = await reader(chainId).readContract({
    address: n.glvReader,
    abi: GLV_READER_ABI,
    functionName: "getGlvTokenPrice",
    args: [n.dataStore, [...g.markets], idx, longP, shortP, glv, maximize],
  });
  if (price <= ZERO) throw new ExecError("GMX couldn't price this vault right now.");
  return price;
}

async function depositAmountOut(chainId: number, market: Address, token: Address, amount: bigint): Promise<bigint> {
  const n = NETS[chainId];
  const m = await marketProps(chainId, market);
  const isLong = same(token, m.longToken);
  return reader(chainId).readContract({
    address: n.reader,
    abi: READER_ABI,
    functionName: "getDepositAmountOut",
    args: [n.dataStore, m, await marketPrices(chainId, m), isLong ? amount : ZERO, isLong ? ZERO : amount, zeroAddress, SWAP_PRICING_DEPOSIT, true],
  });
}

async function withdrawalAmountOut(chainId: number, market: Address, gm: bigint): Promise<{ m: MarketProps; long: bigint; short: bigint }> {
  const n = NETS[chainId];
  const m = await marketProps(chainId, market);
  const [long, short] = await reader(chainId).readContract({
    address: n.reader,
    abi: READER_ABI,
    functionName: "getWithdrawalAmountOut",
    args: [n.dataStore, m, await marketPrices(chainId, m), gm, zeroAddress, SWAP_PRICING_WITHDRAWAL],
  });
  return { m, long, short };
}

const dsUints = async (chainId: number, keys: Hex[]): Promise<bigint[]> => {
  const n = NETS[chainId];
  const res = await chainClient(chainId).multicall({
    multicallAddress: MULTICALL3,
    allowFailure: false,
    contracts: keys.map((k) => ({ address: n.dataStore, abi: DS_ABI, functionName: "getUint" as const, args: [k] as const })),
  });
  return res as bigint[];
};

const gasConfig = perChain((id) =>
  ttl(5 * 60_000, async () => {
    const names = ["ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1", "ESTIMATED_GAS_FEE_PER_ORACLE_PRICE", "ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR", "DEPOSIT_GAS_LIMIT", "WITHDRAWAL_GAS_LIMIT", "GLV_DEPOSIT_GAS_LIMIT", "GLV_WITHDRAWAL_GAS_LIMIT", "GLV_PER_MARKET_GAS_LIMIT", "SINGLE_SWAP_GAS_LIMIT"] as const;
    const v = await dsUints(id, names.map(key));
    return Object.fromEntries(names.map((n, i) => [n, v[i]])) as Record<(typeof names)[number], bigint>;
  }),
);

/** `swaps`: swap-path hops in the request (each costs SINGLE_SWAP_GAS_LIMIT and one more oracle price). */
export type FeeKind = ({ op: "deposit" | "withdrawal" } | { op: "glvDeposit" | "glvWithdrawal"; marketCount: number }) & { swaps?: number };

/** The keeper's execution fee in native gas (wei), as GMX validates it (GasUtils.adjustGasLimitForEstimate × gas price), plus headroom. */
export async function executionFee(chainId: number, kind: FeeKind): Promise<bigint> {
  const [g, fees] = await Promise.all([gasConfig(chainId), chainClient(chainId).estimateFeesPerGas()]);
  let est: bigint;
  let oracles: bigint;
  if (!("marketCount" in kind)) {
    est = kind.op === "deposit" ? g.DEPOSIT_GAS_LIMIT : g.WITHDRAWAL_GAS_LIMIT;
    oracles = BigInt(3);
  } else {
    const n = BigInt(kind.marketCount);
    est = kind.op === "glvDeposit" ? g.GLV_DEPOSIT_GAS_LIMIT + g.DEPOSIT_GAS_LIMIT : g.GLV_WITHDRAWAL_GAS_LIMIT + g.WITHDRAWAL_GAS_LIMIT;
    est += g.GLV_PER_MARKET_GAS_LIMIT * n;
    oracles = BigInt(2) + n;
  }
  const swaps = BigInt(kind.swaps ?? 0);
  est += g.SINGLE_SWAP_GAS_LIMIT * swaps;
  oracles += swaps;
  const limit = g.ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1 + g.ESTIMATED_GAS_FEE_PER_ORACLE_PRICE * oracles + (est * g.ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR) / ONE_E30;
  return (limit * fees.maxFeePerGas * FEE_BUFFER_PCT) / BigInt(100);
}

/** Gas the request transaction itself may use (the multicall measured ~0.9–1.0M on mainnet simulation), for the up-front top-up. */
const REQUEST_GAS = BigInt(1_300_000);

/** Native gas the user needs for one request: the keeper fee plus the transaction's own gas. */
async function nativeNeed(chainId: number, fee: bigint): Promise<bigint> {
  const fees = await chainClient(chainId).estimateFeesPerGas();
  return fee + (REQUEST_GAS * fees.maxFeePerGas * BigInt(13)) / BigInt(10);
}

/** Fails early (before any money moves) when the keeper fee is more than the gas tank may send in one top-up. */
async function checkFeeCovered(chainId: number, owner: Address, fee: bigint) {
  const ch = evmChain(chainId);
  if (!ch) throw new ExecError("Pecun doesn't cover gas on this chain yet.");
  const [need, bal] = await Promise.all([nativeNeed(chainId, fee), chainClient(chainId).getBalance({ address: owner })]);
  if (need > bal && need - bal > parseEther(ch.maxTopUp))
    throw new ExecError(
      `GMX's keeper fee right now (${Number(formatEther(fee)).toPrecision(3)} ${ch.native}) is more than Pecun's gas tank covers on ${ch.names[0]}. Nothing was sent; try again when network fees are lower.`,
    );
}

/** Tops up native gas for the keeper fee + the request transaction before it is estimated (estimation needs balance ≥ value). */
async function fundRequest(s: Signer, chainId: number, fee: bigint) {
  const [need, bal] = await Promise.all([nativeNeed(chainId, fee), chainClient(chainId).getBalance({ address: s.address })]);
  await ensureGas(s, chainId, s.address, need, bal);
}

async function nativeUsd(chainId: number, wei: bigint): Promise<number> {
  // GMX prices native through its wrapped token (WETH / WAVAX), 18 decimals.
  const wnt = chainId === 42161 ? "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" : "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
  const p = await priceOf(chainId, wnt).catch(() => null);
  return p ? Number(formatUnits(wei * p.min, 30)) : 0;
}

/** Keeper-executed requests stay in the account's list until executed or cancelled. */
async function pendingCount(chainId: number, list: "ACCOUNT_DEPOSIT_LIST" | "ACCOUNT_WITHDRAWAL_LIST" | "ACCOUNT_GLV_DEPOSIT_LIST" | "ACCOUNT_GLV_WITHDRAWAL_LIST", owner: Address) {
  return chainClient(chainId).readContract({ address: NETS[chainId].dataStore, abi: DS_ABI, functionName: "getBytes32Count", args: [keyOf(list, owner)] });
}

async function waitForKeeper(chainId: number, list: Parameters<typeof pendingCount>[1], owner: Address, before: bigint) {
  const end = Date.now() + KEEPER_TIMEOUT;
  await sleep(2000);
  while (Date.now() < end) {
    const n = await pendingCount(chainId, list, owner).catch(() => null);
    if (n !== null && n <= before) return;
    await sleep(3000);
  }
  throw new ExecError("GMX's keeper hasn't processed the request yet. It usually does within a minute; check again shortly. If it's cancelled, GMX refunds everything to your wallet.");
}

/** Room left under the pool's deposit caps for `token`; throws when the deposit wouldn't fit. */
async function checkPoolRoom(chainId: number, m: MarketProps, token: Address, amount: bigint) {
  const [[pool, maxAmount, maxUsd], px, disabled] = await Promise.all([
    dsUints(chainId, [keyOf("POOL_AMOUNT", m.marketToken, token), keyOf("MAX_POOL_AMOUNT", m.marketToken, token), keyOf("MAX_POOL_USD_FOR_DEPOSIT", m.marketToken, token)]),
    priceOf(chainId, token),
    chainClient(chainId).readContract({ address: NETS[chainId].dataStore, abi: DS_ABI, functionName: "getBool", args: [keyOf("IS_MARKET_DISABLED", m.marketToken)] }),
  ]);
  if (disabled) throw new ExecError("GMX has paused this pool.");
  // Single-token pools count each deposit half as long, half as short.
  const div = same(m.longToken, m.shortToken) ? BigInt(2) : BigInt(1);
  const after = (pool + amount) / div;
  if (maxAmount > ZERO && after > maxAmount) throw new ExecError("This GMX pool is full right now. Nothing was sent.");
  if (maxUsd > ZERO && after * px.max > maxUsd) throw new ExecError("This GMX pool is full right now. Nothing was sent.");
}

/* ---------------- request builders (exported for scripts) ---------------- */

const enc = (functionName: "sendWnt" | "sendTokens", args: readonly [Address, bigint] | readonly [Address, Address, bigint]) =>
  functionName === "sendWnt"
    ? encodeFunctionData({ abi: ROUTER_ABI, functionName, args: args as readonly [Address, bigint] })
    : encodeFunctionData({ abi: ROUTER_ABI, functionName, args: args as readonly [Address, Address, bigint] });

export type Tx = { to: Address; data: Hex; value: bigint };

export function gmDepositTx(chainId: number, m: MarketProps, owner: Address, token: Address, amount: bigint, fee: bigint, minMarketTokens: bigint): Tx {
  const n = NETS[chainId];
  const create = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "createDeposit",
    args: [
      {
        addresses: { receiver: owner, callbackContract: zeroAddress, uiFeeReceiver: zeroAddress, market: m.marketToken, initialLongToken: m.longToken, initialShortToken: m.shortToken, longTokenSwapPath: [], shortTokenSwapPath: [] },
        minMarketTokens,
        shouldUnwrapNativeToken: false,
        executionFee: fee,
        callbackGasLimit: ZERO,
        dataList: [],
      },
    ],
  });
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [[enc("sendWnt", [n.depositVault, fee]), enc("sendTokens", [token, n.depositVault, amount]), create]] });
  return { to: n.exchangeRouter, data, value: fee };
}

export function gmWithdrawTx(chainId: number, market: Address, owner: Address, gm: bigint, fee: bigint, minLong: bigint, minShort: bigint, swapLong = false): Tx {
  const n = NETS[chainId];
  const create = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "createWithdrawal",
    args: [
      {
        addresses: { receiver: owner, callbackContract: zeroAddress, uiFeeReceiver: zeroAddress, market, longTokenSwapPath: swapLong ? [market] : [], shortTokenSwapPath: [] },
        minLongTokenAmount: minLong,
        minShortTokenAmount: minShort,
        shouldUnwrapNativeToken: false,
        executionFee: fee,
        callbackGasLimit: ZERO,
        dataList: [],
      },
    ],
  });
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [[enc("sendWnt", [n.withdrawalVault, fee]), enc("sendTokens", [market, n.withdrawalVault, gm]), create]] });
  return { to: n.exchangeRouter, data, value: fee };
}

export function glvDepositTx(chainId: number, glv: Address, m: MarketProps, owner: Address, token: Address, amount: bigint, fee: bigint, minGlvTokens: bigint): Tx {
  const n = NETS[chainId];
  const create = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "createGlvDeposit",
    args: [
      {
        addresses: {
          glv,
          market: m.marketToken,
          receiver: owner,
          callbackContract: zeroAddress,
          uiFeeReceiver: zeroAddress,
          initialLongToken: m.longToken,
          initialShortToken: m.shortToken,
          longTokenSwapPath: [],
          shortTokenSwapPath: [],
        },
        minGlvTokens,
        executionFee: fee,
        callbackGasLimit: ZERO,
        shouldUnwrapNativeToken: false,
        isMarketTokenDeposit: false,
        dataList: [],
      },
    ],
  });
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [[enc("sendWnt", [n.glvVault, fee]), enc("sendTokens", [token, n.glvVault, amount]), create]] });
  return { to: n.glvRouter, data, value: fee };
}

export function glvWithdrawTx(chainId: number, glv: Address, market: Address, owner: Address, amount: bigint, fee: bigint, minLong: bigint, minShort: bigint, swapLong = false): Tx {
  const n = NETS[chainId];
  const create = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "createGlvWithdrawal",
    args: [
      {
        addresses: { receiver: owner, callbackContract: zeroAddress, uiFeeReceiver: zeroAddress, market, glv, longTokenSwapPath: swapLong ? [market] : [], shortTokenSwapPath: [] },
        minLongTokenAmount: minLong,
        minShortTokenAmount: minShort,
        shouldUnwrapNativeToken: false,
        executionFee: fee,
        callbackGasLimit: ZERO,
        dataList: [],
      },
    ],
  });
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [[enc("sendWnt", [n.glvVault, fee]), enc("sendTokens", [glv, n.glvVault, amount]), create]] });
  return { to: n.glvRouter, data, value: fee };
}

/* ---------------- one adapter for GM pools and GLV vaults ---------------- */

const minus = (x: bigint, bps: bigint) => (x * (BigInt(10_000) - bps)) / BigInt(10_000);
const usdNum = (amount18: bigint, price30: bigint) => Number(formatUnits((amount18 * price30) / ONE_E18, 30));
const usd30 = (usd: number) => parseUnits(usd.toFixed(6), 30);

/** What differs between a GM pool and a GLV vault. `token` is the GM or GLV token (18 decimals). */
type Pool = {
  chainId: number;
  token: Address;
  /** The pool tokens a deposit can be made in (single-sided), best first. */
  depositTokens: () => Promise<Address[]>;
  price: () => Promise<bigint>;
  /** Picks where to put `amount` of `token`; returns the GM market used, the expected GM/GLV out, and a request builder. */
  planDeposit: (token: Address, amount: bigint) => Promise<{ market: MarketProps; out: bigint; fee: bigint; tx: (owner: Address, minOut: bigint) => Tx }>;
  /**
   * Expected payout for `amount` of GM/GLV, and a request builder (minimums built in). With `swapLong`, GMX swaps the
   * long-token payout into the short token inside the same pool, so everything arrives as one token.
   */
  planWithdraw: (amount: bigint, swapLong?: boolean) => Promise<Withdrawal>;
  lists: { deposit: Parameters<typeof pendingCount>[1]; withdraw: Parameters<typeof pendingCount>[1] };
};

function gmPool(chainId: number, market: Address): Pool {
  return {
    chainId,
    token: market,
    depositTokens: async () => {
      const m = await marketProps(chainId, market);
      const usdc = USDC_ON[chainId];
      const list = [...(usdc && (same(usdc, m.shortToken) || same(usdc, m.longToken)) ? [usdc] : []), m.shortToken, m.longToken];
      return list.filter((t, i) => list.findIndex((x) => same(x, t)) === i);
    },
    price: () => gmPrice(chainId, market),
    planDeposit: async (token, amount) => {
      const m = await marketProps(chainId, market);
      await checkPoolRoom(chainId, m, token, amount);
      const [out, fee] = await Promise.all([depositAmountOut(chainId, market, token, amount), executionFee(chainId, { op: "deposit" })]);
      return { market: m, out, fee, tx: (owner, minOut) => gmDepositTx(chainId, m, owner, token, amount, fee, minOut) };
    },
    planWithdraw: async (gm, swapLong = false) => {
      const { m, long, short } = await withdrawalAmountOut(chainId, market, gm);
      let fee = ZERO;
      return withdrawalPlan(
        chainId,
        m,
        long,
        short,
        swapLong,
        (minLong, minShort, swap) => (owner) => gmWithdrawTx(chainId, market, owner, gm, fee, minLong, minShort, swap),
        async (swaps) => (fee = await executionFee(chainId, { op: "withdrawal", swaps })),
      );
    },
    lists: { deposit: "ACCOUNT_DEPOSIT_LIST", withdraw: "ACCOUNT_WITHDRAWAL_LIST" },
  };
}

function glvPool(chainId: number, glv: Address): Pool {
  const apiGlv = async () => {
    const g = (await apiGlvs(chainId)).get(lc(glv));
    if (!g) throw new ExecError("GMX doesn't list this vault right now.");
    return g;
  };
  return {
    chainId,
    token: glv,
    depositTokens: async () => {
      const g = await glvOf(chainId, glv);
      const usdc = USDC_ON[chainId];
      const list = [...(usdc && (same(usdc, g.shortToken) || same(usdc, g.longToken)) ? [usdc] : []), g.shortToken, g.longToken];
      return list.filter((t, i) => list.findIndex((x) => same(x, t)) === i);
    },
    price: () => glvPrice(chainId, glv),
    planDeposit: async (token, amount) => {
      const [g, a, px, glvPx] = await Promise.all([glvOf(chainId, glv), apiGlv(), priceOf(chainId, token), glvPrice(chainId, glv, true)]);
      const depositUsd = (amount * px.max) as bigint;
      // GLV caps how much of each GM market it may hold; deposit into the enabled market with the most room.
      const live = a.markets.filter((x) => !x.isDisabled && g.markets.some((mk) => same(mk, x.address)));
      const caps = await dsUints(chainId, live.flatMap((x) => [keyOf("GLV_MAX_MARKET_TOKEN_BALANCE_USD", glv, x.address), keyOf("GLV_MAX_MARKET_TOKEN_BALANCE_AMOUNT", glv, x.address)]));
      const room = live
        .map((x, i) => {
          const maxUsd = caps[2 * i];
          const maxAmt = caps[2 * i + 1];
          const bal = BigInt(x.balance);
          const balUsd = BigInt(x.balanceUsd);
          const usdRoom = maxUsd > ZERO ? maxUsd - balUsd : MAX;
          const amtRoom = maxAmt > ZERO ? (bal > ZERO ? ((maxAmt - bal) * balUsd) / bal : ZERO) : MAX;
          return { market: x.address, room: usdRoom < amtRoom ? usdRoom : amtRoom };
        })
        .filter((x) => x.room > depositUsd)
        .sort((x, y) => (y.room > x.room ? 1 : y.room < x.room ? -1 : 0));
      let lastErr: unknown = new ExecError("This GLV vault is full right now. Nothing was sent.");
      for (const r of room.slice(0, 4)) {
        try {
          const m = await marketProps(chainId, r.market);
          await checkPoolRoom(chainId, m, token, amount);
          const [gmOut, gmPx, fee] = await Promise.all([depositAmountOut(chainId, r.market, token, amount), gmPrice(chainId, r.market), executionFee(chainId, { op: "glvDeposit", marketCount: g.markets.length })]);
          const out = (gmOut * gmPx) / glvPx;
          return { market: m, out, fee, tx: (owner, minOut) => glvDepositTx(chainId, glv, m, owner, token, amount, fee, minOut) };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    },
    planWithdraw: async (amount, swapLong = false) => {
      const [g, a, glvPx] = await Promise.all([glvOf(chainId, glv), apiGlv(), glvPrice(chainId, glv)]);
      const usd = (amount * glvPx) / ONE_E18;
      // Withdraw from the market the vault holds the most of (it must cover the whole amount).
      const pick = a.markets
        .filter((x) => g.markets.some((mk) => same(mk, x.address)) && BigInt(x.balanceUsd) > (usd * BigInt(11)) / BigInt(10))
        .sort((x, y) => (BigInt(y.balanceUsd) > BigInt(x.balanceUsd) ? 1 : -1))[0];
      if (!pick) throw new ExecError("No single GMX market in this vault can cover that withdrawal right now. Try a smaller amount.");
      const gmPx = await gmPrice(chainId, pick.address);
      const { m, long, short } = await withdrawalAmountOut(chainId, pick.address, (usd * ONE_E18) / gmPx);
      let fee = ZERO;
      return withdrawalPlan(
        chainId,
        m,
        long,
        short,
        swapLong,
        (minLong, minShort, swap) => (owner) => glvWithdrawTx(chainId, glv, pick.address, owner, amount, fee, minLong, minShort, swap),
        async (swaps) => (fee = await executionFee(chainId, { op: "glvWithdrawal", marketCount: g.markets.length, swaps })),
      );
    },
    lists: { deposit: "ACCOUNT_GLV_DEPOSIT_LIST", withdraw: "ACCOUNT_GLV_WITHDRAWAL_LIST" },
  };
}

const MAX = BigInt(2) ** BigInt(255);

type Withdrawal = { outs: { token: Address; amount: bigint }[]; fee: bigint; swapped: boolean; tx: (owner: Address) => Tx };

/**
 * Payout and minimums for a GM withdrawal of `long` + `short`. With `swapLong` (two-token pools only) the long side is
 * swapped to the short token at GMX's oracle price; its minimum then applies to the swap's output, in short-token units.
 */
async function withdrawalPlan(chainId: number, m: MarketProps, long: bigint, short: bigint, swapLong: boolean, build: (minLong: bigint, minShort: bigint, swap: boolean) => (owner: Address) => Tx, fee: (swaps: number) => Promise<bigint>): Promise<Withdrawal> {
  const swap = swapLong && !same(m.longToken, m.shortToken) && long > ZERO;
  if (!swap) {
    return {
      outs: [
        { token: m.longToken, amount: long },
        { token: m.shortToken, amount: short },
      ],
      fee: await fee(0),
      swapped: false,
      tx: build(minus(long, GMX_SLIPPAGE_BPS), minus(short, GMX_SLIPPAGE_BPS), false),
    };
  }
  const [pl, ps] = await Promise.all([priceOf(chainId, m.longToken), priceOf(chainId, m.shortToken)]);
  // Swap fee + impact allowance on top of the usual slippage.
  const asShort = minus((long * pl.min) / ps.max, BigInt(30));
  return {
    outs: [{ token: m.shortToken, amount: short + asShort }],
    fee: await fee(1),
    swapped: true,
    tx: build(minus(asShort, GMX_SLIPPAGE_BPS), minus(short, GMX_SLIPPAGE_BPS), true),
  };
}

/** Payout tokens merged by address (single-token pools pay the same token twice), dust dropped. */
async function payoutLegs(chainId: number, outs: { token: Address; amount: bigint }[]) {
  const merged: { token: Address; amount: bigint }[] = [];
  for (const o of outs) {
    const m = merged.find((x) => same(x.token, o.token));
    if (m) m.amount += o.amount;
    else if (o.amount > ZERO) merged.push({ ...o });
  }
  const legs: { token: Address; amount: bigint; usd: number; symbol: string; decimals: number }[] = [];
  for (const l of merged) {
    const [px, t] = await Promise.all([priceOf(chainId, l.token), tokenInfo(chainId, l.token)]);
    const usd = Number(formatUnits(l.amount * px.min, 30));
    legs.push({ ...l, usd, symbol: t.symbol, decimals: t.decimals });
  }
  return legs;
}

function gmxAdapter(pool: Pool, label: string): Adapter {
  const { chainId } = pool;
  const positionSymbol = `USD of ${label}`;
  let preferred: Address | undefined; // the deposit token whose route last worked

  const balance = (owner: Address) => erc20Balance(chainId, pool.token, owner);

  /** Picks the first pool token Relay can route USDG into; returns it with its route. */
  const pickRoute = async (owner: Address, net: bigint) => {
    const list = await pool.depositTokens();
    const order = preferred ? [preferred, ...list.filter((t) => !same(t, preferred!))] : list;
    let last: unknown;
    for (const token of order) {
      try {
        const t = await tokenInfo(chainId, token);
        const plan = await planRoute({ from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount: net, user: owner, recipient: owner }, t.symbol);
        preferred = token;
        return { token, t, plan };
      } catch (e) {
        last = e;
      }
    }
    throw last ?? new ExecError("No route into this pool right now.");
  };

  const toUnits = async (owner: Address, amount: string | "max") => {
    const bal = await balance(owner);
    if (amount === "max") return bal;
    const want = (usd30(Number(amount)) * ONE_E18) / (await pool.price());
    return want < bal ? want : bal;
  };

  /** Expected deposit value; refuses pools that would value it far below what goes in (e.g. an unseeded pool). */
  const quoteDeposit = async (token: Address, amount: bigint) => {
    const [d, px, price] = await Promise.all([pool.planDeposit(token, amount), priceOf(chainId, token), pool.price()]);
    const valueUsd = usdNum(d.out, price);
    const inUsd = Number(formatUnits(amount * px.min, 30));
    if (inUsd > 0 && valueUsd < inUsd * (1 - MAX_DEPOSIT_LOSS))
      throw new ExecError(`GMX would value this deposit at $${valueUsd.toFixed(2)} for $${inUsd.toFixed(2)} in (the pool is nearly empty or very unbalanced). Nothing was sent.`);
    return { d, valueUsd, inUsd };
  };

  /**
   * How to withdraw `units`: both pool tokens routed home separately, or (when Relay's route for one of them loses
   * more than ROUTE_LOSS, or has none) the long side swapped to the short token inside GMX first.
   */
  const chooseWithdraw = async (owner: Address, units: bigint) => {
    const routes = async (w: Withdrawal) => {
      const legs = (await payoutLegs(chainId, w.outs)).filter((l) => l.usd >= DUST_USD);
      const plans = await Promise.all(
        legs.map((l) =>
          planRoute({ from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: l.token, outToken: USDG, amount: l.amount, user: owner, recipient: owner }, "USDG").catch((e: unknown) =>
            e instanceof Error ? e : new ExecError(String(e)),
          ),
        ),
      );
      const poor = legs.some((l, i) => {
        const p = plans[i];
        return p instanceof Error || Number(formatUnits(p.out, USDG_DECIMALS)) < l.usd * (1 - ROUTE_LOSS);
      });
      return { w, legs, plans, poor };
    };
    const plain = await routes(await pool.planWithdraw(units, false));
    if (!plain.poor || plain.w.outs.length < 2 || same(plain.w.outs[0].token, plain.w.outs[1].token)) return plain;
    const swapped = await routes(await pool.planWithdraw(units, true)).catch(() => null);
    return swapped && !swapped.poor ? swapped : plain;
  };

  return {
    positionSymbol,
    depositSteps: [IN_STEPS[0], IN_STEPS[1], { id: "deposit", label: `Deposit into GMX (${label})` }, { id: "keeper", label: "GMX keeper executes the deposit" }],
    withdrawSteps: [{ id: "withdraw", label: `Withdraw from GMX (${label})` }, { id: "keeper", label: "GMX keeper pays out" }, OUT_STEPS[1], OUT_STEPS[2]],

    position: async (s) => {
      const bal = await balance(s.address);
      return bal > ZERO ? usdNum(bal, await pool.price()) : 0;
    },

    previewDeposit: async (s, usdg) => {
      const { token, t, plan } = await pickRoute(s.address, netOfFee(usdg));
      const { d, valueUsd, inUsd } = await quoteDeposit(token, plan.out);
      const routeMin = parseUnits(plan.preview.minOut, t.decimals);
      const ratio = plan.out > ZERO ? Number(routeMin) / Number(plan.out) : 1;
      return {
        out: valueUsd.toFixed(2),
        outSymbol: positionSymbol,
        minOut: ((valueUsd * ratio * Number(BigInt(10_000) - GMX_SLIPPAGE_BPS)) / 10_000).toFixed(2),
        slippagePct: plan.preview.slippagePct + Number(GMX_SLIPPAGE_BPS) / 100,
        impactPct: plan.preview.impactPct + (inUsd > 0 ? (valueUsd / inUsd - 1) * 100 : 0),
        feesUsd: plan.preview.feesUsd + (await nativeUsd(chainId, d.fee)),
        seconds: plan.preview.seconds + 30,
      };
    },

    previewWithdraw: async (s, amount) => {
      const units = (usd30(Number(amount)) * ONE_E18) / (await pool.price());
      const { w, legs, plans: tried } = await chooseWithdraw(s.address, units);
      if (!legs.length) throw new ExecError("That amount is too small to withdraw.");
      const failed = tried.find((p): p is Error => p instanceof Error);
      if (failed) throw failed;
      const plans = tried.filter((p): p is Exclude<(typeof tried)[number], Error> => !(p instanceof Error));
      const out = plans.reduce((t, p) => t + p.out, ZERO);
      const min = plans.reduce((t, p) => t + parseUnits(p.preview.minOut, USDG_DECIMALS), ZERO);
      const legsUsd = legs.reduce((t, l) => t + l.usd, 0);
      const req = Number(amount) || 0;
      const weight = (i: number) => (legsUsd > 0 ? legs[i].usd / legsUsd : 0);
      const p: Preview = {
        out: formatUnits(out, USDG_DECIMALS),
        outSymbol: "USDG",
        minOut: formatUnits(minus(min, GMX_SLIPPAGE_BPS), USDG_DECIMALS),
        slippagePct: Math.max(...plans.map((x) => x.preview.slippagePct)) + Number(GMX_SLIPPAGE_BPS) / 100,
        impactPct: plans.reduce((t, x, i) => t + x.preview.impactPct * weight(i), 0) + (req > 0 ? (legsUsd / req - 1) * 100 : 0),
        feesUsd: plans.reduce((t, x) => t + x.preview.feesUsd, 0) + (await nativeUsd(chainId, w.fee)),
        seconds: Math.max(...plans.map((x) => x.preview.seconds)) + 30,
      };
      return p;
    },

    deposit: async (s, usdg, on) => {
      // Everything that could stop the deposit is checked before Pecun's fee or the bridge moves anything.
      const first = await pickRoute(s.address, netOfFee(usdg));
      const { d: pre } = await quoteDeposit(first.token, first.plan.out);
      await checkFeeCovered(chainId, s.address, pre.fee);

      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      const { token, t } = first;
      on("bridge", "running");
      const read = () => erc20Balance(chainId, token, s.address);
      const before = await read();
      await runRoute(s, { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount: net, user: s.address, recipient: s.address });
      const received = await waitForArrival(read, before, 10 * 60_000);
      on("bridge", "done", `${formatUnits(received, t.decimals)} ${t.symbol}`);

      on("deposit", "running");
      const n = NETS[chainId];
      const allowance = await chainClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [s.address, n.router] });
      const d = await pool.planDeposit(token, received).catch((e: unknown) => {
        const why = e instanceof Error ? e.message.replace(/\s*Nothing was sent\.?$/, "") : String(e);
        throw new ExecError(`${why} Your ${formatUnits(received, t.decimals)} ${t.symbol} is in your wallet on ${evmChain(chainId)?.names[0] ?? "the pool's chain"}.`);
      });
      await fundRequest(s, chainId, d.fee);
      if (allowance < received) await sendEvm(s, chainId, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [n.router, received] }) });
      const [held, pending] = await Promise.all([balance(s.address), pendingCount(chainId, pool.lists.deposit, s.address)]);
      await sendEvm(s, chainId, d.tx(s.address, minus(d.out, GMX_SLIPPAGE_BPS)));
      on("deposit", "done", `${formatUnits(received, t.decimals)} ${t.symbol}`);

      on("keeper", "running");
      await waitForKeeper(chainId, pool.lists.deposit, s.address, pending);
      const got = (await balance(s.address)) - held;
      if (got <= ZERO) {
        throw new ExecError(`GMX cancelled the deposit (the pool may be full or the price moved). Your ${t.symbol} is back in your wallet on ${evmChain(chainId)?.names[0] ?? "the pool's chain"}.`);
      }
      const usd = usdNum(got, await pool.price().catch(() => ZERO));
      const shown = usd > 0 ? `$${usd.toFixed(2)} of ${label}` : `${formatUnits(got, 18)} ${label}`;
      on("keeper", "done", shown);
      return shown;
    },

    withdraw: async (s, amount, on) => {
      on("withdraw", "running");
      const units = await toUnits(s.address, amount);
      if (units <= ZERO) throw new ExecError("You don't have a position in this pool.");
      const { w } = await chooseWithdraw(s.address, units);
      await checkFeeCovered(chainId, s.address, w.fee);
      await fundRequest(s, chainId, w.fee);
      const n = NETS[chainId];
      const allowance = await chainClient(chainId).readContract({ address: pool.token, abi: erc20Abi, functionName: "allowance", args: [s.address, n.router] });
      if (allowance < units) await sendEvm(s, chainId, { to: pool.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [n.router, units] }) });
      const tokens = w.outs.map((o) => o.token).filter((t, i, a) => a.findIndex((x) => same(x, t)) === i);
      const readAll = () => Promise.all(tokens.map((t) => erc20Balance(chainId, t, s.address)));
      const [before, pending] = await Promise.all([readAll(), pendingCount(chainId, pool.lists.withdraw, s.address)]);
      await sendEvm(s, chainId, w.tx(s.address));
      on("withdraw", "done");

      on("keeper", "running");
      await waitForKeeper(chainId, pool.lists.withdraw, s.address, pending);
      const after = await readAll();
      const outs = tokens.map((token, i) => ({ token, amount: after[i] - before[i] })).filter((o) => o.amount > ZERO);
      if (!outs.length) throw new ExecError(`GMX cancelled the withdrawal (the pool may be short of liquidity or the price moved). Your ${label} is back in your wallet.`);
      const legs = await payoutLegs(chainId, outs);
      on("keeper", "done", legs.map((l) => `${Number(formatUnits(l.amount, l.decimals)).toPrecision(6)} ${l.symbol}`).join(" + "));

      // Each payout token back to USDG, then Pecun's fee once on the total.
      on("bridge", "running");
      let back = ZERO;
      const left: string[] = [];
      let lastErr: unknown;
      for (const l of legs) {
        if (l.usd < DUST_USD) {
          left.push(`${formatUnits(l.amount, l.decimals)} ${l.symbol}`);
          continue;
        }
        try {
          const b0 = await usdgOf(s)();
          await runRoute(s, { from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: l.token, outToken: USDG, amount: l.amount, user: s.address, recipient: s.address });
          back += await waitForArrival(usdgOf(s), b0, 10 * 60_000);
        } catch (e) {
          lastErr = e;
          left.push(`${formatUnits(l.amount, l.decimals)} ${l.symbol}`);
        }
      }
      if (back === ZERO) throw lastErr ?? new ExecError("The payout was too small to move back.");
      on("bridge", "done", `${formatUnits(back, USDG_DECIMALS)} USDG`);
      const kept = await takeUsdgFee(s, back, on);
      const chainName = evmChain(chainId)?.names[0] ?? "the pool's chain";
      return `${formatUnits(kept, USDG_DECIMALS)} USDG${left.length ? ` (left in your wallet on ${chainName}: ${left.join(", ")})` : ""}`;
    },
  };
}

/* ---------------- registration ---------------- */

/** Catalog ids: gmx:<chainId>:<marketToken> (GM pools) and gmx-glv:<chainId>:<glvToken> (GLV vaults). */
export function gmxAdapterFor(id: string): Adapter | null {
  const [src, chain, token] = id.split(":");
  const chainId = Number(chain);
  if (!NETS[chainId] || !isAddr(token)) return null;
  if (src === "gmx") return gmxAdapter(gmPool(chainId, token), "GM");
  if (src === "gmx-glv") return gmxAdapter(glvPool(chainId, token), "GLV");
  return null;
}

registerAdapters((o) => (o.protocol === "GMX" ? gmxAdapterFor(o.id) : null));

/** Internals for scripts and tests. */
export const gmxInternals = { NETS, marketProps, gmPrice, glvPrice, glvOf, executionFee, depositAmountOut, withdrawalAmountOut, checkPoolRoom, gmPool, glvPool, pendingCount };
