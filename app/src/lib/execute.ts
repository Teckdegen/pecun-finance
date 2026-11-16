"use client";

import { encode as msgpack } from "@msgpack/msgpack";
import { concat, createPublicClient, encodeFunctionData, fallback, erc20Abi, formatUnits, hashTypedData, http, keccak256, parseAbi, parseUnits, serializeTransaction, zeroAddress, type Address, type Hex } from "viem";
import { chainIdByName, EVM_CHAINS } from "./exec-chains";
import { base64ToHex, confirmSolana, createTokenAccountTx, hasTokenAccount, lamports, SOLANA_CHAIN_ID, SOLANA_RPC, splBalance, splDecimals, txFromInstructions } from "./solana";
import { coinWithBalance, Transaction as SuiTx } from "@mysten/sui/transactions";
import { SUI_CHAIN_ID, SUI_TYPE, suiBalance } from "./sui";
import { ROBINHOOD_CHAIN_ID, USDG, USDG_DECIMALS } from "./wallet";

/**
 * One-click execution. A single press runs every step (Pecun's fee, Relay bridge + swap, gas top-ups, approvals, the
 * vault deposit or withdrawal), each signed in the background with the user's own Turnkey session. Turnkey holds the
 * keys in the user's own account; Pecun's server can't sign for them. Network fees come from Pecun's gas tank.
 *
 * Every vault type is an `Adapter` (position, preview, deposit, withdraw), so the panel works the same everywhere.
 */

export const BASE_CHAIN_ID = 8453;
const RPC: Record<number, string> = Object.fromEntries(EVM_CHAINS.map((c) => [c.id, c.rpc]));
const RELAY = "https://api.relay.link";

/** Pecun's fee on deposits and withdrawals, sent to the treasury. Off when either value is missing. */
const TREASURY = (process.env.NEXT_PUBLIC_PECUN_TREASURY ?? "") as Address | "";
const FEE_BPS = Number(process.env.NEXT_PUBLIC_PECUN_FEE_BPS ?? "0") || 0;
export const feeBps = TREASURY ? FEE_BPS : 0;

/* ---------------- types ---------------- */

/** What the executor needs from the signed-in user. */
export type Signer = {
  address: Address;
  solanaAddress?: string;
  sendEvmTransaction: (unsigned: string, rpcUrl: string) => Promise<{ ok: true; hash: Hex } | { ok: false; error: string }>;
  sendSolanaTransaction: (unsignedHex: string, rpcUrl: string) => Promise<{ ok: true; signature: string } | { ok: false; error: string }>;
  signEvmDigest: (digestHex: Hex) => Promise<{ ok: true; signature: Hex } | { ok: false; error: string }>;
  suiAddress?: string;
  sendSuiTransaction: (tx: SuiTx | string) => Promise<{ ok: true; digest: string } | { ok: false; error: string }>;
  signAccountsRequest: () => Promise<unknown | null>;
};
type Who = Pick<Signer, "address" | "solanaAddress" | "suiAddress">;

export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type Progress = (id: string, status: StepStatus, detail?: string) => void;
export type Step = { id: string; label: string };

/** What the user sees before pressing the button. */
export type Preview = {
  out: string; // expected amount out, formatted
  outSymbol: string;
  minOut: string; // after the maximum slippage
  slippagePct: number; // maximum slippage allowed
  impactPct: number; // price impact (negative = costs you)
  feesUsd: number; // route fees (bridge, swap, relayer)
  seconds: number; // estimated time
};

export type Adapter = {
  /** The token the user ends up holding in the vault. */
  positionSymbol: string;
  depositSteps: Step[];
  withdrawSteps: Step[];
  position: (s: Who) => Promise<number>;
  previewDeposit: (s: Who, usdg: string) => Promise<Preview>;
  previewWithdraw: (s: Who, amount: string) => Promise<Preview>;
  deposit: (s: Signer, usdg: string, on: Progress) => Promise<string>;
  withdraw: (s: Signer, amount: string | "max", on: Progress) => Promise<string>;
};

class ExecError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- EVM ---------------- */

const clients = new Map<number, ReturnType<typeof createPublicClient>>();
export function chainClient(chainId: number) {
  let c = clients.get(chainId);
  if (!c) {
    const ch = EVM_CHAINS.find((x) => x.id === chainId);
    const urls = ch ? [ch.rpc, ...(ch.backups ?? [])] : [RPC[chainId]];
    // Each RPC fails fast (no per-RPC retry: viem would honour a rate-limit's Retry-After and stall); the fallback
    // moves to the next one and retries the set.
    c = createPublicClient({ transport: fallback(urls.map((u) => http(u, { timeout: 15_000, retryCount: 0 })), { retryCount: 2 }) });
    clients.set(chainId, c);
  }
  return c;
}

/** Asks Pecun's gas tank to make sure the user has `need` of native gas (wei on EVM, lamports on Solana). */
async function ensureGas(s: Signer, chainId: number, address: string, need: bigint, have: bigint) {
  if (have >= need) return;
  const signed = await s.signAccountsRequest();
  if (!signed) throw new ExecError("Your session has expired. Sign in again.");
  const res = await fetch("/api/gas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signed, chainId, address, need: need.toString() }),
  });
  if (!res.ok) throw new ExecError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't cover the network fee.");
}

