"use client";

import { bcs } from "@mysten/sui/bcs";
import { coinWithBalance, Transaction as SuiTx } from "@mysten/sui/transactions";
import { encodeFunctionData, erc20Abi, formatUnits, parseAbi, parseUnits, zeroAddress, type Address } from "viem";
import {
  backToUsdg,
  chainClient,
  erc20Balance,
  ExecError,
  fromSui,
  IN_STEPS,
  isAddr,
  isSuiCoin,
  lazy,
  needSui,
  netOfFee,
  planRoute,
  previewFromSui,
  previewToSui,
  registerAdapters,
  routeInto,
  runRoute,
  sendEvm,
  sendSui,
  SUI_GAS,
  suiInSteps,
  suiOutSteps,
  takeUsdgFee,
  tokenMeta,
  toSui,
  waitForArrival,
  type Adapter,
  type Opp,
} from "../execute";
import { sui, SUI_TYPE, suiBalance } from "../sui";
import { ROBINHOOD_CHAIN_ID, USDG, USDG_DECIMALS } from "../wallet";
import { arrivedFor, catalogWait, noteBroughtHome, noteRequested, queuedSteps, requestedAt, requestedMessage, wanted } from "./queued";

/**
 * Ember (Bluefin's vaults). EVM vaults are ERC-4626-style for deposits (`deposit(assets, receiver)`, or the vault's
 * deposit "parking lot" when it takes deposits asynchronously); withdrawals are a queued `redeemShares` that Ember's
 * operator pays out later. Sui vaults use Ember's Move package (`gateway::deposit_asset_v2` / `gateway::redeem_shares`),
 * reached through the shared Sui route (USDC → USDC on Base → USDC on Sui → swap into the vault coin).
 *
 * Ember's API doesn't allow browser calls, so everything is read on-chain.
 */

/* ---------------- EVM ---------------- */

const EMBER_EVM: Record<string, number> = { ethereum: 1, base: 8453, monad: 143, arbitrum: 42161 };
const CHAIN_NAME: Record<number, string> = { 1: "Ethereum", 8453: "Base", 143: "Monad", 42161: "Arbitrum" };

const VAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function convertToShares(uint256) view returns (uint256)",
  "function minWithdrawableShares() view returns (uint256)",
  "function parkingLot() view returns (address)",
  "function pauseStatus() view returns (bool deposits, bool withdrawals, bool privilegedOperations)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function getAccountState(address) view returns (uint256 totalPendingWithdrawalShares, uint256[] pending, uint256[] cancelling)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeemShares(uint256 shares, address receiver) returns ((address owner, address receiver, uint256 shares, uint256 estimatedWithdrawAmount, uint256 timestamp, uint256 sequenceNumber))",
]);
const PARKING_ABI = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function depositAllowListCount() view returns (uint256)",
  "function isDepositAllowed(address) view returns (bool)",
  "function getPendingDepositsLength() view returns (uint256)",
  "function getPendingDeposit(uint256 index) view returns ((address depositor, address receiver, uint256 assets, uint256 timestamp))",
]);

