"use client";

import { formatUnits, parseUnits } from "viem";
import { coinWithBalance, Transaction as SuiTx, type TransactionObjectArgument } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import {
  ExecError,
  fromSui,
  isSuiCoin,
  lazy,
  needSui,
  previewFromSui,
  previewToSui,
  registerAdapters,
  sendSui,
  suiInSteps,
  suiOutSteps,
  SUI_USDC,
  toSui,
  type Adapter,
  type Opp,
} from "../execute";
import { sui, SUI_TYPE, suiBalance } from "../sui";

/**
 * One-click for Sui lending markets: NAVI and Suilend. The route in and out (fee, Relay, LI.FI/Mayan, the swap into
 * the asset on Sui) is the shared Sui route in ../execute; this module adds each protocol's own deposit and withdraw.
 *
 * NAVI: incentive_v3::entry_deposit / entry_withdraw_v2 against NAVI's shared storage and the asset's pool. The
 * position is the user's scaled supply × the pool's supply index, read with a simulated (never sent) call.
 *
 * Suilend: lending_market::deposit_liquidity_and_mint_ctokens, which hands the user cTokens (no obligation needed),
 * and redeem_ctokens_and_withdraw_liquidity back. The position is cTokens × the reserve's cToken ratio.
 */

const RAY = BigInt(10) ** BigInt(27);
/** Sui's long-form SUI type, as protocols and APIs often write it. */
const normType = (t: string) => (isSuiCoin(t) ? SUI_TYPE : t.startsWith("0x") ? t : `0x${t}`);

/** Caches a value for `ms`, refetching after that or after a failure. */
function ttl<T>(ms: number, f: () => Promise<T>): () => Promise<T> {
  let hit: { at: number; p: Promise<T> } | null = null;
  return () => {
    if (!hit || Date.now() - hit.at > ms) {
      const p = f();
      p.catch(() => (hit = null));
      hit = { at: Date.now(), p };
    }
    return hit.p;
  };
}

/* ---------------- NAVI ---------------- */

const NAVI_API = "https://open-api.naviprotocol.io/api/navi";
/** NAVI's current objects, used if its config API is unreachable. */
const NAVI_FALLBACK = {
  package: "0x512f28261c1a293f49416d8885b8d5d32bde6dd68a99a0be36fe42b248e6833a",
  storage: "0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe",
  incentiveV2: "0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c",
  incentiveV3: "0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80",
  priceOracle: "0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef",
  oracle: {
    packageId: "0x4837ae94425107554c8847721cf9954c1ad8e10520433b9e37dc11c507148bea",
    oracleConfig: "0x1afe1cb83634f581606cc73c4487ddd8cc39a944b951283af23f7d69d5589478",
    supraOracleHolder: "0xaa0315f0748c1f24ddb2b45f7939cff40f7a8104af5ccbc4a1d32f870c0b4105",
    switchboardAggregator: "0x1fa7566f40f93cdbafd5a029a231e06664219444debb59beec2fe3f19ca08b7e",
    pythStateId: "0x03719fae774ddab3cfcaa53bbc046f0cbe21410019b6280811bf3f9f4b05839d",
    wormholeStateId: "0xdbca52b9fb4f712e25f61f974586d93ac541bcf8389564f0323bb07215168b5c",
    hermesEndpoint: "https://open-api.naviprotocol.io/api/pyth-hermes-proxy",
    feeds: [] as NaviFeed[],
  },
};
type NaviFeed = { oracleId: number; assetId: number; feedId: string; pythPriceFeedId: string; pythPriceInfoObject: string };
type NaviConfig = typeof NAVI_FALLBACK;
type NaviPool = { id: number; oracleId?: number; suiCoinType: string; token: { symbol: string; decimals: number }; contract: { pool: string }; isDeprecated?: boolean };