/** Builds, gas-funds, signs (with the user's session) and sends one EVM transaction, then waits for it. */
async function sendEvm(s: Signer, chainId: number, tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex> {
  const c = chainClient(chainId);
  const value = tx.value ?? BigInt(0);
  const [gas, fees, bal] = await Promise.all([
    c.estimateGas({ account: s.address, to: tx.to, data: tx.data, value }),
    c.estimateFeesPerGas(),
    c.getBalance({ address: s.address }),
  ]);
  const gasLimit = (gas * BigInt(13)) / BigInt(10);
  await ensureGas(s, chainId, s.address, gasLimit * fees.maxFeePerGas + value, bal);
  const nonce = await c.getTransactionCount({ address: s.address, blockTag: "pending" });
  const unsigned = serializeTransaction({
    type: "eip1559",
    chainId,
    nonce,
    to: tx.to,
    data: tx.data,
    value,
    gas: gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const r = await s.sendEvmTransaction(unsigned.slice(2), RPC[chainId]);
  if (!r.ok) throw new ExecError(r.error);
  const receipt = await c.waitForTransactionReceipt({ hash: r.hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new ExecError("A transaction failed on-chain. Nothing more was sent.");
  return r.hash;
}

const erc20Balance = (chainId: number, token: Address, owner: Address) =>
  chainClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });

/* ---------------- Solana ---------------- */

/** Covers fees plus rent for a new token account. */
const SOL_NEEDED = BigInt(4_000_000); // 0.004 SOL

async function sendSol(s: Signer, unsignedHex: () => Promise<string>): Promise<string> {
  if (!s.solanaAddress) throw new ExecError("Your Solana account is still being set up. Try again in a moment.");
  await ensureGas(s, SOLANA_CHAIN_ID, s.solanaAddress, SOL_NEEDED, await lamports(s.solanaAddress));
  // Built after the top-up so its blockhash is fresh.
  const r = await s.sendSolanaTransaction(await unsignedHex(), SOLANA_RPC);
  if (!r.ok) throw new ExecError(r.error);
  await confirmSolana(r.signature);
  return r.signature;
}

/* ---------------- Relay (bridge + swap) ---------------- */

type RelayItem = {
  data: {
    to?: Address;
    data?: Hex;
    value?: string;
    chainId?: number;
    instructions?: Parameters<typeof txFromInstructions>[1];
    addressLookupTableAddresses?: string[];
    // Signature steps (EIP-712), e.g. leaving Hyperliquid
    sign?: { signatureKind: string; domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; value: Record<string, unknown>; primaryType: string };
    post?: { endpoint: string; method: string; body: unknown };
    // Hyperliquid user-signed action
    action?: { type: string; parameters: Record<string, unknown> };
    nonce?: number;
    eip712Types?: Record<string, { name: string; type: string }[]>;
    eip712PrimaryType?: string;
  };
  check?: { endpoint: string };
};
type RelayQuote = {
  message?: string;
  steps?: { kind: string; items: RelayItem[] }[];
  details?: {
    currencyOut?: { amount?: string; amountFormatted?: string; minimumAmount?: string; currency?: { symbol?: string; decimals?: number } };
    totalImpact?: { percent?: string };
    slippageTolerance?: { destination?: { percent?: string } };
    timeEstimate?: number;
  };
  fees?: Record<string, { amountUsd?: string } | null>;
};
type RelayLeg = { from: number; to: number; inToken: string; outToken: string; amount: bigint; user: string; recipient: string };

async function relayQuote(p: RelayLeg): Promise<RelayQuote> {
  const res = await fetch(`${RELAY}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: p.user,
      recipient: p.recipient,
      originChainId: p.from,
      destinationChainId: p.to,
      originCurrency: p.inToken,
      destinationCurrency: p.outToken,
      amount: p.amount.toString(),
      tradeType: "EXACT_INPUT",
    }),
  });
  const q = (await res.json()) as RelayQuote;
  if (!res.ok || !q.steps) throw new ExecError(`No route right now: ${q.message ?? res.status}`);
  return q;
}

function toPreview(q: RelayQuote, fallbackSymbol: string): Preview {
  const out = q.details?.currencyOut;
  const dec = out?.currency?.decimals ?? 6;
  const fees = Object.entries(q.fees ?? {})
    .filter(([k]) => k !== "app" && k !== "subsidized")
    .reduce((sum, [, v]) => sum + (Number(v?.amountUsd) || 0), 0);
  return {
    out: out?.amountFormatted ?? "0",
    outSymbol: out?.currency?.symbol ?? fallbackSymbol,
    minOut: out?.minimumAmount ? formatUnits(BigInt(out.minimumAmount), dec) : out?.amountFormatted ?? "0",
    slippagePct: Number(q.details?.slippageTolerance?.destination?.percent) || 0,
    impactPct: Number(q.details?.totalImpact?.percent) || 0,
    feesUsd: fees,
    seconds: q.details?.timeEstimate ?? 0,
  };
}

/** Quote + every transaction it asks for (EVM or Solana), then waits for Relay to report the transfer delivered. */
async function relay(s: Signer, p: RelayLeg) {
  const q = await relayQuote(p);
  let check: string | undefined;
  for (const step of q.steps!) {
    for (const item of step.items) {
      const d = item.data;
      if (step.kind === "signature") {
        if (!d.sign || d.sign.signatureKind !== "eip712" || !d.post) throw new ExecError("This route needs a signature Pecun doesn't support yet.");
        const digest = hashTypedData({ domain: d.sign.domain, types: d.sign.types, primaryType: d.sign.primaryType, message: d.sign.value });
        const sig = await signDigest(s, digest);
        const res = await fetch(`${RELAY}${d.post.endpoint}?signature=${sig}`, { method: d.post.method, headers: { "content-type": "application/json" }, body: JSON.stringify(d.post.body) });
        if (!res.ok) throw new ExecError(`The transfer wasn't authorized (${res.status}).`);
      } else if (step.kind !== "transaction") {
        throw new ExecError("This route needs a step Pecun doesn't support yet.");
      } else if (d.action && d.eip712Types && d.eip712PrimaryType && d.nonce !== undefined) {
        await hlUserAction(s, { action: d.action, nonce: d.nonce, eip712Types: d.eip712Types, eip712PrimaryType: d.eip712PrimaryType });
      } else if (d.instructions) {
        await sendSol(s, () => txFromInstructions(s.solanaAddress!, d.instructions!, d.addressLookupTableAddresses ?? []));
      } else if (d.to && d.chainId) {
        await sendEvm(s, d.chainId, { to: d.to, data: d.data, value: d.value ? BigInt(d.value) : undefined });
      } else {
        throw new ExecError("Unexpected route step.");
      }
      if (item.check) check = item.check.endpoint;
    }
  }
  if (!check) return;
  for (let i = 0; i < 150; i++) {
    const st = (await fetch(`${RELAY}${check}`).then((r) => r.json()).catch(() => ({}))) as { status?: string };
    if (st.status === "success") return;
    if (st.status === "failure" || st.status === "refund") throw new ExecError(`The transfer didn't complete (${st.status}). Relay refunds any funds.`);
    await sleep(2000);
  }
  throw new ExecError("The transfer is taking longer than usual. It will still arrive; check your balance in a few minutes.");
}

/**
 * Waits until a balance rises above `before`; returns how much arrived. `failed` (optional) reports a bridge failure
 * early instead of waiting out the timeout.
 */
async function waitForArrival(read: () => Promise<bigint>, before: bigint, timeoutMs = 120_000, failed?: () => Promise<string | null>): Promise<bigint> {
  const end = Date.now() + timeoutMs;
  for (let i = 0; Date.now() < end; i++) {
    const now = await read().catch(() => before);
    if (now > before) return now - before;
    if (failed && i % 3 === 2) {
      const why = await failed().catch(() => null);
      if (why) throw new ExecError(why);
    }
    await sleep(3000);
  }
  throw new ExecError("Funds haven't arrived yet. They will; check again in a few minutes.");
}

/* ---------------- fee + USDG legs shared by every adapter ---------------- */

const usdgOf = (s: { address: Address }) => () => erc20Balance(ROBINHOOD_CHAIN_ID, USDG, s.address);

/** Takes Pecun's fee from a USDG amount on Robinhood Chain; returns what's left. */
async function takeUsdgFee(s: Signer, total: bigint, on: Progress): Promise<bigint> {
  const fee = (total * BigInt(feeBps)) / BigInt(10_000);
  on("fee", fee > BigInt(0) ? "running" : "skipped");
  if (fee > BigInt(0)) {
    await sendEvm(s, ROBINHOOD_CHAIN_ID, { to: USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TREASURY as Address, fee] }) });
    on("fee", "done");
  }
  return total - fee;
}

/** Brings funds back to USDG on Robinhood Chain, then takes Pecun's fee from what arrived. */
async function backToUsdg(s: Signer, leg: Omit<RelayLeg, "to" | "outToken" | "recipient">, on: Progress): Promise<string> {
  on("bridge", "running");
  const before = await usdgOf(s)();
  await relay(s, { ...leg, to: ROBINHOOD_CHAIN_ID, outToken: USDG, recipient: s.address });
  const back = await waitForArrival(usdgOf(s), before);
  on("bridge", "done", `${formatUnits(back, USDG_DECIMALS)} USDG`);
  const kept = await takeUsdgFee(s, back, on);
  return `${formatUnits(kept, USDG_DECIMALS)} USDG`;
}

const IN_STEPS: Step[] = [
  { id: "fee", label: "Pecun fee" },
  { id: "bridge", label: "Move and swap funds" },
  { id: "deposit", label: "Deposit" },
];
const OUT_STEPS: Step[] = [
  { id: "withdraw", label: "Withdraw" },
  { id: "bridge", label: "Move funds back to your wallet" },
  { id: "fee", label: "Pecun fee" },
];

/* ---------------- EVM vaults: one adapter, a small protocol object per family ---------------- */

type Call = { to: Address; data: Hex };
type TokenMeta = { address: Address; decimals: number; symbol: string };
/** What differs between EVM vault families. Amounts are in the underlying asset's smallest units. */
type Proto = {
  asset: () => Promise<TokenMeta>;
  position: (owner: Address) => Promise<bigint>;
  spender: () => Promise<Address>;
  deposit: (owner: Address, amount: bigint) => Promise<Call>;
  withdraw: (owner: Address, amount: bigint | "max") => Promise<Call>;
};

const MAX_UINT = BigInt(2) ** BigInt(256) - BigInt(1);
const isAddr = (a?: string | null): a is Address => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
/** Robinhood Chain USDG: already the user's wallet token, so there is nothing to bridge or swap. */
const isHomeUsdg = (chainId: number, token: string) => chainId === ROBINHOOD_CHAIN_ID && token.toLowerCase() === USDG.toLowerCase();

async function tokenMeta(chainId: number, token: Address): Promise<TokenMeta> {
  const c = chainClient(chainId);
  const [decimals, symbol] = await Promise.all([
    c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    c.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "token"),
  ]);
  return { address: token, decimals, symbol };
}

/** Caches a lazy async value, retrying after a failure. */
function lazy<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= f().catch((e) => ((p = undefined), Promise.reject(e))));
}

