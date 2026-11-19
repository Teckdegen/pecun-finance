"use client";

import { encodeFunctionData, erc20Abi, formatUnits, parseAbi, parseUnits, zeroAddress, type Address } from "viem";
import {
  backToUsdg,
  chainClient,
  erc20Balance,
  ExecError,
  IN_STEPS,
  isAddr,
  lazy,
  netOfFee,
  planRoute,
  registerAdapters,
  routeInto,
  runRoute,
  sendEvm,
  takeUsdgFee,
  tokenMeta,
  waitForArrival,
  type Adapter,
  type Opp,
} from "../execute";
import { evmChain } from "../exec-chains";
import { ROBINHOOD_CHAIN_ID, USDG, USDG_DECIMALS } from "../wallet";
import { arrivedFor, noteBroughtHome, noteRequested, queuedSteps, requestedAt, requestedMessage, waitLabel, wanted } from "./queued";

/**
 * Upshift (August Digital). Two contract families, told apart on-chain:
 *  - Tokenized Vault V2 ("multi-asset", has lpTokenAddress()): deposit(asset, amount, receiver) mints a separate receipt
 *    token; requestRedeem(shares, receiver) after approving the receipt to the vault.
 *  - Lending pools / tokenized vaults V1 (ERC-4626-like, the vault is the share token): deposit(assets, receiver);
 *    requestRedeem(shares, receiver, holder).
 * Both queue withdrawals by date (request time + 300 s + lagDuration, UTC). Upshift's operator pays each day's queue
 * into the receiver's wallet; anyone can also `claim(year, month, day, receiver)` once that date has passed, which we do
 * on the next Withdraw so overdue payouts don't wait for the operator.
 *
 * Upshift's API doesn't allow browser calls, so everything is read on-chain.
 */

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;

const V2_ABI = parseAbi([
  "function asset() view returns (address)",
  "function lpTokenAddress() view returns (address)",
  "function getSharePrice() view returns (uint256)",
  "function lagDuration() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function withdrawalsPaused() view returns (bool)",
  "function sendersWhitelistAddress() view returns (address)",
  "function getBurnableAmountByReceiver(uint256 year, uint256 month, uint256 day, address receiverAddr) view returns (uint256)",
  "function deposit(address assetIn, uint256 amountIn, address receiverAddr) returns (uint256)",
  "function requestRedeem(uint256 shares, address receiverAddr) returns (uint256, uint256, uint256, uint256)",
  "function claim(uint256 year, uint256 month, uint256 day, address receiverAddr) returns (uint256, uint256)",
]);
const V1_ABI = parseAbi([
  "function asset() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function convertToShares(uint256) view returns (uint256)",
  "function lagDuration() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function withdrawalsPaused() view returns (bool)",
  "function getBurnableAmountByReceiver(uint256 year, uint256 month, uint256 day, address receiverAddr) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function requestRedeem(uint256 shares, address receiverAddr, address holderAddr) returns (uint256, uint256)",
  "function claim(uint256 year, uint256 month, uint256 day, address receiverAddr) returns (uint256, uint256)",
]);
const WHITELIST_ABI = parseAbi(["function isWhitelisted(address) view returns (bool)"]);

type Day = { y: number; m: number; d: number; due: boolean };
const DAY = 86_400_000;

/** Every UTC date a request from this wallet could still be queued for: the last two weeks up to now + lag + 1 day. */
function candidateDays(lagSeconds: bigint): Day[] {
  const now = Date.now();
  const today = Math.floor(now / DAY) * DAY;
  const last = today + Number(lagSeconds) * 1000 + 2 * DAY;
  const out: Day[] = [];
  for (let t = today - 14 * DAY; t <= last; t += DAY) {
    const dt = new Date(t);
    // A date's queue is surely claimable once the whole day (plus 5 minutes) has passed.
    out.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), due: t + DAY + 300_000 < now });
  }
  return out;
}