const naviConfig = lazy(async (): Promise<NaviConfig> => {
  const j = (await fetch(`${NAVI_API}/config?env=prod`).then((r) => r.json())) as { data?: Partial<NaviConfig> };
  const d = j.data;
  if (!d?.package || !d.storage || !d.incentiveV2 || !d.incentiveV3 || !d.priceOracle || !d.oracle?.packageId || !d.oracle.feeds?.length) throw new ExecError("NAVI's config is unavailable right now.");
  return d as NaviConfig;
});
/** Objects for building calls: NAVI's live config, or the known objects if its API is down (no oracle feeds then). */
const naviObjects = () => naviConfig().catch(() => NAVI_FALLBACK);
const naviPools = ttl(5 * 60_000, () =>
  fetch(`${NAVI_API}/pools`)
    .then((r) => r.json())
    .then((j: { data: NaviPool[] } | NaviPool[]) => (Array.isArray(j) ? j : j.data)),
);
async function naviPool(assetId: number): Promise<NaviPool> {
  const p = (await naviPools()).find((x) => x.id === assetId);
  if (!p?.contract?.pool || !p.suiCoinType) throw new ExecError("This NAVI pool isn't available right now.");
  return p;
}

/** Runs read-only Move calls in a simulation (nothing is signed or sent); returns each call's BCS return values. */
async function naviRead(user: string, build: (tx: SuiTx, c: NaviConfig) => void): Promise<Uint8Array[][]> {
  const c = await naviObjects();
  const tx = new SuiTx();
  tx.setSender(user);
  build(tx, c);
  const r = await sui().simulateTransaction({ transaction: tx, include: { commandResults: true }, checksEnabled: false });
  if (!r.commandResults) throw new ExecError("Couldn't read your NAVI position.");
  return r.commandResults.map((x) => x.returnValues.map((v) => v.bcs));
}

/** The user's supply in the asset's own units (NAVI keeps balances at 9 decimals internally). */
export async function naviSupplied(user: string, assetId: number, decimals: number): Promise<bigint> {
  const res = await naviRead(user, (tx, c) => {
    tx.moveCall({ target: `${c.package}::storage::get_user_balance`, arguments: [tx.object(c.storage), tx.pure.u8(assetId), tx.pure.address(user)] });
    tx.moveCall({ target: `${c.package}::storage::get_index`, arguments: [tx.object(c.storage), tx.pure.u8(assetId)] });
  });
  const scaled = BigInt(bcs.u256().parse(res[0][0]));
  if (scaled === BigInt(0)) return BigInt(0);
  const nine = (scaled * BigInt(bcs.u256().parse(res[1][0]))) / RAY;
  return decimals === 9 ? nine : decimals > 9 ? nine * BigInt(10) ** BigInt(decimals - 9) : nine / BigInt(10) ** BigInt(9 - decimals);
}

/** Every asset the user supplies or borrows on NAVI: a withdrawal re-checks their health, which prices all of them. */
export async function naviUserAssets(user: string): Promise<number[]> {
  const res = await naviRead(user, (tx, c) => {
    tx.moveCall({ target: `${c.package}::storage::get_user_assets`, arguments: [tx.object(c.storage), tx.pure.address(user)] });
  });
  const ids = res[0].flatMap((b) => bcs.vector(bcs.u8()).parse(b));
  return [...new Set(ids)];
}

/** Deposit `amount` of the asset into NAVI. Exported for scripts. */
export async function naviDepositTx(assetId: number, amount: bigint, tx = new SuiTx()): Promise<SuiTx> {
  const [c, p] = await Promise.all([naviObjects(), naviPool(assetId)]);
  const coinType = normType(p.suiCoinType);
  tx.moveCall({
    target: `${c.package}::incentive_v3::entry_deposit`,
    typeArguments: [coinType],
    arguments: [
      tx.object.clock(),
      tx.object(c.storage),
      tx.object(p.contract.pool),
      tx.pure.u8(assetId),
      coinWithBalance({ type: coinType, balance: amount }),
      tx.pure.u64(amount),
      tx.object(c.incentiveV2),
      tx.object(c.incentiveV3),
    ],
  });
  return tx;
}