const sameAmountPreview = (amount: string, symbol: string): Preview => ({ out: amount, outSymbol: symbol, minOut: amount, slippagePct: 0, impactPct: 0, feesUsd: 0, seconds: 0 });
const netOfFee = (usdg: string) => parseUnits(usdg, USDG_DECIMALS) - (parseUnits(usdg, USDG_DECIMALS) * BigInt(feeBps)) / BigInt(10_000);

function evmVault(chainId: number, proto: Proto, label: string): Adapter {
  const asset = lazy(proto.asset);
  const home = async () => isHomeUsdg(chainId, (await asset()).address);
  return {
    positionSymbol: label,
    depositSteps: IN_STEPS,
    withdrawSteps: OUT_STEPS,

    position: async (s) => {
      const [a, p] = await Promise.all([asset(), proto.position(s.address)]);
      return Number(formatUnits(p, a.decimals));
    },

    previewDeposit: async (s, usdg) => {
      const a = await asset();
      const net = netOfFee(usdg);
      if (await home()) return sameAmountPreview(formatUnits(net, USDG_DECIMALS), "USDG");
      return toPreview(await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: a.address, amount: net, user: s.address, recipient: s.address }), a.symbol);
    },

    previewWithdraw: async (s, amount) => {
      const a = await asset();
      if (await home()) return sameAmountPreview(amount, "USDG");
      return toPreview(await relayQuote({ from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: a.address, outToken: USDG, amount: parseUnits(amount, a.decimals), user: s.address, recipient: s.address }), "USDG");
    },

    deposit: async (s, usdg, on) => {
      const a = await asset();
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      let received = net;
      if (await home()) {
        on("bridge", "skipped");
      } else {
        on("bridge", "running");
        const read = () => erc20Balance(chainId, a.address, s.address);
        const before = await read();
        await relay(s, { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: a.address, amount: net, user: s.address, recipient: s.address });
        received = await waitForArrival(read, before, 10 * 60_000);
        on("bridge", "done", `${formatUnits(received, a.decimals)} ${a.symbol}`);
      }
      on("deposit", "running");
      const spender = await proto.spender();
      const allowance = await chainClient(chainId).readContract({ address: a.address, abi: erc20Abi, functionName: "allowance", args: [s.address, spender] });
      if (allowance < received) await sendEvm(s, chainId, { to: a.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, received] }) });
      const before = await proto.position(s.address);
      await sendEvm(s, chainId, await proto.deposit(s.address, received));
      // Some lenders (Compound-style) report errors without reverting, so confirm the position actually grew.
      if ((await proto.position(s.address)) <= before) throw new ExecError("The vault didn't accept the deposit. Your funds are still in your wallet.");
      on("deposit", "done");
      return `${formatUnits(received, a.decimals)} ${a.symbol}`;
    },

    withdraw: async (s, amount, on) => {
      const a = await asset();
      on("withdraw", "running");
      if ((await proto.position(s.address)) === BigInt(0)) throw new ExecError("You don't have a position in this vault.");
      const read = () => erc20Balance(chainId, a.address, s.address);
      const before = await read();
      await sendEvm(s, chainId, await proto.withdraw(s.address, amount === "max" ? "max" : parseUnits(amount, a.decimals)));
      const out = (await read()) - before;
      if (out <= BigInt(0)) throw new ExecError("The vault didn't release any funds. It may be short of liquidity right now.");
      on("withdraw", "done", `${formatUnits(out, a.decimals)} ${a.symbol}`);
      if (await home()) {
        on("bridge", "skipped");
        const kept = await takeUsdgFee(s, out, on);
        return `${formatUnits(kept, USDG_DECIMALS)} USDG`;
      }
      return backToUsdg(s, { from: chainId, inToken: a.address, amount: out, user: s.address }, on);
    },
  };
}

/* ERC-4626 vaults: Morpho vaults, Euler, Yearn v3, Fluid, Gearbox, Silo, Sky, Spark savings, sfrxETH. */
const VAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
]);

function erc4626(chainId: number, vault: Address): Proto {
  const c = () => chainClient(chainId);
  const shares = (owner: Address) => c().readContract({ address: vault, abi: VAULT_ABI, functionName: "balanceOf", args: [owner] });
  return {
    asset: async () => tokenMeta(chainId, await c().readContract({ address: vault, abi: VAULT_ABI, functionName: "asset" })),
    position: async (owner) => {
      const sh = await shares(owner);
      return sh > BigInt(0) ? c().readContract({ address: vault, abi: VAULT_ABI, functionName: "convertToAssets", args: [sh] }) : BigInt(0);
    },
    spender: async () => vault,
    deposit: async (owner, amount) => ({ to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [amount, owner] }) }),
    withdraw: async (owner, amount) =>
      amount === "max"
        ? { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "redeem", args: [await shares(owner), owner, owner] }) }
        : { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [amount, owner, owner] }) },
  };
}

/* Yearn: v3 vaults are ERC-4626; older v2 vaults use token() / pricePerShare() and withdraw by shares. */
const YEARN_V2_ABI = parseAbi([
  "function token() view returns (address)",
  "function pricePerShare() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function deposit(uint256 amount, address recipient) returns (uint256)",
  "function withdraw(uint256 maxShares, address recipient) returns (uint256)",
]);

function yearn(chainId: number, vault: Address): Proto {
  const c = () => chainClient(chainId);
  const v3 = erc4626(chainId, vault);
  const isV3 = lazy(() => c().readContract({ address: vault, abi: VAULT_ABI, functionName: "asset" }).then(() => true, () => false));
  const v2 = lazy(async () => {
    const [token, decimals] = await Promise.all([
      c().readContract({ address: vault, abi: YEARN_V2_ABI, functionName: "token" }),
      c().readContract({ address: vault, abi: YEARN_V2_ABI, functionName: "decimals" }),
    ]);
    return { token, unit: BigInt(10) ** BigInt(decimals) };
  });
  const pps = () => c().readContract({ address: vault, abi: YEARN_V2_ABI, functionName: "pricePerShare" });
  const shares = (owner: Address) => c().readContract({ address: vault, abi: YEARN_V2_ABI, functionName: "balanceOf", args: [owner] });
  return {
    asset: async () => ((await isV3()) ? v3.asset() : tokenMeta(chainId, (await v2()).token)),
    position: async (owner) => {
      if (await isV3()) return v3.position(owner);
      const [sh, p, { unit }] = await Promise.all([shares(owner), pps(), v2()]);
      return (sh * p) / unit;
    },
    spender: async () => vault,
    deposit: async (owner, amount) =>
      (await isV3()) ? v3.deposit(owner, amount) : { to: vault, data: encodeFunctionData({ abi: YEARN_V2_ABI, functionName: "deposit", args: [amount, owner] }) },
    withdraw: async (owner, amount) => {
      if (await isV3()) return v3.withdraw(owner, amount);
      const [sh, p, { unit }] = await Promise.all([shares(owner), pps(), v2()]);
      const want = amount === "max" ? sh : (amount * unit + p - BigInt(1)) / p; // shares for `amount`, rounded up
      return { to: vault, data: encodeFunctionData({ abi: YEARN_V2_ABI, functionName: "withdraw", args: [want < sh ? want : sh, owner] }) };
    },
  };
}