function upshiftVault(chainId: number, vault: Address, symbol: string): Adapter {
  const c = () => chainClient(chainId);
  const where = evmChain(chainId)?.names[0] ?? "the vault's chain";
  const kind = lazy(async () => {
    const lp = await c().readContract({ address: vault, abi: V2_ABI, functionName: "lpTokenAddress" }).catch(() => null);
    if (lp && lp !== zeroAddress) {
      const lpDecimals = await c().readContract({ address: lp, abi: erc20Abi, functionName: "decimals" });
      return { v2: true as const, lp, unit: BigInt(10) ** BigInt(lpDecimals) };
    }
    return { v2: false as const, lp: vault, unit: BigInt(1) };
  });
  const asset = lazy(async () => tokenMeta(chainId, await c().readContract({ address: vault, abi: V1_ABI, functionName: "asset" })));
  const lag = lazy(() => c().readContract({ address: vault, abi: V1_ABI, functionName: "lagDuration" }));
  const wait = lazy(async () => waitLabel((await lag()) + BigInt(86_400))); // processed the day after the lag ends

  const shares = async (owner: Address) => erc20Balance(chainId, (await kind()).lp, owner);
  const toAssets = async (sh: bigint) => {
    if (sh <= BigInt(0)) return BigInt(0);
    const k = await kind();
    return k.v2
      ? (sh * (await c().readContract({ address: vault, abi: V2_ABI, functionName: "getSharePrice" }))) / k.unit
      : c().readContract({ address: vault, abi: V1_ABI, functionName: "convertToAssets", args: [sh] });
  };
  const toShares = async (assets: bigint) => {
    const k = await kind();
    if (!k.v2) return (await c().readContract({ address: vault, abi: V1_ABI, functionName: "convertToShares", args: [assets] })) + BigInt(1);
    const price = await c().readContract({ address: vault, abi: V2_ABI, functionName: "getSharePrice" });
    return (assets * k.unit + price - BigInt(1)) / price;
  };

  /** Shares this wallet has queued, per date (from the vault's own per-date ledger). */
  const queued = async (owner: Address) => {
    const days = candidateDays(await lag());
    const calls = days.map((x) => ({ address: vault, abi: V1_ABI, functionName: "getBurnableAmountByReceiver" as const, args: [BigInt(x.y), BigInt(x.m), BigInt(x.d), owner] as const }));
    let amounts: bigint[];
    try {
      const r = await c().multicall({ contracts: calls, multicallAddress: MULTICALL3, allowFailure: true });
      amounts = r.map((x) => (x.status === "success" ? (x.result as bigint) : BigInt(0)));
    } catch {
      amounts = await Promise.all(calls.map((x) => c().readContract(x).catch(() => BigInt(0))));
    }
    return days.map((x, i) => ({ ...x, shares: amounts[i] })).filter((x) => x.shares > BigInt(0));
  };

  const state = async (owner: Address) => {
    const a = await asset();
    const [sh, q, idle] = await Promise.all([shares(owner), queued(owner), erc20Balance(chainId, a.address, owner)]);
    const queuedShares = q.reduce((t, x) => t + x.shares, BigInt(0));
    const [held, pending] = await Promise.all([toAssets(sh), toAssets(queuedShares)]);
    return { a, shares: sh, q, held, pending, arrived: arrivedFor(vault, owner, idle, pending) };
  };

  return {
    positionSymbol: symbol,
    depositSteps: IN_STEPS,
    withdrawSteps: queuedSteps("Upshift", ""),

    position: async (s) => {
      const st = await state(s.address);
      return Number(formatUnits(st.held + st.pending + st.arrived, st.a.decimals));
    },

    previewDeposit: async (s, usdg) => {
      const a = await asset();
      await canDeposit(s.address);
      return (await planRoute({ from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: a.address, amount: netOfFee(usdg), user: s.address, recipient: s.address }, a.symbol)).preview;
    },
    previewWithdraw: async (s, amount) => {
      const a = await asset();
      return (await planRoute({ from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: a.address, outToken: USDG, amount: parseUnits(amount, a.decimals), user: s.address, recipient: s.address }, "USDC")).preview;
    },

    deposit: async (s, usdg, on) => {
      const a = await asset();
      const k = await kind();
      await canDeposit(s.address);
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const got = await routeInto(s, { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: a.address, amount: net, user: s.address, recipient: s.address });
      on("bridge", "done", `${formatUnits(got, a.decimals)} ${a.symbol}`);

      on("deposit", "running");
      const allowance = await c().readContract({ address: a.address, abi: erc20Abi, functionName: "allowance", args: [s.address, vault] });
      if (allowance < got) await sendEvm(s, chainId, { to: a.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, got] }) });
      const sharesBefore = await shares(s.address);
      await sendEvm(s, chainId, {
        to: vault,
        data: k.v2
          ? encodeFunctionData({ abi: V2_ABI, functionName: "deposit", args: [a.address, got, s.address] })
          : encodeFunctionData({ abi: V1_ABI, functionName: "deposit", args: [got, s.address] }),
      });
      if ((await shares(s.address)) <= sharesBefore) throw new ExecError("The vault didn't accept the deposit. Your funds are still in your wallet.");
      on("deposit", "done");
      return `${formatUnits(got, a.decimals)} ${a.symbol}`;
    },

    withdraw: async (s, amount, on) => {
      on("withdraw", "running");
      const k = await kind();
      const st = await state(s.address);
      const { a } = st;
      const w = await wait();

      // Overdue dates the operator hasn't paid yet: claim them ourselves.
      let claimed = BigInt(0);
      for (const day of st.q.filter((x) => x.due)) {
        const bal = await erc20Balance(chainId, a.address, s.address);
        try {
          await sendEvm(s, chainId, { to: vault, data: encodeFunctionData({ abi: V1_ABI, functionName: "claim", args: [BigInt(day.y), BigInt(day.m), BigInt(day.d), s.address] }) });
          claimed += (await erc20Balance(chainId, a.address, s.address)) - bal;
        } catch {
          /* not claimable yet: the operator will pay it */
        }
      }
      const pendingLeft = claimed > BigInt(0) ? await toAssets((await queued(s.address)).reduce((t, x) => t + x.shares, BigInt(0))) : st.pending;
      const idle = await erc20Balance(chainId, a.address, s.address);
      const home = claimed > BigInt(0) ? arrivedFor(vault, s.address, idle, pendingLeft) || (claimed < idle ? claimed : idle) : st.arrived;

      const want = wanted(amount, a.decimals, st.held + st.pending + st.arrived);
      const fromVault = want > home ? want - home : BigInt(0);
      let requested = BigInt(0);
      if (fromVault > BigInt(0) && st.shares > BigInt(0)) {
        if (await c().readContract({ address: vault, abi: V1_ABI, functionName: "withdrawalsPaused" }).catch(() => false))
          throw new ExecError("Upshift has paused withdrawals from this vault for now. Nothing was sent.");
        let sh = amount === "max" || fromVault >= st.held ? st.shares : await toShares(fromVault);
        if (sh > st.shares) sh = st.shares;
        if (k.v2) {
          const allowance = await c().readContract({ address: k.lp, abi: erc20Abi, functionName: "allowance", args: [s.address, vault] });
          if (allowance < sh) await sendEvm(s, chainId, { to: k.lp, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, sh] }) });
        }
        requested = await toAssets(sh);
        await sendEvm(s, chainId, {
          to: vault,
          data: k.v2
            ? encodeFunctionData({ abi: V2_ABI, functionName: "requestRedeem", args: [sh, s.address] })
            : encodeFunctionData({ abi: V1_ABI, functionName: "requestRedeem", args: [sh, s.address, s.address] }),
        });
        noteRequested(vault, s.address, requested);
        on("withdraw", "done", `${formatUnits(requested, a.decimals)} ${a.symbol} requested`);
      } else if (home === BigInt(0)) {
        if (st.pending > BigInt(0)) throw new ExecError(`Your withdrawal of ${formatUnits(st.pending, a.decimals)} ${a.symbol} is still in Upshift's queue (${w}). Press Withdraw again once it's paid out.`);
        throw new ExecError("You don't have a position in this vault.");
      } else {
        on("withdraw", claimed > BigInt(0) ? "done" : "skipped", claimed > BigInt(0) ? `${formatUnits(claimed, a.decimals)} ${a.symbol} claimed` : undefined);
      }

      if (home === BigInt(0)) {
        on("bridge", "skipped");
        on("fee", "skipped");
        return requestedMessage(requested, a.decimals, a.symbol, "Upshift", w, where);
      }
      const result = await backToUsdg(s, { from: chainId, inToken: a.address, amount: home, user: s.address }, on);
      noteBroughtHome(vault, s.address, home);
      return requested > BigInt(0) ? `${result}. ${requestedMessage(requested, a.decimals, a.symbol, "Upshift", w, where)}` : result;
    },

    queue: async (s) => {
      const st = await state(s.address);
      // Dates the operator hasn't paid yet but are already due count as arrived: bringHome claims them.
      const due = st.q.filter((x) => x.due).reduce((t, x) => t + x.shares, BigInt(0));
      const dueAssets = due > BigInt(0) ? await toAssets(due) : BigInt(0);
      return {
        symbol: st.a.symbol,
        pending: Number(formatUnits(st.pending - dueAssets, st.a.decimals)),
        arrived: Number(formatUnits(st.arrived + dueAssets, st.a.decimals)),
        wait: await wait(),
        requestedAt: requestedAt(vault, s.address),
      };
    },

    bringHome: async (s, on) => {
      const st = await state(s.address);
      const { a } = st;
      let claimed = BigInt(0);
      for (const day of st.q.filter((x) => x.due)) {
        const bal = await erc20Balance(chainId, a.address, s.address);
        try {
          await sendEvm(s, chainId, { to: vault, data: encodeFunctionData({ abi: V1_ABI, functionName: "claim", args: [BigInt(day.y), BigInt(day.m), BigInt(day.d), s.address] }) });
          claimed += (await erc20Balance(chainId, a.address, s.address)) - bal;
        } catch {
          /* not claimable yet: the operator will pay it */
        }
      }
      const pendingLeft = claimed > BigInt(0) ? await toAssets((await queued(s.address)).reduce((t, x) => t + x.shares, BigInt(0))) : st.pending;
      const idle = await erc20Balance(chainId, a.address, s.address);
      const home = claimed > BigInt(0) ? arrivedFor(vault, s.address, idle, pendingLeft) || (claimed < idle ? claimed : idle) : st.arrived;
      if (home === BigInt(0)) return null;
      on("withdraw", claimed > BigInt(0) ? "done" : "skipped", claimed > BigInt(0) ? `${formatUnits(claimed, a.decimals)} ${a.symbol} claimed` : undefined);
      const result = await backToUsdg(s, { from: chainId, inToken: a.address, amount: home, user: s.address }, on);
      noteBroughtHome(vault, s.address, home);
      return result;
    },
  };

  /** Throws (before anything is sent) when the vault won't take this wallet's deposit. */
  async function canDeposit(owner: Address) {
    if (await c().readContract({ address: vault, abi: V1_ABI, functionName: "depositsPaused" }).catch(() => false))
      throw new ExecError("Upshift has paused deposits into this vault. Nothing was sent.");
    if (!(await kind()).v2) return;
    const list = await c().readContract({ address: vault, abi: V2_ABI, functionName: "sendersWhitelistAddress" }).catch(() => zeroAddress);
    if (list !== zeroAddress && !(await c().readContract({ address: list, abi: WHITELIST_ABI, functionName: "isWhitelisted", args: [owner] }).catch(() => false)))
      throw new ExecError("This Upshift vault only takes deposits from approved wallets. Nothing was sent.");
  }
}