/* Pyth pushes: some feeds (BUCK, NAVX, NS, IKA, ...) sit unpushed on Sui for long stretches, and NAVI won't price an
 * account with a stale Pyth price. Stale feeds are pushed in the same PTB from Hermes (through NAVI's public proxy,
 * which needs no key), the same calls Pyth's Sui SDK makes; that SDK itself is Node-only (node:buffer). */
const PYTH_STALE_S = 30;
const PYTH_MAX_ARG = 16 * 1024;

/** Reads `upgrade_cap.package` from a Pyth or Wormhole state object: the package to call. */
const statePackage = (id: string) =>
  sui()
    .getObject({ objectId: id, include: { json: true } })
    .then(({ object }) => {
      const cap = (object.json as { upgrade_cap?: { package?: string; fields?: { package?: string } } } | null)?.upgrade_cap;
      const pkg = cap?.package ?? cap?.fields?.package;
      if (!pkg) throw new ExecError("Couldn't read Pyth's on-chain setup.");
      return { pkg, json: object.json as Record<string, unknown> };
    });

const b64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const vecU8 = (b: Uint8Array) => bcs.vector(bcs.u8()).serialize(Array.from(b), { maxSize: PYTH_MAX_ARG }).toBytes();

/** Feeds whose on-chain Pyth price is older than PYTH_STALE_S. */
async function stalePyth(feeds: NaviFeed[]): Promise<NaviFeed[]> {
  if (!feeds.length) return [];
  const { objects } = await sui().getObjects({ objectIds: feeds.map((f) => f.pythPriceInfoObject), include: { json: true } });
  const now = Date.now() / 1000;
  return feeds.filter((f, i) => {
    const o = objects[i];
    if (o instanceof Error) return true;
    const ts = Number((o.json as { price_info?: { price_feed?: { price?: { timestamp?: string } } } } | null)?.price_info?.price_feed?.price?.timestamp ?? 0);
    return now - ts > PYTH_STALE_S;
  });
}

/** Adds Pyth price pushes for `feeds` to `tx`, paid from the gas coin (Pyth's base fee per feed). */
async function pushPyth(tx: SuiTx, c: NaviConfig, feeds: NaviFeed[]) {
  if (!feeds.length) return;
  const q = feeds.map((f) => `ids[]=${f.pythPriceFeedId}`).join("&");
  const hermes = async (base: string) => {
    const r = await fetch(`${base}/v2/updates/price/latest?${q}&encoding=base64&parsed=false`);
    const j = (await r.json()) as { binary?: { data?: string[] } };
    if (!j.binary?.data?.[0]) throw new Error(`Hermes ${r.status}`);
    return j.binary.data[0];
  };
  const update = b64(await hermes(c.oracle.hermesEndpoint).catch(() => hermes("https://hermes.pyth.network")).catch(() => {
    throw new ExecError("Couldn't fetch fresh prices for NAVI right now. Try again in a moment.");
  }));
  // Accumulator message: "PNAU", major, minor, trailing size, trailing bytes, proof type, then a u16 VAA length + VAA.
  const vaaAt = 7 + update[6] + 1;
  const vaa = update.subarray(vaaAt + 2, vaaAt + 2 + ((update[vaaAt] << 8) | update[vaaAt + 1]));
  const [pyth, wormhole] = await Promise.all([statePackage(c.oracle.pythStateId), statePackage(c.oracle.wormholeStateId)]);
  const fee = BigInt(String(pyth.json.base_update_fee ?? "1"));
  const [verified] = tx.moveCall({ target: `${wormhole.pkg}::vaa::parse_and_verify`, arguments: [tx.object(c.oracle.wormholeStateId), tx.pure(vecU8(vaa)), tx.object.clock()] });
  let [potato] = tx.moveCall({
    target: `${pyth.pkg}::pyth::create_authenticated_price_infos_using_accumulator`,
    arguments: [tx.object(c.oracle.pythStateId), tx.pure(vecU8(update)), verified, tx.object.clock()],
  });
  const coins = tx.splitCoins(tx.gas, feeds.map(() => tx.pure.u64(fee)));
  feeds.forEach((f, i) => {
    [potato] = tx.moveCall({
      target: `${pyth.pkg}::pyth::update_single_price_feed`,
      arguments: [tx.object(c.oracle.pythStateId), potato, tx.object(f.pythPriceInfoObject), coins[i], tx.object.clock()],
    });
  });
  tx.moveCall({ target: `${pyth.pkg}::hot_potato_vector::destroy`, typeArguments: [`${pyth.pkg}::price_info::PriceInfo`], arguments: [potato] });
}