/* Aave v3 and forks (Spark, HyperLend): Pool.supply / Pool.withdraw; the position is the aToken balance. */
const AAVE_POOL_ABI = parseAbi([
  "function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);
const ATOKEN_ABI = parseAbi(["function POOL() view returns (address)", "function UNDERLYING_ASSET_ADDRESS() view returns (address)"]);

function aaveStyle(chainId: number, pool: () => Promise<Address>, underlying: () => Promise<Address>): Proto {
  const aToken = lazy(async () => (await chainClient(chainId).readContract({ address: await pool(), abi: AAVE_POOL_ABI, functionName: "getReserveData", args: [await underlying()] })).aTokenAddress);
  return {
    asset: async () => tokenMeta(chainId, await underlying()),
    position: async (owner) => erc20Balance(chainId, await aToken(), owner),
    spender: pool,
    deposit: async (owner, amount) => ({ to: await pool(), data: encodeFunctionData({ abi: AAVE_POOL_ABI, functionName: "supply", args: [await underlying(), amount, owner, 0] }) }),
    withdraw: async (owner, amount) => ({
      to: await pool(),
      data: encodeFunctionData({ abi: AAVE_POOL_ABI, functionName: "withdraw", args: [await underlying(), amount === "max" ? MAX_UINT : amount, owner] }),
    }),
  };
}

/* Compound v3 (Comet): supply / withdraw the base token; balanceOf is the underlying amount. */
const COMET_ABI = parseAbi([
  "function baseToken() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function supply(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
]);

function comet(chainId: number, market: Address): Proto {
  const base = lazy(() => chainClient(chainId).readContract({ address: market, abi: COMET_ABI, functionName: "baseToken" }));
  return {
    asset: async () => tokenMeta(chainId, await base()),
    position: (owner) => chainClient(chainId).readContract({ address: market, abi: COMET_ABI, functionName: "balanceOf", args: [owner] }),
    spender: async () => market,
    deposit: async (_owner, amount) => ({ to: market, data: encodeFunctionData({ abi: COMET_ABI, functionName: "supply", args: [await base(), amount] }) }),
    withdraw: async (_owner, amount) => ({ to: market, data: encodeFunctionData({ abi: COMET_ABI, functionName: "withdraw", args: [await base(), amount === "max" ? MAX_UINT : amount] }) }),
  };
}

/* Compound v2 forks (Venus, Moonwell): mint / redeemUnderlying; value = cTokens × exchangeRate. */
const CTOKEN_ABI = parseAbi([
  "function underlying() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function mint(uint256 mintAmount) returns (uint256)",
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function redeemUnderlying(uint256 redeemAmount) returns (uint256)",
]);

function compoundV2(chainId: number, cToken: Address): Proto {
  const c = () => chainClient(chainId);
  const bal = (owner: Address) => c().readContract({ address: cToken, abi: CTOKEN_ABI, functionName: "balanceOf", args: [owner] });
  return {
    asset: async () => tokenMeta(chainId, await c().readContract({ address: cToken, abi: CTOKEN_ABI, functionName: "underlying" })),
    position: async (owner) => {
      const [b, rate] = await Promise.all([bal(owner), c().readContract({ address: cToken, abi: CTOKEN_ABI, functionName: "exchangeRateStored" })]);
      return (b * rate) / BigInt(10) ** BigInt(18);
    },
    spender: async () => cToken,
    deposit: async (_owner, amount) => ({ to: cToken, data: encodeFunctionData({ abi: CTOKEN_ABI, functionName: "mint", args: [amount] }) }),
    withdraw: async (owner, amount) =>
      amount === "max"
        ? { to: cToken, data: encodeFunctionData({ abi: CTOKEN_ABI, functionName: "redeem", args: [await bal(owner)] }) }
        : { to: cToken, data: encodeFunctionData({ abi: CTOKEN_ABI, functionName: "redeemUnderlying", args: [amount] }) },
  };
}

/* Morpho markets: supply directly to one isolated market on Morpho's core contract. */
/** Morpho's core contract per chain (from Morpho's own API). */
const MORPHO_BLUE: Record<number, Address> = {
  1: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  8453: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  42161: "0x6c247b1F6182318877311737BaC0844bAa518F5e",
  10: "0xce95AfbB8EA029495c66020883F87aaE8864AF92",
  143: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
  999: "0x68e37dE8d93d3496ae143F2E900490f6280C57cD",
  4663: "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010",
  747474: "0xD50F2DffFd62f94Ee4AEd9ca05C61d0753268aBc",
};
const MORPHO_ABI = parseAbi([
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
  "function withdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
]);

function morphoMarket(chainId: number, id: Hex): Proto {
  const morpho = MORPHO_BLUE[chainId];
  const c = () => chainClient(chainId);
  const params = lazy(async () => {
    const [loanToken, collateralToken, oracle, irm, lltv] = await c().readContract({ address: morpho, abi: MORPHO_ABI, functionName: "idToMarketParams", args: [id] });
    return { loanToken, collateralToken, oracle, irm, lltv };
  });
  const shares = async (owner: Address) => (await c().readContract({ address: morpho, abi: MORPHO_ABI, functionName: "position", args: [id, owner] }))[0];
  return {
    asset: async () => tokenMeta(chainId, (await params()).loanToken),
    position: async (owner) => {
      const [sh, m] = await Promise.all([shares(owner), c().readContract({ address: morpho, abi: MORPHO_ABI, functionName: "market", args: [id] })]);
      // Morpho's share math, with its virtual shares and assets.
      return (sh * (m[0] + BigInt(1))) / (m[1] + BigInt(1_000_000));
    },
    spender: async () => morpho,
    deposit: async (owner, amount) => ({ to: morpho, data: encodeFunctionData({ abi: MORPHO_ABI, functionName: "supply", args: [await params(), amount, BigInt(0), owner, "0x"] }) }),
    withdraw: async (owner, amount) => ({
      to: morpho,
      data:
        amount === "max"
          ? encodeFunctionData({ abi: MORPHO_ABI, functionName: "withdraw", args: [await params(), BigInt(0), await shares(owner), owner, owner] })
          : encodeFunctionData({ abi: MORPHO_ABI, functionName: "withdraw", args: [await params(), amount, BigInt(0), owner, owner] }),
    }),
  };
}

/* EVM tokens where holding the token IS the position (liquid staking, sUSDe): bought and sold through Relay. */
function evmToken(chainId: number, token: Address, symbol: string): Adapter {
  const meta = lazy(() => tokenMeta(chainId, token));
  return {
    positionSymbol: symbol,
    depositSteps: [IN_STEPS[0], { id: "bridge", label: `Move funds and buy ${symbol}` }],
    withdrawSteps: [{ id: "bridge", label: `Sell ${symbol} and move funds back` }, OUT_STEPS[2]],
    position: async (s) => Number(formatUnits(await erc20Balance(chainId, token, s.address), (await meta()).decimals)),
    previewDeposit: async (s, usdg) =>
      toPreview(await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount: netOfFee(usdg), user: s.address, recipient: s.address }), symbol),
    previewWithdraw: async (s, amount) =>
      toPreview(await relayQuote({ from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: token, outToken: USDG, amount: parseUnits(amount, (await meta()).decimals), user: s.address, recipient: s.address }), "USDG"),
    deposit: async (s, usdg, on) => {
      const m = await meta();
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const read = () => erc20Balance(chainId, token, s.address);
      const before = await read();
      await relay(s, { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount: net, user: s.address, recipient: s.address });
      const got = await waitForArrival(read, before, 10 * 60_000);
      const shown = `${formatUnits(got, m.decimals)} ${symbol}`;
      on("bridge", "done", shown);
      return shown;
    },
    withdraw: async (s, amount, on) => {
      const m = await meta();
      const bal = await erc20Balance(chainId, token, s.address);
      const amt = amount === "max" ? bal : parseUnits(amount, m.decimals);
      if (amt <= BigInt(0) || amt > bal) throw new ExecError(`You don't have that much ${symbol}.`);
      return backToUsdg(s, { from: chainId, inToken: token, amount: amt, user: s.address }, on);
    },
  };
}

/* ---------------- Hyperliquid vaults ---------------- */

const HL = "https://api.hyperliquid.xyz";
export const HYPERLIQUID_CHAIN_ID = 1337; // Relay's id for Hyperliquid
/** USDC in the user's Hyperliquid perps account, as Relay names it (8 decimals there). */
const HL_USDC = "0x00000000000000000000000000000000";