function emberEvm(chainId: number, vault: Address, symbol: string, wait: string): Adapter {
  const c = () => chainClient(chainId);
  const read = <T,>(functionName: string, args: unknown[] = []) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c().readContract({ address: vault, abi: VAULT_ABI, functionName: functionName as any, args: args as any }) as Promise<T>;
  const asset = lazy(async () => tokenMeta(chainId, await read<Address>("asset")));
  const lot = lazy(async () => {
    const a = await read<Address>("parkingLot").catch(() => zeroAddress);
    return a === zeroAddress ? null : a;
  });
  const toAssets = async (shares: bigint) => (shares > BigInt(0) ? read<bigint>("convertToAssets", [shares]) : BigInt(0));
  const paused = () => read<readonly [boolean, boolean, boolean]>("pauseStatus").catch(() => [false, false, false] as const);

  /** Deposits still waiting in the parking lot for this receiver. */
  const parked = async (owner: Address): Promise<bigint> => {
    const p = await lot();
    if (!p) return BigInt(0);
    // getPendingDeposit indexes the live queue from 0 (already processed requests are gone). It is short; cap the scan.
    const len = await c().readContract({ address: p, abi: PARKING_ABI, functionName: "getPendingDepositsLength" });
    const n = Number(len > BigInt(200) ? BigInt(200) : len);
    const reqs = await Promise.all(Array.from({ length: n }, (_, i) => c().readContract({ address: p, abi: PARKING_ABI, functionName: "getPendingDeposit", args: [BigInt(i)] }).catch(() => null)));
    return reqs.reduce((t, r) => (r && r.receiver.toLowerCase() === owner.toLowerCase() ? t + r.assets : t), BigInt(0));
  };

  const state = async (owner: Address) => {
    const [a, shares, acct, inLot] = await Promise.all([asset(), read<bigint>("balanceOf", [owner]), read<readonly [bigint, readonly bigint[], readonly bigint[]]>("getAccountState", [owner]), parked(owner)]);
    const [held, pending, idle] = await Promise.all([toAssets(shares), toAssets(acct[0]), erc20Balance(chainId, a.address, owner)]);
    return { a, shares, held, pending, inLot, arrived: arrivedFor(vault, owner, idle, pending) };
  };

  const where = CHAIN_NAME[chainId] ?? "the vault's chain";
  return {
    positionSymbol: symbol,
    depositSteps: IN_STEPS,
    withdrawSteps: queuedSteps("Ember", wait),

    position: async (s) => {
      const st = await state(s.address);
      return Number(formatUnits(st.held + st.pending + st.inLot + st.arrived, st.a.decimals));
    },

    previewDeposit: async (s, usdg) => {
      const a = await asset();
      if ((await paused())[0]) throw new ExecError("Ember has paused deposits into this vault.");
      return (await planRoute({ from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: a.address, amount: netOfFee(usdg), user: s.address, recipient: s.address }, a.symbol)).preview;
    },
    previewWithdraw: async (s, amount) => {
      const a = await asset();
      return (await planRoute({ from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: a.address, outToken: USDG, amount: parseUnits(amount, a.decimals), user: s.address, recipient: s.address }, "USDC")).preview;
    },

    deposit: async (s, usdg, on) => {
      const a = await asset();
      const p = await lot();
      if ((await paused())[0]) throw new ExecError("Ember has paused deposits into this vault. Nothing was sent.");
      if (p) {
        // Async vault: deposits wait in Ember's parking lot until the operator moves them in.
        const [lotPaused, listed] = await Promise.all([
          c().readContract({ address: p, abi: PARKING_ABI, functionName: "depositsPaused" }),
          c().readContract({ address: p, abi: PARKING_ABI, functionName: "depositAllowListCount" }),
        ]);
        if (lotPaused) throw new ExecError("Ember has paused deposits into this vault. Nothing was sent.");
        if (listed > BigInt(0) && !(await c().readContract({ address: p, abi: PARKING_ABI, functionName: "isDepositAllowed", args: [s.address] })))
          throw new ExecError("This Ember vault only takes deposits from approved wallets. Nothing was sent.");
      }
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const got = await routeInto(s, { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: a.address, amount: net, user: s.address, recipient: s.address });
      on("bridge", "done", `${formatUnits(got, a.decimals)} ${a.symbol}`);

      on("deposit", "running");
      const spender = p ?? vault;
      const allowance = await c().readContract({ address: a.address, abi: erc20Abi, functionName: "allowance", args: [s.address, spender] });
      if (allowance < got) await sendEvm(s, chainId, { to: a.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, got] }) });
      const sharesBefore = await read<bigint>("balanceOf", [s.address]);
      await sendEvm(s, chainId, { to: spender, data: encodeFunctionData({ abi: p ? PARKING_ABI : VAULT_ABI, functionName: "deposit", args: [got, s.address] }) });
      if (!p && (await read<bigint>("balanceOf", [s.address])) <= sharesBefore) throw new ExecError("The vault didn't accept the deposit. Your funds are still in your wallet.");
      on("deposit", "done", p ? "Queued: Ember moves it into the vault shortly" : undefined);
      return `${formatUnits(got, a.decimals)} ${a.symbol}${p ? " (Ember adds it to the vault shortly)" : ""}`;
    },

    withdraw: async (s, amount, on) => {
      on("withdraw", "running");
      const st = await state(s.address);
      const { a } = st;
      const want = wanted(amount, a.decimals, st.held + st.pending + st.arrived);
      // Anything Ember already paid out comes home first; the rest is requested from the vault.
      const fromVault = want > st.arrived ? want - st.arrived : BigInt(0);
      let requested = BigInt(0);
      if (fromVault > BigInt(0) && st.shares > BigInt(0)) {
        const min = await read<bigint>("minWithdrawableShares").catch(() => BigInt(0));
        let shares = amount === "max" || fromVault >= st.held ? st.shares : (await read<bigint>("convertToShares", [fromVault])) + BigInt(1);
        if (shares > st.shares) shares = st.shares;
        if (st.shares - shares < min) shares = st.shares; // don't leave a remainder Ember won't let you withdraw later
        if (shares < min) throw new ExecError(`Ember's minimum withdrawal for this vault is ${formatUnits(await toAssets(min), a.decimals)} ${a.symbol}.`);
        if ((await paused())[1]) throw new ExecError("Ember has paused withdrawals from this vault for now. Nothing was sent.");
        requested = await toAssets(shares);
        // redeemShares pulls the shares into the vault's queue with transferFrom, so the vault needs an allowance.
        if ((await read<bigint>("allowance", [s.address, vault])) < shares)
          await sendEvm(s, chainId, { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "approve", args: [vault, shares] }) });
        await sendEvm(s, chainId, { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "redeemShares", args: [shares, s.address] }) });
        noteRequested(vault, s.address, requested);
        on("withdraw", "done", `${formatUnits(requested, a.decimals)} ${a.symbol} requested`);
      } else if (st.arrived === BigInt(0)) {
        if (st.pending > BigInt(0)) throw new ExecError(`Your withdrawal of ${formatUnits(st.pending, a.decimals)} ${a.symbol} is still in Ember's queue${wait ? ` (${wait})` : ""}. Press Withdraw again once it's paid out.`);
        if (st.inLot > BigInt(0)) throw new ExecError("Your deposit is still waiting to enter the vault. You can withdraw once Ember moves it in.");
        throw new ExecError("You don't have a position in this vault.");
      } else {
        on("withdraw", "skipped");
      }

      if (st.arrived === BigInt(0)) {
        on("bridge", "skipped");
        on("fee", "skipped");
        return requestedMessage(requested, a.decimals, a.symbol, "Ember", wait, where);
      }
      const result = await backToUsdg(s, { from: chainId, inToken: a.address, amount: st.arrived, user: s.address }, on);
      noteBroughtHome(vault, s.address, st.arrived);
      return requested > BigInt(0) ? `${result}. ${requestedMessage(requested, a.decimals, a.symbol, "Ember", wait, where)}` : result;
    },

    queue: async (s) => {
      const st = await state(s.address);
      return {
        symbol: st.a.symbol,
        pending: Number(formatUnits(st.pending, st.a.decimals)),
        arrived: Number(formatUnits(st.arrived, st.a.decimals)),
        wait,
        requestedAt: requestedAt(vault, s.address),
      };
    },

    bringHome: async (s, on) => {
      const st = await state(s.address);
      if (st.arrived === BigInt(0)) return null;
      on("withdraw", "skipped");
      const result = await backToUsdg(s, { from: chainId, inToken: st.a.address, amount: st.arrived, user: s.address }, on);
      noteBroughtHome(vault, s.address, st.arrived);
      return result;
    },
  };
}