/**
 * Withdraw `amount` (asset units; NAVI caps it at the user's supply) to the sender. NAVI prices the user's whole
 * account on a withdrawal, so the PTB first refreshes NAVI's oracle for each of `priced` (the withdrawn asset plus
 * whatever else the user holds there), pushing fresh Pyth prices first for any feed that has gone stale on chain.
 * Exported for scripts.
 */
export async function naviWithdrawTx(assetId: number, amount: bigint, priced: number[] = [assetId], tx = new SuiTx()): Promise<SuiTx> {
  const [c, p, pools] = await Promise.all([naviConfig(), naviPool(assetId), naviPools()]);
  const feeds = [...new Set([assetId, ...priced])].map((id) => {
    const oracleId = pools.find((x) => x.id === id)?.oracleId ?? id;
    const f = c.oracle.feeds.find((x) => x.oracleId === oracleId) ?? c.oracle.feeds.find((x) => x.assetId === id);
    if (!f) throw new ExecError("NAVI's price feed for this asset isn't available right now.");
    return f;
  });
  await pushPyth(tx, c, await stalePyth(feeds));
  for (const f of feeds) {
    tx.moveCall({
      target: `${c.oracle.packageId}::oracle_pro::update_single_price_v3`,
      arguments: [
        tx.object.clock(),
        tx.object(c.oracle.oracleConfig),
        tx.object(c.priceOracle),
        tx.object(c.oracle.supraOracleHolder),
        tx.object(f.pythPriceInfoObject),
        tx.object(c.oracle.switchboardAggregator),
        tx.pure.address(f.feedId),
      ],
    });
  }
  tx.moveCall({
    target: `${c.package}::incentive_v3::entry_withdraw_v2`,
    typeArguments: [normType(p.suiCoinType)],
    arguments: [
      tx.object.clock(),
      tx.object(c.priceOracle),
      tx.object(c.storage),
      tx.object(p.contract.pool),
      tx.pure.u8(assetId),
      tx.pure.u64(amount),
      tx.object(c.incentiveV2),
      tx.object(c.incentiveV3),
      tx.object("0x5"),
    ],
  });
  return tx;
}

/** NAVI's native USDC pool: already the route's stepping stone on Sui, so there is no swap step. */
const NAVI_USDC_POOL = 10;