const hlInfo = async <T,>(body: object): Promise<T> => {
  const res = await fetch(`${HL}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new ExecError(`Hyperliquid didn't answer (${res.status}).`);
  return res.json() as Promise<T>;
};

/** USDC free to move in the user's perps account, in micro-USDC (6 decimals). */
const hlWithdrawable = async (user: Address) => {
  const st = await hlInfo<{ withdrawable?: string }>({ type: "clearinghouseState", user });
  return BigInt(Math.floor(Number(st.withdrawable ?? "0") * 1e6));
};

type HlVault = { allowDeposits?: boolean; isClosed?: boolean; followerState?: { vaultEquity?: string; lockupUntil?: number } | null };
const hlVault = (vault: Address, user: Address) => hlInfo<HlVault>({ type: "vaultDetails", vaultAddress: vault, user });

const splitSig = (sig: Hex) => ({ r: `0x${sig.slice(2, 66)}`, s: `0x${sig.slice(66, 130)}`, v: parseInt(sig.slice(130, 132), 16) });

async function signDigest(s: Signer, digest: Hex): Promise<Hex> {
  const r = await s.signEvmDigest(digest);
  if (!r.ok) throw new ExecError(r.error);
  return r.signature;
}

async function hlExchange(body: object) {
  const res = await fetch(`${HL}/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { status?: string; response?: unknown };
  if (j.status !== "ok") throw new ExecError(`Hyperliquid refused it: ${typeof j.response === "string" ? j.response : JSON.stringify(j.response ?? j)}`.slice(0, 220));
  const statuses = (j.response as { data?: { statuses?: unknown[] } } | undefined)?.data?.statuses;
  const err = statuses?.find((x): x is { error: string } => typeof x === "object" && !!x && "error" in x);
  if (err) throw new ExecError(`Hyperliquid refused it: ${err.error}`);
}

/**
 * An "L1 action" (here vaultTransfer): msgpack(action) + nonce is hashed into a one-off "agent" that the user signs
 * with EIP-712. This is how Hyperliquid's own SDKs sign; no gas is involved.
 */
async function hlL1Action(s: Signer, action: Record<string, unknown>) {
  const nonce = Date.now();
  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce));
  const connectionId = keccak256(concat([msgpack(action), nonceBytes, new Uint8Array([0])]));
  const digest = hashTypedData({
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: zeroAddress },
    types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
    primaryType: "Agent",
    message: { source: "a", connectionId },
  });
  await hlExchange({ action, nonce, signature: splitSig(await signDigest(s, digest)), vaultAddress: null });
}

/** A "user-signed" action Relay hands back (sendAsset to Relay's solver), signed with EIP-712 and sent to Hyperliquid. */
async function hlUserAction(s: Signer, d: { action: { type: string; parameters: Record<string, unknown> }; nonce: number; eip712Types: Record<string, { name: string; type: string }[]>; eip712PrimaryType: string }) {
  const signatureChainId = "0x1";
  const digest = hashTypedData({
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 1, verifyingContract: zeroAddress },
    types: d.eip712Types,
    primaryType: d.eip712PrimaryType,
    message: d.action.parameters,
  });
  await hlExchange({ action: { type: d.action.type, signatureChainId, ...d.action.parameters }, nonce: d.nonce, signature: splitSig(await signDigest(s, digest)) });
}

function hyperliquidVault(vault: Address): Adapter {
  const toRelayUnits = (micro: bigint) => micro * BigInt(100); // 6 → 8 decimals
  return {
    positionSymbol: "USDC",
    depositSteps: [IN_STEPS[0], { id: "bridge", label: "Move funds" }, IN_STEPS[2]],
    withdrawSteps: OUT_STEPS,

    position: async (s) => {
      const rows = await hlInfo<{ vaultAddress: string; equity: string }[]>({ type: "userVaultEquities", user: s.address });
      return Number(rows.find((r) => r.vaultAddress.toLowerCase() === vault.toLowerCase())?.equity ?? 0);
    },

    previewDeposit: async (s, usdg) =>
      toPreview(await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: HYPERLIQUID_CHAIN_ID, inToken: USDG, outToken: HL_USDC, amount: netOfFee(usdg), user: s.address, recipient: s.address }), "USDC"),

    previewWithdraw: async (s, amount) =>
      toPreview(
        await relayQuote({ from: HYPERLIQUID_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: HL_USDC, outToken: USDG, amount: parseUnits(amount, 8), user: s.address, recipient: s.address }),
        "USDG",
      ),

    deposit: async (s, usdg, on) => {
      const v = await hlVault(vault, s.address);
      if (v.isClosed || v.allowDeposits === false) throw new ExecError("This vault isn't taking deposits right now.");
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const read = () => hlWithdrawable(s.address);
      const before = await read();
      await relay(s, { from: ROBINHOOD_CHAIN_ID, to: HYPERLIQUID_CHAIN_ID, inToken: USDG, outToken: HL_USDC, amount: net, user: s.address, recipient: s.address });
      const got = await waitForArrival(read, before, 10 * 60_000);
      on("bridge", "done", `${formatUnits(got, 6)} USDC`);
      on("deposit", "running");
      await hlL1Action(s, { type: "vaultTransfer", vaultAddress: vault.toLowerCase(), isDeposit: true, usd: Number(got) });
      on("deposit", "done");
      return `${formatUnits(got, 6)} USDC`;
    },

    withdraw: async (s, amount, on) => {
      on("withdraw", "running");
      const v = await hlVault(vault, s.address);
      const equity = BigInt(Math.floor(Number(v.followerState?.vaultEquity ?? "0") * 1e6));
      if (equity <= BigInt(0)) throw new ExecError("You don't have a position in this vault.");
      const until = v.followerState?.lockupUntil ?? 0;
      if (until > Date.now()) throw new ExecError(`This vault locks deposits for a while. You can withdraw after ${new Date(until).toLocaleString()}.`);
      const want = amount === "max" ? equity : parseUnits(amount, 6);
      const read = () => hlWithdrawable(s.address);
      const before = await read();
      await hlL1Action(s, { type: "vaultTransfer", vaultAddress: vault.toLowerCase(), isDeposit: false, usd: Number(want < equity ? want : equity) });
      const out = await waitForArrival(read, before, 2 * 60_000);
      on("withdraw", "done", `${formatUnits(out, 6)} USDC`);
      return backToUsdg(s, { from: HYPERLIQUID_CHAIN_ID, inToken: HL_USDC, amount: toRelayUnits(out), user: s.address }, on);
    },
  };
}

/* ---------------- Solana tokens where holding the token IS the position (LSTs, mSOL, JLP) ---------------- */

function solanaToken(mint: string, symbol: string): Adapter {
  const decimals = () => splDecimals(mint);
  const need = (s: { solanaAddress?: string }) => {
    if (!s.solanaAddress) throw new ExecError("Your Solana account is still being set up. Try again in a moment.");
    return s.solanaAddress;
  };
  return {
    positionSymbol: symbol,
    depositSteps: [IN_STEPS[0], { id: "bridge", label: `Move funds and buy ${symbol}` }],
    withdrawSteps: [{ id: "bridge", label: `Sell ${symbol} and move funds back` }, OUT_STEPS[2]],
    position: async (s) => (s.solanaAddress ? Number(formatUnits(await splBalance(s.solanaAddress, mint), await decimals())) : 0),
    previewDeposit: async (s, usdg) => {
      const net = parseUnits(usdg, USDG_DECIMALS) - (parseUnits(usdg, USDG_DECIMALS) * BigInt(feeBps)) / BigInt(10_000);
      return toPreview(await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: mint, amount: net, user: s.address, recipient: need(s) }), symbol);
    },
    previewWithdraw: async (s, amount) =>
      toPreview(await relayQuote({ from: SOLANA_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: mint, outToken: USDG, amount: parseUnits(amount, await decimals()), user: need(s), recipient: s.address }), "USDG"),
    deposit: async (s, usdg, on) => {
      const sol = need(s);
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const read = () => splBalance(sol, mint);
      const before = await read();
      await relay(s, { from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: mint, amount: net, user: s.address, recipient: sol });
      const got = await waitForArrival(read, before);
      const shown = `${formatUnits(got, await decimals())} ${symbol}`;
      on("bridge", "done", shown);
      return shown;
    },
    withdraw: async (s, amount, on) => {
      const sol = need(s);
      const bal = await splBalance(sol, mint);
      const amt = amount === "max" ? bal : parseUnits(amount, await decimals());
      if (amt <= BigInt(0) || amt > bal) throw new ExecError(`You don't have that much ${symbol}.`);
      return backToUsdg(s, { from: SOLANA_CHAIN_ID, inToken: mint, amount: amt, user: sol }, on);
    },
  };
}

/* ---------------- Jupiter Lend (Solana) ---------------- */

const JUP_LEND = "https://lite-api.jup.ag/lend/v1/earn";
type JupToken = { address: string; assetAddress: string; decimals: number; asset: { symbol: string; decimals: number } };
let jupTokens: Promise<JupToken[]> | null = null;
const jupToken = async (jl: string) => {
  jupTokens ??= fetch(`${JUP_LEND}/tokens`).then((r) => r.json() as Promise<JupToken[]>);
  const t = (await jupTokens).find((x) => x.address === jl);
  if (!t) throw new ExecError("This Jupiter Lend vault isn't available right now.");
  return t;
};