/* ---------------- Sui ---------------- */

/** Ember's Move package is upgradeable: its UpgradeCap names the current package, so new versions are picked up. */
const EMBER_UPGRADE_CAP = "0x298c2d3e0449655cb48b3d5599ea124bf47690e8eab175a7458c3d2ce3bdcefb";
const EMBER_CONFIG = "0x3a515233ab817af082ef31454cee5eb8122b8b7cd586bf6b26ae9b879ee1e565";
const EMBER_PACKAGE_FALLBACK = "0x382b95f3009212dd0aa06e1e7d6090091bcee4326598f5008db30f67a6fe30f9";
const RATE_UNIT = BigInt(1_000_000_000); // rate = receipt shares per unit of deposit coin, × 1e9

const emberPackage = lazy(async () => {
  const r = await sui().core.getObject({ objectId: EMBER_UPGRADE_CAP, include: { json: true } });
  return ((r.object?.json as { package?: string } | null)?.package ?? EMBER_PACKAGE_FALLBACK) as string;
});

type SuiVault = { coin: string; receipt: string; rate: bigint; minShares: bigint; paused: boolean; accounts: string };

async function suiVault(id: string): Promise<SuiVault> {
  const r = await sui().core.getObject({ objectId: id, include: { json: true } });
  const m = r.object?.type?.match(/::vault::Vault<(.+),\s*(.+)>$/);
  if (!m) throw new ExecError("This Ember vault isn't available right now.");
  const j = r.object.json as { rate: { value: string }; min_withdrawal_shares: string; paused: boolean; accounts: { id: string } };
  return { coin: isSuiCoin(m[1]) ? SUI_TYPE : m[1], receipt: m[2], rate: BigInt(j.rate.value), minShares: BigInt(j.min_withdrawal_shares ?? "0"), paused: !!j.paused, accounts: j.accounts.id };
}