function navi(assetId: number, symbol: string): Adapter {
  const stepType = assetId === NAVI_USDC_POOL ? SUI_USDC : "";
  const meta = lazy(async () => {
    const p = await naviPool(assetId);
    return { coinType: normType(p.suiCoinType), decimals: p.token.decimals };
  });
  return {
    positionSymbol: symbol,
    depositSteps: suiInSteps(stepType, symbol, "Deposit"),
    withdrawSteps: suiOutSteps(stepType, symbol, "Withdraw"),

    position: async (s) => {
      if (!s.suiAddress) return 0;
      const m = await meta();
      return Number(formatUnits(await naviSupplied(s.suiAddress, assetId, m.decimals), m.decimals));
    },
    previewDeposit: async (s, usdg) => previewToSui(s, usdg, (await meta()).coinType),
    previewWithdraw: async (s, amount) => {
      const m = await meta();
      return previewFromSui(s, m.coinType, parseUnits(amount, m.decimals));
    },

    deposit: async (s, usdg, on) => {
      const m = await meta();
      const got = await toSui(s, usdg, m.coinType, m.decimals, symbol, on);
      on("deposit", "running");
      await sendSui(s, () => naviDepositTx(assetId, got), isSuiCoin(m.coinType) ? got : BigInt(0));
      on("deposit", "done");
      return `${formatUnits(got, m.decimals)} ${symbol}`;
    },

    withdraw: async (s, amount, on) => {
      const me = needSui(s);
      const m = await meta();
      on("withdraw", "running");
      const held = await naviSupplied(me, assetId, m.decimals);
      if (held === BigInt(0)) throw new ExecError("You don't have a position in this vault.");
      const want = amount === "max" ? held : parseUnits(amount, m.decimals);
      // NAVI caps a withdrawal at the user's supply (it rejects u64::MAX), so "max" asks for a little more than the
      // supply read moments ago, covering interest accrued since.
      const ask = amount === "max" || want >= held ? held + held / BigInt(1000) + BigInt(1000) : want;
      const priced = await naviUserAssets(me);
      const read = () => suiBalance(me, m.coinType);
      const before = await read();
      await sendSui(s, () => naviWithdrawTx(assetId, ask, priced));
      // For SUI this is net of the network fee, which is paid from the same balance.
      const out = (await read()) - before;
      if (out <= BigInt(0)) throw new ExecError("The vault didn't release any funds. It may be short of liquidity right now.");
      on("withdraw", "done", `${formatUnits(out, m.decimals)} ${symbol}`);
      return fromSui(s, m.coinType, out, on);
    },
  };
}

/* ---------------- Suilend ---------------- */

/*
 * Built from Suilend's own objects with plain Move calls rather than @suilend/sdk's client, which pulls in Pyth's
 * Node-only client (node:buffer) and so can't load in the browser. The calls match what the SDK builds.
 */
/** Suilend's original package id: its types (the MAIN_POOL market, CToken, RateLimiterExemption) live here. */
const SL_ORIGIN = "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf";
const SL_MARKET = "0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1";
const SL_POOL = `${SL_ORIGIN}::suilend::MAIN_POOL`;
/** Suilend's UpgradeCap names the current package, which is where calls go after an upgrade. */
const SL_UPGRADE_CAP = "0x3d4ef1859c3ee9fc72858f588b56a09da5466e64f8cc4e90a7b3b909fba8a7ae";
const SL_PACKAGE_FALLBACK = "0xcb4f73954ee5b1429af01cd19e4175e3a93c4df3a663a65d79912b92599eb729";

const suilendPackage = ttl(10 * 60_000, () =>
  sui()
    .getObject({ objectId: SL_UPGRADE_CAP, include: { json: true } })
    .then(({ object }) => {
      const pkg = (object.json as { package?: unknown } | null)?.package;
      if (typeof pkg !== "string" || !/^0x[0-9a-f]{64}$/.test(pkg)) throw new Error("bad UpgradeCap");
      return pkg;
    })
    .catch(() => SL_PACKAGE_FALLBACK),
);

type ReserveJson = { coin_type: string; mint_decimals: number | string; ctoken_supply: string; available_amount: string; borrowed_amount: { value: string }; unclaimed_spread_fees: { value: string } };
/** The main market's reserves, re-read at most once a minute so the cToken ratio stays current. */
const suilendReserves = ttl(60_000, async () => {
  const { object } = await sui().getObject({ objectId: SL_MARKET, include: { json: true } });
  const reserves = (object.json as { reserves?: ReserveJson[] } | null)?.reserves;
  if (!reserves?.length) throw new ExecError("Suilend's market isn't available right now.");
  return reserves;
});