async function jupTx(kind: "deposit" | "withdraw", asset: string, signer: string, amount: bigint): Promise<string> {
  const res = await fetch(`${JUP_LEND}/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ asset, signer, amount: amount.toString() }),
  });
  const j = (await res.json()) as { transaction?: string; error?: string; message?: string };
  if (!j.transaction) throw new ExecError(`Jupiter Lend couldn't build the ${kind}: ${j.error ?? j.message ?? res.status}`);
  return base64ToHex(j.transaction);
}

function jupiterLend(jlToken: string, assetSymbol: string): Adapter {
  const need = (s: { solanaAddress?: string }) => {
    if (!s.solanaAddress) throw new ExecError("Your Solana account is still being set up. Try again in a moment.");
    return s.solanaAddress;
  };
  const position = async (sol: string, t: JupToken) => {
    const rows = (await fetch(`${JUP_LEND}/positions?users=${sol}`).then((r) => r.json())) as { token: { address: string }; underlyingAssets: string }[];
    return BigInt(rows.find((r) => r.token.address === t.address)?.underlyingAssets ?? "0");
  };
  return {
    positionSymbol: assetSymbol,
    depositSteps: IN_STEPS,
    withdrawSteps: OUT_STEPS,
    position: async (s) => {
      if (!s.solanaAddress) return 0;
      const t = await jupToken(jlToken);
      return Number(formatUnits(await position(s.solanaAddress, t), t.asset.decimals));
    },
    previewDeposit: async (s, usdg) => {
      const t = await jupToken(jlToken);
      const net = parseUnits(usdg, USDG_DECIMALS) - (parseUnits(usdg, USDG_DECIMALS) * BigInt(feeBps)) / BigInt(10_000);
      return toPreview(await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: t.assetAddress, amount: net, user: s.address, recipient: need(s) }), t.asset.symbol);
    },
    previewWithdraw: async (s, amount) => {
      const t = await jupToken(jlToken);
      return toPreview(await relayQuote({ from: SOLANA_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: t.assetAddress, outToken: USDG, amount: parseUnits(amount, t.asset.decimals), user: need(s), recipient: s.address }), "USDG");
    },
    deposit: async (s, usdg, on) => {
      const sol = need(s);
      const t = await jupToken(jlToken);
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const read = () => splBalance(sol, t.assetAddress);
      const before = await read();
      await relay(s, { from: ROBINHOOD_CHAIN_ID, to: SOLANA_CHAIN_ID, inToken: USDG, outToken: t.assetAddress, amount: net, user: s.address, recipient: sol });
      const got = await waitForArrival(read, before);
      on("bridge", "done", `${formatUnits(got, t.asset.decimals)} ${t.asset.symbol}`);
      on("deposit", "running");
      if (!(await hasTokenAccount(sol, t.address))) await sendSol(s, () => createTokenAccountTx(sol, t.address)); // first deposit: Jupiter needs the receipt-token account to exist
      await sendSol(s, () => jupTx("deposit", t.assetAddress, sol, got));
      on("deposit", "done");
      return `${formatUnits(got, t.asset.decimals)} ${t.asset.symbol}`;
    },
    withdraw: async (s, amount, on) => {
      const sol = need(s);
      const t = await jupToken(jlToken);
      on("withdraw", "running");
      const held = await position(sol, t);
      const amt = amount === "max" ? held : parseUnits(amount, t.asset.decimals);
      if (amt <= BigInt(0) || amt > held) throw new ExecError(`You don't have that much in this vault.`);
      const read = () => splBalance(sol, t.assetAddress);
      const before = await read();
      await sendSol(s, () => jupTx("withdraw", t.assetAddress, sol, amt));
      const out = await waitForArrival(read, before);
      on("withdraw", "done", `${formatUnits(out, t.asset.decimals)} ${t.asset.symbol}`);
      return backToUsdg(s, { from: SOLANA_CHAIN_ID, inToken: t.assetAddress, amount: out, user: sol }, on);
    },
  };
}

/* ---------------- Sui: LI.FI legs (Base USDC <-> Sui, via Mayan) ---------------- */

const LIFI = "https://li.quest/v1";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
/** Gas a Sui transaction may use (MIST). The gas tank tops up when the user has less. */
const SUI_GAS = BigInt(20_000_000); // 0.02 SUI

type LifiLeg = { fromChain: number; toChain: number; fromToken: string; toToken: string; amount: bigint; from: string; to: string };
type LifiFee = { amountUSD?: string; included?: boolean };
type LifiRoute = {
  toAmount: string;
  toAmountMin: string;
  fromAmountUSD?: string;
  toAmountUSD?: string;
  toToken: { symbol: string; decimals: number };
  steps: { estimate: { executionDuration?: number; feeCosts?: LifiFee[]; gasCosts?: LifiFee[] }; action?: { slippage?: number } }[];
};