/* ---------------- registration ---------------- */

/**
 * The underlying token of each vault (read on-chain via asset()). The catalog's `asset` is the receipt's name, but the
 * position is shown in the underlying. Vaults not listed here fall back to "token" until their asset is read.
 */
const UNDERLYING: Record<string, string> = {
  "0x74ad2f789ed583dbd141bbdafc673fe1f033718b": "USDC", "0x0a152c5b8d48c26619ff3ae85ef1b54a79e20870": "USDC",
  "0x27a06bbea7a8af7bcd355299e9d9e753307e9456": "USDC", "0x955256b31097ddf47a9e47a95adfdfb4460d8522": "USDC",
  "0xcd69123b3fbbfc666e1f6a501da27b564c00de54": "trUSD", "0xe1b4d34e8754600962cd944b535180bd758e6c2e": "rsETH",
  "0xad958c4c0c90bf0216e0f5472f074a9ab30f595f": "USDx", "0xc824a08db624942c5e5f330d56530cd1598859fd": "rsETH",
  "0xa422c3018c46ba90a14acd14f96cb60616f5c91b": "WETH", "0x3e4ef6ccc7e4a045c9d3f48b08813d59df14e256": "cbBTC",
  "0x3cc0d33b1aeac3d23ea89214b3ac5b4607032167": "WBTC", "0xd000e6bcad5457e8f4de67eddefe50bcc4b3d743": "PYUSD",
  "0x5776b576474ad2513e550190c5855613859f3a26": "USDC", "0x80e1048ede66ec4c364b4f22c8768fc657ff6a42": "USDC",
  "0xd809197828f63bf95f90931191bd9e3e7c6366c6": "tETH", "0xd0271e199f886ff943859579465498b18ecf1e9d": "WETH",
  "0xaeeb2fb279a5aa837367b9d2582f898a63b06ca1": "NUSD", "0x02ea41404cca842df16e7fd327756192d576f503": "USDC",
  "0xe9b725010a9e419412ed67d0fa5f3a5f40159d32": "USDC", "0x18ee038c114a07f4b08b420fb1e4149a4f357249": "USDC",
  "0x998d7b14c123c1982404562b68eddb057b0477cb": "USDC", "0x076f3f14d87ea2d34db66a4b5b9f091918008552": "USDC",
  "0x36edbf0c834591bfdfcac0ef9605528c75c406aa": "AUSD", "0x42b3b62a6685e3a3f93483715ef4300f5e7336cc": "USDC",
  "0x80eff70acdb59c0db0c1b2cab8b0ad06486cfb69": "WHYPE", "0xcfe06d2499ae635830d11859941e76354d5717cc": "USDC",
  "0x2c4198361f5af870ec2be0fffe243610cde7f84b": "cbXRP", "0x373d7d201c8134d4a2f7b5c63560da217e3dea28": "FXRP",
  "0x2439d4bb753a0f3777d4c9011afacc475ba6b951": "FXRP", "0x74e3840c9168785c213bd8077119a0a1d0cf42dd": "WFLR",
};

export function upshiftAdapter(o: Opp): Adapter | null {
  if (o.protocol !== "Upshift" || !o.id.startsWith("upshift:")) return null;
  const [, chain, address] = o.id.split(":");
  const chainId = Number(chain);
  // Chain 25363 and Citrea (4114) aren't chains the executor runs on yet.
  if (!evmChain(chainId) || chainId === ROBINHOOD_CHAIN_ID || !isAddr(address)) return null;
  return upshiftVault(chainId, address, UNDERLYING[address.toLowerCase()] ?? "token");
}

registerAdapters(upshiftAdapter);

export const upshiftInternals = { upshiftVault, candidateDays };