const WAD = BigInt(10) ** BigInt(18);
/** Compares coin types however their addresses are padded. */
const sameType = (a: string, b: string) => {
  const n = (t: string) => {
    const [addr, ...rest] = t.replace(/^0x/, "").split("::");
    return `${addr.replace(/^0+/, "") || "0"}::${rest.join("::")}`.toLowerCase();
  };
  return n(a) === n(b);
};

async function suilendReserve(coinType: string) {
  const reserves = await suilendReserves();
  const i = reserves.findIndex((r) => sameType(r.coin_type, coinType));
  if (i < 0) throw new ExecError("This Suilend reserve isn't available right now.");
  const r = reserves[i];
  // cToken ratio, kept as a fraction: (available + borrowed − unclaimed fees) / cToken supply, in WAD.
  const total = BigInt(r.available_amount) * WAD + BigInt(r.borrowed_amount.value) - BigInt(r.unclaimed_spread_fees.value);
  return { index: BigInt(i), decimals: Number(r.mint_decimals), total, supply: BigInt(r.ctoken_supply) };
}

const cTokenType = (coinType: string) => `${SL_ORIGIN}::reserve::CToken<${SL_POOL}, ${coinType}>`;

/** cTokens → asset units, rounded down. */
const ctokensToAsset = (ct: bigint, r: { total: bigint; supply: bigint }) => (r.supply === BigInt(0) ? ct : (ct * r.total) / (r.supply * WAD));

/** Mints cTokens for `amount` of the asset inside `tx`; returns the cToken coin. Exported for scripts. */
export async function suilendMint(tx: SuiTx, coinType: string, amount: bigint) {
  const [r, pkg] = await Promise.all([suilendReserve(coinType), suilendPackage()]);
  const [ctokens] = tx.moveCall({
    target: `${pkg}::lending_market::deposit_liquidity_and_mint_ctokens`,
    typeArguments: [SL_POOL, coinType],
    arguments: [tx.object(SL_MARKET), tx.pure.u64(r.index), tx.object.clock(), coinWithBalance({ type: coinType, balance: amount })],
  });
  return ctokens;
}

/** Deposit `amount` into Suilend; the cTokens go to `owner`. */
async function suilendDepositTx(owner: string, coinType: string, amount: bigint) {
  const tx = new SuiTx();
  tx.transferObjects([await suilendMint(tx, coinType, amount)], tx.pure.address(owner));
  return tx;
}

/**
 * Redeem `ctokens` (an amount from the wallet, or a coin from earlier in the PTB) for the asset, sent to `owner`.
 * SUI reserves stake part of their liquidity, so a SUI redemption first unstakes what the request needs.
 * Exported for scripts.
 */
export async function suilendRedeemTx(owner: string, coinType: string, ctokens: bigint | TransactionObjectArgument, tx = new SuiTx()) {
  const [r, pkg] = await Promise.all([suilendReserve(coinType), suilendPackage()]);
  const coin = typeof ctokens === "bigint" ? coinWithBalance({ type: cTokenType(coinType), balance: ctokens, useGasCoin: false }) : ctokens;
  const exemption = tx.moveCall({ target: "0x1::option::none", typeArguments: [`${SL_ORIGIN}::lending_market::RateLimiterExemption<${SL_POOL}, ${coinType}>`] });
  const [request] = tx.moveCall({
    target: `${pkg}::lending_market::redeem_ctokens_and_withdraw_liquidity_request`,
    typeArguments: [SL_POOL, coinType],
    arguments: [tx.object(SL_MARKET), tx.pure.u64(r.index), tx.object.clock(), coin, exemption],
  });
  if (isSuiCoin(coinType)) {
    tx.moveCall({ target: `${pkg}::lending_market::unstake_sui_from_staker`, typeArguments: [SL_POOL], arguments: [tx.object(SL_MARKET), tx.pure.u64(r.index), request, tx.object("0x5")] });
  }
  const [out] = tx.moveCall({ target: `${pkg}::lending_market::fulfill_liquidity_request`, typeArguments: [SL_POOL, coinType], arguments: [tx.object(SL_MARKET), tx.pure.u64(r.index), request] });
  tx.transferObjects([out], tx.pure.address(owner));
  return tx;
}