/** Best route (price only; nothing is built), so previews work before the user has gas on the far side. */
async function lifiRoute(p: LifiLeg): Promise<LifiRoute> {
  const res = await fetch(`${LIFI}/advanced/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromChainId: p.fromChain,
      toChainId: p.toChain,
      fromTokenAddress: p.fromToken,
      toTokenAddress: p.toToken,
      fromAmount: p.amount.toString(),
      fromAddress: p.from,
      toAddress: p.to,
      options: { order: "CHEAPEST" },
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { routes?: LifiRoute[]; message?: string };
  if (!j.routes?.length) throw new ExecError(`No route right now${j.message ? `: ${j.message}` : ""}.`);
  return j.routes[0];
}

type LifiQuote = { transactionRequest: { to?: Address; data: string; value?: string }; estimate: { approvalAddress?: Address; toAmount: string } };

/** A ready-to-sign transaction for one leg (EVM call data, or base64 Sui transaction bytes). */
async function lifiQuote(p: LifiLeg): Promise<LifiQuote> {
  const q = new URLSearchParams({
    fromChain: String(p.fromChain),
    toChain: String(p.toChain),
    fromToken: p.fromToken,
    toToken: p.toToken,
    fromAmount: p.amount.toString(),
    fromAddress: p.from,
    toAddress: p.to,
  });
  const res = await fetch(`${LIFI}/quote?${q}`);
  const j = (await res.json().catch(() => ({}))) as Partial<LifiQuote> & { message?: string };
  if (!j.transactionRequest?.data) throw new ExecError(`Couldn't build the transfer${j.message ? `: ${j.message}` : ""}.`);
  return j as LifiQuote;
}

/** LI.FI's view of a transfer: a message if it failed or was refunded, else null. */
const lifiFailed = (txHash: string, fromChain: number, toChain: number) => async () => {
  const st = (await fetch(`${LIFI}/status?${new URLSearchParams({ txHash, fromChain: String(fromChain), toChain: String(toChain) })}`).then((r) => r.json())) as {
    status?: string;
    substatus?: string;
  };
  if (st.status === "FAILED") return "The transfer failed. Any funds taken are refunded by the bridge.";
  if (st.status === "DONE" && st.substatus === "REFUNDED") return "The transfer was refunded instead of completing.";
  return null;
};

const usd = (fees?: LifiFee[], onlyIncluded = false) => (fees ?? []).filter((f) => !onlyIncluded || f.included).reduce((t, f) => t + (Number(f.amountUSD) || 0), 0);

/** Merges two back-to-back legs (Relay then LI.FI, or LI.FI then Relay) into one preview. */
function chainPreview(first: Preview, firstOut: bigint, firstMin: bigint, second: Preview, secondOutRaw: bigint, secondMinRaw: bigint, decimals: number): Preview {
  // The second leg's minimum, scaled by how much the first leg could fall short.
  const min = firstOut > BigInt(0) ? (secondMinRaw * firstMin) / firstOut : secondMinRaw;
  return {
    out: second.out,
    outSymbol: second.outSymbol,
    minOut: formatUnits(min < secondOutRaw ? min : secondOutRaw, decimals),
    slippagePct: first.slippagePct + second.slippagePct,
    impactPct: first.impactPct + second.impactPct,
    feesUsd: first.feesUsd + second.feesUsd,
    seconds: first.seconds + second.seconds,
  };
}

function lifiPreview(r: LifiRoute): Preview {
  const fromUsd = Number(r.fromAmountUSD) || 0;
  const toUsd = Number(r.toAmountUSD) || 0;
  const included = r.steps.reduce((t, st) => t + usd(st.estimate.feeCosts, true), 0);
  return {
    out: formatUnits(BigInt(r.toAmount), r.toToken.decimals),
    outSymbol: r.toToken.symbol,
    minOut: formatUnits(BigInt(r.toAmountMin), r.toToken.decimals),
    slippagePct: r.steps.reduce((t, st) => Math.max(t, (st.action?.slippage ?? 0) * 100), 0),
    impactPct: fromUsd ? ((toUsd + included) / fromUsd - 1) * 100 : 0,
    feesUsd: r.steps.reduce((t, st) => t + usd(st.estimate.feeCosts) + usd(st.estimate.gasCosts), 0),
    seconds: r.steps.reduce((t, st) => t + (st.estimate.executionDuration ?? 0), 0),
  };
}

const needSui = (s: { suiAddress?: string }) => {
  if (!s.suiAddress) throw new ExecError("Your Sui account is still being set up. Try again in a moment.");
  return s.suiAddress;
};

/** Signs and runs a Sui transaction with the user's session, after the gas tank covers `spendSui` plus gas. */
async function sendSui(s: Signer, tx: () => Promise<SuiTx | string> | SuiTx | string, spendSui = BigInt(0)): Promise<string> {
  const me = needSui(s);
  await ensureGas(s, SUI_CHAIN_ID, me, SUI_GAS + spendSui, await suiBalance(me));
  const r = await s.sendSuiTransaction(await tx());
  if (!r.ok) throw new ExecError(r.error);
  return r.digest;
}

/* ---------------- Scallop (Sui lending) ---------------- */

const SCALLOP_ADDRESSES = "https://sui.apis.scallop.io/addresses/67c44a103fe1b8c454eb9699";
const SCALLOP_POOLS = "https://sdk.api.scallop.io/api/market/migrate";
/** Current objects, used if Scallop's address API is unreachable. */
const SCALLOP_FALLBACK = {
  protocol: "0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805",
  version: "0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7",
  market: "0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9",
};
/** Assets LI.FI can deliver to and take from Sui directly (checked against live routes). */
const SUI_ROUTABLE = new Set(["USDC", "SUI", "haSUI", "afSUI", "vSUI", "wETH", "sbETH", "sbUSDT", "CETUS", "FDUSD", "WAL", "xBTC", "USDsui", "XAUm"]);

let scallopCore: Promise<typeof SCALLOP_FALLBACK> | null = null;
const scallopObjects = () =>
  (scallopCore ??= fetch(SCALLOP_ADDRESSES)
    .then((r) => r.json())
    .then((j: { mainnet: { core: { version: string; market: string; packages: { protocol: { id: string } } } } }) => ({
      protocol: j.mainnet.core.packages.protocol.id,
      version: j.mainnet.core.version,
      market: j.mainnet.core.market,
    }))
    .catch(() => SCALLOP_FALLBACK));

type ScallopPool = { coinType: string; symbol: string; coinDecimal: number; marketCoinType: string; conversionRate: number };
let scallopPools: { at: number; pools: Promise<ScallopPool[]> } | null = null;
async function scallopPool(coinType: string): Promise<ScallopPool> {
  if (!scallopPools || Date.now() - scallopPools.at > 60_000) {
    const pools = fetch(SCALLOP_POOLS).then((r) => r.json()).then((j: { pools: ScallopPool[] }) => j.pools);
    pools.catch(() => (scallopPools = null));
    scallopPools = { at: Date.now(), pools };
  }
  const p = (await scallopPools.pools).find((x) => x.coinType === coinType);
  if (!p) throw new ExecError("This Scallop pool isn't available right now.");
  return p;
}

function scallop(coinType: string, symbol: string): Adapter {
  const isSui = coinType === SUI_TYPE || coinType === "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
  const usdcOnBase = (s: { address: Address }) => () => erc20Balance(BASE_CHAIN_ID, BASE_USDC, s.address);
  const netOf = (usdg: string) => parseUnits(usdg, USDG_DECIMALS) - (parseUnits(usdg, USDG_DECIMALS) * BigInt(feeBps)) / BigInt(10_000);
  const lifiType = isSui ? SUI_TYPE : coinType;

  return {
    positionSymbol: symbol,
    depositSteps: [IN_STEPS[0], { id: "bridge", label: "Move funds" }, { id: "sui", label: `Swap into ${symbol}` }, IN_STEPS[2]],
    withdrawSteps: [OUT_STEPS[0], { id: "sui", label: `Swap out of ${symbol}` }, OUT_STEPS[1], OUT_STEPS[2]],

    position: async (s) => {
      if (!s.suiAddress) return 0;
      const p = await scallopPool(coinType);
      const shares = await suiBalance(s.suiAddress, p.marketCoinType);
      return (Number(shares) * p.conversionRate) / 10 ** p.coinDecimal;
    },

    previewDeposit: async (s, usdg) => {
      const sui = needSui(s);
      const rq = await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: BASE_CHAIN_ID, inToken: USDG, outToken: BASE_USDC, amount: netOf(usdg), user: s.address, recipient: s.address });
      const out1 = BigInt(rq.details?.currencyOut?.amount ?? "0");
      const min1 = BigInt(rq.details?.currencyOut?.minimumAmount ?? out1.toString());
      const r = await lifiRoute({ fromChain: BASE_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: BASE_USDC, toToken: lifiType, amount: out1, from: s.address, to: sui });
      return chainPreview(toPreview(rq, "USDC"), out1, min1, lifiPreview(r), BigInt(r.toAmount), BigInt(r.toAmountMin), r.toToken.decimals);
    },

    previewWithdraw: async (s, amount) => {
      const sui = needSui(s);
      const p = await scallopPool(coinType);
      const r = await lifiRoute({ fromChain: SUI_CHAIN_ID, toChain: BASE_CHAIN_ID, fromToken: lifiType, toToken: BASE_USDC, amount: parseUnits(amount, p.coinDecimal), from: sui, to: s.address });
      const out1 = BigInt(r.toAmount);
      const rq = await relayQuote({ from: BASE_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: BASE_USDC, outToken: USDG, amount: out1, user: s.address, recipient: s.address });
      const out2 = BigInt(rq.details?.currencyOut?.amount ?? "0");
      const min2 = BigInt(rq.details?.currencyOut?.minimumAmount ?? out2.toString());
      return chainPreview(lifiPreview(r), out1, BigInt(r.toAmountMin), toPreview(rq, "USDG"), out2, min2, USDG_DECIMALS);
    },

    deposit: async (s, usdg, on) => {
      const sui = needSui(s);
      const [p, obj] = await Promise.all([scallopPool(coinType), scallopObjects()]);
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);

      on("bridge", "running");
      const baseBefore = await usdcOnBase(s)();
      await relay(s, { from: ROBINHOOD_CHAIN_ID, to: BASE_CHAIN_ID, inToken: USDG, outToken: BASE_USDC, amount: net, user: s.address, recipient: s.address });
      const usdc = await waitForArrival(usdcOnBase(s), baseBefore);
      on("bridge", "done", `${formatUnits(usdc, 6)} USDC`);

      on("sui", "running");
      const q = await lifiQuote({ fromChain: BASE_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: BASE_USDC, toToken: lifiType, amount: usdc, from: s.address, to: sui });
      const spender = q.estimate.approvalAddress ?? q.transactionRequest.to!;
      const allowance = await chainClient(BASE_CHAIN_ID).readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "allowance", args: [s.address, spender] });
      if (allowance < usdc) await sendEvm(s, BASE_CHAIN_ID, { to: BASE_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, usdc] }) });
      const readAsset = () => suiBalance(sui, coinType);
      const suiBefore = await readAsset();
      const hash = await sendEvm(s, BASE_CHAIN_ID, { to: q.transactionRequest.to!, data: q.transactionRequest.data as Hex, value: q.transactionRequest.value ? BigInt(q.transactionRequest.value) : undefined });
      const got = await waitForArrival(readAsset, suiBefore, 15 * 60_000, lifiFailed(hash, BASE_CHAIN_ID, SUI_CHAIN_ID));
      const shown = `${formatUnits(got, p.coinDecimal)} ${symbol}`;
      on("sui", "done", shown);

      on("deposit", "running");
      await sendSui(
        s,
        () => {
          const tx = new SuiTx();
          tx.moveCall({
            target: `${obj.protocol}::mint::mint_entry`,
            typeArguments: [coinType],
            arguments: [tx.object(obj.version), tx.object(obj.market), coinWithBalance({ type: coinType, balance: got }), tx.object.clock()],
          });
          return tx;
        },
        isSui ? got : BigInt(0),
      );
      on("deposit", "done");
      return shown;
    },

    withdraw: async (s, amount, on) => {
      const sui = needSui(s);
      const [p, obj] = await Promise.all([scallopPool(coinType), scallopObjects()]);

      on("withdraw", "running");
      const shares = await suiBalance(sui, p.marketCoinType);
      if (shares === BigInt(0)) throw new ExecError("You don't have a position in this vault.");
      let take = shares;
      if (amount !== "max") {
        // Shares for the requested amount, rounded up and capped at what the user holds.
        const want = BigInt(Math.ceil((Number(parseUnits(amount, p.coinDecimal)) / p.conversionRate) * 1.000001));
        if (want < shares) take = want;
      }
      const readAsset = () => suiBalance(sui, coinType);
      const before = await readAsset();
      await sendSui(s, () => {
        const tx = new SuiTx();
        tx.moveCall({
          target: `${obj.protocol}::redeem::redeem_entry`,
          typeArguments: [coinType],
          arguments: [tx.object(obj.version), tx.object(obj.market), coinWithBalance({ type: p.marketCoinType, balance: take, useGasCoin: false }), tx.object.clock()],
        });
        return tx;
      });
      const out = (await readAsset()) - before;
      if (out <= BigInt(0)) throw new ExecError("The vault didn't release any funds.");
      on("withdraw", "done", `${formatUnits(out, p.coinDecimal)} ${symbol}`);

      on("sui", "running");
      const baseBefore = await usdcOnBase(s)();
      const digest = await sendSui(
        s,
        async () => (await lifiQuote({ fromChain: SUI_CHAIN_ID, toChain: BASE_CHAIN_ID, fromToken: lifiType, toToken: BASE_USDC, amount: out, from: sui, to: s.address })).transactionRequest.data,
        isSui ? out : BigInt(0),
      );
      const usdc = await waitForArrival(usdcOnBase(s), baseBefore, 15 * 60_000, lifiFailed(digest, SUI_CHAIN_ID, BASE_CHAIN_ID));
      on("sui", "done", `${formatUnits(usdc, 6)} USDC`);

      return backToUsdg(s, { from: BASE_CHAIN_ID, inToken: BASE_USDC, amount: usdc, user: s.address }, on);
    },
  };
}