/** Shares the user has waiting in Ember's withdrawal queue. */
async function suiPendingShares(v: SuiVault, owner: string): Promise<bigint> {
  try {
    const f = await sui().core.getDynamicField({ parentId: v.accounts, name: { type: "address", bcs: bcs.Address.serialize(owner).toBytes() } });
    const o = await sui().core.getObject({ objectId: f.dynamicField.fieldId, include: { json: true } });
    return BigInt((o.object?.json as { value?: { total_pending_withdrawal_shares?: string } } | null)?.value?.total_pending_withdrawal_shares ?? "0");
  } catch {
    return BigInt(0); // no account record yet
  }
}

function emberSui(vaultId: string, symbol: string, decimals: number, coinType: string, wait: string): Adapter {
  const v = () => suiVault(vaultId);
  const toAssets = (shares: bigint, rate: bigint) => (rate > BigInt(0) ? (shares * RATE_UNIT) / rate : BigInt(0));
  const state = async (owner: string) => {
    const vault = await v();
    const [shares, pendingShares, idle] = await Promise.all([suiBalance(owner, vault.receipt), suiPendingShares(vault, owner), suiBalance(owner, vault.coin)]);
    // On SUI vaults, keep the gas the tank sent out of what counts as paid out.
    const spendable = vault.coin === SUI_TYPE ? (idle > SUI_GAS * BigInt(2) ? idle - SUI_GAS * BigInt(2) : BigInt(0)) : idle;
    const pending = toAssets(pendingShares, vault.rate);
    return { vault, shares, held: toAssets(shares, vault.rate), pending, arrived: arrivedFor(vaultId, owner, spendable, pending) };
  };

  return {
    positionSymbol: symbol,
    depositSteps: suiInSteps(coinType, symbol, "Deposit"),
    withdrawSteps: [...queuedSteps("Ember", wait).slice(0, 1), ...suiOutSteps(coinType, symbol)],

    position: async (s) => {
      if (!s.suiAddress) return 0;
      const st = await state(s.suiAddress);
      return Number(formatUnits(st.held + st.pending + st.arrived, decimals));
    },
    previewDeposit: (s, usdg) => previewToSui(s, usdg, coinType),
    previewWithdraw: (s, amount) => previewFromSui(s, coinType, parseUnits(amount, decimals)),

    deposit: async (s, usdg, on) => {
      const vault = await v();
      if (vault.paused) throw new ExecError("Ember has paused this vault. Nothing was sent.");
      const got = await toSui(s, usdg, coinType, decimals, symbol, on);
      on("deposit", "running");
      const pkg = await emberPackage();
      const me = needSui(s);
      await sendSui(
        s,
        async () => {
          const fresh = await v(); // the rate may have moved while the funds travelled
          const minShares = (got * fresh.rate * BigInt(99)) / (RATE_UNIT * BigInt(100));
          const tx = new SuiTx();
          tx.moveCall({
            target: `${pkg}::gateway::deposit_asset_v2`,
            typeArguments: [fresh.coin, fresh.receipt],
            arguments: [tx.object(vaultId), tx.object(EMBER_CONFIG), coinWithBalance({ type: fresh.coin, balance: got }), tx.pure.u64(minShares), tx.pure.vector("address", [me]), tx.object.clock()],
          });
          return tx;
        },
        vault.coin === SUI_TYPE ? got : BigInt(0),
      );
      on("deposit", "done");
      return `${formatUnits(got, decimals)} ${symbol}`;
    },

    withdraw: async (s, amount, on) => {
      const me = needSui(s);
      on("withdraw", "running");
      const st = await state(me);
      const want = wanted(amount, decimals, st.held + st.pending + st.arrived);
      const fromVault = want > st.arrived ? want - st.arrived : BigInt(0);
      let requested = BigInt(0);
      if (fromVault > BigInt(0) && st.shares > BigInt(0)) {
        let shares = amount === "max" || fromVault >= st.held ? st.shares : (fromVault * st.vault.rate) / RATE_UNIT + BigInt(1);
        if (shares > st.shares) shares = st.shares;
        if (st.shares - shares < st.vault.minShares) shares = st.shares;
        if (shares < st.vault.minShares) throw new ExecError(`Ember's minimum withdrawal for this vault is ${formatUnits(toAssets(st.vault.minShares, st.vault.rate), decimals)} ${symbol}.`);
        const pkg = await emberPackage();
        await sendSui(s, () => {
          const tx = new SuiTx();
          tx.moveCall({
            target: `${pkg}::gateway::redeem_shares`,
            typeArguments: [st.vault.coin, st.vault.receipt],
            arguments: [tx.object.clock(), tx.object(vaultId), tx.object(EMBER_CONFIG), coinWithBalance({ type: st.vault.receipt, balance: shares, useGasCoin: false }), tx.pure.vector("address", [me])],
          });
          return tx;
        });
        requested = toAssets(shares, st.vault.rate);
        noteRequested(vaultId, me, requested);
        on("withdraw", "done", `${formatUnits(requested, decimals)} ${symbol} requested`);
      } else if (st.arrived === BigInt(0)) {
        if (st.pending > BigInt(0)) throw new ExecError(`Your withdrawal of ${formatUnits(st.pending, decimals)} ${symbol} is still in Ember's queue${wait ? ` (${wait})` : ""}. Press Withdraw again once it's paid out.`);
        throw new ExecError("You don't have a position in this vault.");
      } else {
        on("withdraw", "skipped");
      }

      if (st.arrived === BigInt(0)) {
        for (const id of ["swap", "sui", "bridge", "fee"]) on(id, "skipped");
        return requestedMessage(requested, decimals, symbol, "Ember", wait, "Sui");
      }
      const result = await fromSui(s, coinType, st.arrived, on);
      noteBroughtHome(vaultId, me, st.arrived);
      return requested > BigInt(0) ? `${result}. ${requestedMessage(requested, decimals, symbol, "Ember", wait, "Sui")}` : result;
    },

    queue: async (s) => {
      if (!s.suiAddress) return { symbol, pending: 0, arrived: 0, wait };
      const st = await state(s.suiAddress);
      return {
        symbol,
        pending: Number(formatUnits(st.pending, decimals)),
        arrived: Number(formatUnits(st.arrived, decimals)),
        wait,
        requestedAt: requestedAt(vaultId, s.suiAddress),
      };
    },

    bringHome: async (s, on) => {
      const me = needSui(s);
      const st = await state(me);
      if (st.arrived === BigInt(0)) return null;
      on("withdraw", "skipped");
      const result = await fromSui(s, coinType, st.arrived, on);
      noteBroughtHome(vaultId, me, st.arrived);
      return result;
    },
  };
}