function suilend(rawType: string, symbol: string): Adapter {
  const coinType = normType(rawType);
  const decimals = lazy(async () => (await suilendReserve(coinType)).decimals);
  const ctBalance = (owner: string) => suiBalance(owner, cTokenType(coinType));
  const held = async (owner: string) => {
    const ct = await ctBalance(owner);
    if (ct === BigInt(0)) return { ct, asset: BigInt(0), r: null };
    const r = await suilendReserve(coinType);
    return { ct, asset: ctokensToAsset(ct, r), r };
  };
  return {
    positionSymbol: symbol,
    depositSteps: suiInSteps(coinType, symbol, "Deposit"),
    withdrawSteps: suiOutSteps(coinType, symbol, "Withdraw"),

    position: async (s) => {
      if (!s.suiAddress) return 0;
      const h = await held(s.suiAddress);
      return h.r ? Number(formatUnits(h.asset, h.r.decimals)) : 0;
    },
    previewDeposit: (s, usdg) => previewToSui(s, usdg, coinType),
    previewWithdraw: async (s, amount) => previewFromSui(s, coinType, parseUnits(amount, await decimals())),

    deposit: async (s, usdg, on) => {
      const dec = await decimals();
      const got = await toSui(s, usdg, coinType, dec, symbol, on);
      on("deposit", "running");
      const me = needSui(s);
      const before = await ctBalance(me);
      await sendSui(s, () => suilendDepositTx(me, coinType, got), isSuiCoin(coinType) ? got : BigInt(0));
      if ((await ctBalance(me)) <= before) throw new ExecError("Suilend didn't accept the deposit. Your funds are still in your wallet.");
      on("deposit", "done");
      return `${formatUnits(got, dec)} ${symbol}`;
    },

    withdraw: async (s, amount, on) => {
      const me = needSui(s);
      on("withdraw", "running");
      const h = await held(me);
      if (!h.r) throw new ExecError("You don't have a position in this vault.");
      let take = h.ct;
      if (amount !== "max") {
        // cTokens for the requested amount, rounded up and capped at what the user holds.
        const want = parseUnits(amount, h.r.decimals);
        const ct = h.r.supply === BigInt(0) ? want : (want * h.r.supply * WAD + h.r.total - BigInt(1)) / h.r.total;
        if (ct < take) take = ct;
      }
      const read = () => suiBalance(me, coinType);
      const before = await read();
      await sendSui(s, () => suilendRedeemTx(me, coinType, take));
      const out = (await read()) - before;
      if (out <= BigInt(0)) throw new ExecError("The vault didn't release any funds. It may be short of liquidity right now.");
      on("withdraw", "done", `${formatUnits(out, h.r.decimals)} ${symbol}`);
      return fromSui(s, coinType, out, on);
    },
  };
}

/* ---------------- registration ---------------- */

/** Assets with no swap route from USDC on Sui right now, so one-click can't reach them. */
const NO_ROUTE = new Set<string>([]);

export function suiLendingAdapter(o: Opp): Adapter | null {
  if (o.chain !== "Sui") return null;
  if (o.protocol === "NAVI" && o.id.startsWith("navi:sui:")) {
    const id = Number(o.id.slice("navi:sui:".length));
    if (!Number.isInteger(id) || id < 0 || id > 255 || NO_ROUTE.has(`navi:${o.asset}`)) return null;
    return navi(id, o.asset);
  }
  if (o.protocol === "Suilend" && o.id.startsWith("suilend:sui:")) {
    const coinType = o.id.slice("suilend:sui:".length);
    if (!/^0x[0-9a-fA-F]+::\w+::\w+$/.test(coinType) || NO_ROUTE.has(`suilend:${o.asset}`)) return null;
    return suilend(coinType, o.asset);
  }
  return null;
}

registerAdapters(suiLendingAdapter);