/* ---------------- which vaults get one-click ---------------- */

type Opp = { chain: string; protocol: string; asset: string; name?: string; kind?: string; ticker?: string; address?: string | null; id: string; ref?: { source: string; id: string } | null };

/** Standard ERC-4626 vaults (deposit / withdraw / redeem). */
const VAULT_PROTOCOLS = new Set(["Euler", "Fluid", "Gearbox", "Silo", "Sky"]);
/** Tokens that are the position themselves; bought and sold through Relay. */
const TOKEN_PROTOCOLS = new Set(["ether.fi", "Rocket Pool", "Kinetiq", "Ethena"]);
const SPARK_POOL: Record<number, Address> = { 1: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987" };

/** The one-click adapter for a vault, or null when it isn't supported yet. */
export function adapterFor(o: Opp): Adapter | null {
  const a = o.address ?? undefined;
  const evm = chainIdByName(o.chain);
  if (evm) {
    if (o.protocol === "Morpho") {
      if (o.id.includes(":market:")) return MORPHO_BLUE[evm] && /^0x[0-9a-fA-F]{64}$/.test(a ?? "") ? evmVault(evm, morphoMarket(evm, a as Hex), o.asset) : null;
      return isAddr(a) ? evmVault(evm, erc4626(evm, a), o.asset) : null;
    }
    if (o.protocol === "Aave" && o.kind === "Lending" && o.ref?.source === "aave" && isAddr(o.ref.id) && isAddr(a)) {
      const pool = o.ref.id;
      return evmVault(evm, aaveStyle(evm, async () => pool, async () => a), o.asset);
    }
    if (o.protocol === "Spark" && o.kind === "Lending" && SPARK_POOL[evm] && isAddr(a)) return evmVault(evm, aaveStyle(evm, async () => SPARK_POOL[evm], async () => a), o.asset);
    if (o.protocol === "HyperLend" && isAddr(a)) {
      const underlying = o.id.split(":")[2];
      if (!isAddr(underlying)) return null;
      const pool = lazy(() => chainClient(evm).readContract({ address: a, abi: ATOKEN_ABI, functionName: "POOL" }));
      return evmVault(evm, aaveStyle(evm, pool, async () => underlying), o.asset);
    }
    if (o.protocol === "Compound" && isAddr(a)) return evmVault(evm, comet(evm, a), o.asset);
    // Native-coin markets (Venus vBNB) take BNB itself rather than a token, so they stay on the regular page.
    if ((o.protocol === "Venus" || o.protocol === "Moonwell") && isAddr(a) && a.toLowerCase() !== "0xa07c5b74c9b40447a954e1466938b865b6bbea36") return evmVault(evm, compoundV2(evm, a), o.asset);
    if ((TOKEN_PROTOCOLS.has(o.protocol) || (o.protocol === "Frax" && o.kind === "Liquid staking")) && isAddr(a)) {
      const symbol = o.ticker ?? o.name?.match(/\(([^)]+)\)/)?.[1] ?? o.asset;
      return evmToken(evm, a, symbol);
    }
    // Curve-LP vaults hold LP tokens Relay can't buy, so they stay on the regular deposit page.
    if (o.protocol === "Yearn" && isAddr(a) && !/^(Curve|LP) /.test(o.name ?? "")) return evmVault(evm, yearn(evm, a), o.asset);
    // Spark's savings vaults are ERC-4626 on Ethereum; elsewhere they're plain bridged tokens.
    if (o.protocol === "Spark" && o.kind === "Vault") return evm === 1 && isAddr(a) ? evmVault(evm, erc4626(evm, a), o.asset) : null;
    if ((VAULT_PROTOCOLS.has(o.protocol) || (["Frax", "Aave"].includes(o.protocol) && o.kind === "Vault")) && isAddr(a)) return evmVault(evm, erc4626(evm, a), o.asset);
    return null;
  }
  if (o.chain === "Hyperliquid" && o.id.startsWith("hyperliquid:")) {
    const vault = o.id.split(":")[1];
    return isAddr(vault) ? hyperliquidVault(vault) : null;
  }
  if (o.chain === "Solana") {
    const mint = o.address;
    if ((o.protocol === "Solana staking" || o.protocol === "Marinade" || o.id.startsWith("jupiter-jlp")) && mint) return solanaToken(mint, o.ticker ?? o.asset);
    if (o.protocol === "Jupiter Lend" && o.asset !== "WSOL" && o.asset !== "SOL") {
      const jl = o.id.split(":")[2];
      if (jl) return jupiterLend(jl, o.asset);
    }
  }
  if (o.chain === "Sui" && o.protocol === "Scallop" && SUI_ROUTABLE.has(o.asset) && o.id.startsWith("scallop:sui:")) {
    return scallop(o.id.slice("scallop:sui:".length), o.asset);
  }
  return null;
}

/** Adapters are built once per vault, since the panel and the page both ask. */
const cache = new Map<string, Adapter | null>();
export function oneClickFor(o: Opp): Adapter | null {
  if (!cache.has(o.id)) cache.set(o.id, adapterFor(o));
  return cache.get(o.id)!;
}

export const supportsOneClick = (o: Opp) => oneClickFor(o) !== null;

/** The EVM protocol builders, exported for tests and scripts. */
export const evmProtocols = { yearn, erc4626, aaveStyle, comet, compoundV2, morphoMarket, MORPHO_BLUE };
export const hyperliquidSigning = { hlL1Action, hlUserAction };