/** Decimals of the deposit coins Ember's Sui vaults take. */
const SUI_COINS: Record<string, { decimals: number }> = {
  USDC: { decimals: 6 },
  SUI: { decimals: 9 },
  BLUE: { decimals: 9 },
};
/** Ember's Sui deposit coins (from Ember's own vault list); each vault's coin type is also read on-chain at use. */
const SUI_COIN_TYPE: Record<string, string> = {
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  SUI: SUI_TYPE,
  BLUE: "0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE",
};

/* ---------------- registration ---------------- */

export function emberAdapter(o: Opp): Adapter | null {
  if (o.protocol !== "Ember" || !o.id.startsWith("ember:")) return null;
  const [, chainKey, address] = o.id.split(":");
  const wait = catalogWait(o);
  if (chainKey === "sui") {
    const coin = SUI_COIN_TYPE[o.asset.toUpperCase()];
    const meta = SUI_COINS[o.asset.toUpperCase()];
    return coin && meta && /^0x[0-9a-f]{64}$/i.test(address) ? emberSui(address, o.asset, meta.decimals, coin, wait) : null;
  }
  const chainId = EMBER_EVM[chainKey];
  // Pharos (and any chain the executor can't run on yet) stays on the regular page.
  if (!chainId || !isAddr(address)) return null;
  return emberEvm(chainId, address, o.asset, wait);
}

registerAdapters(emberAdapter);

/** For tests and scripts. */
export const emberInternals = { emberEvm, emberSui, suiVault, suiPendingShares, emberPackage, EMBER_CONFIG };
