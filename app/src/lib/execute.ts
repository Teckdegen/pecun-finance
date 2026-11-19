"use client";

import { encode as msgpack } from "@msgpack/msgpack";
import { concat, createPublicClient, decodeFunctionData, encodeFunctionData, fallback, erc20Abi, formatUnits, hashTypedData, http, keccak256, pad, parseAbi, parseUnits, serializeTransaction, zeroAddress, type Address, type Hex } from "viem";
import { chainIdByName, evmChain, EVM_CHAINS, viaRelay } from "./exec-chains";
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
const FEE_BPS = Number(process.env.NEXT_PUBLIC_PECUN_FEE_BPS ?? "50") || 0; // 50 bps = 0.5%
export const feeBps = FEE_BPS;

/**
 * Route cost limit. Bridges, swaps and their fees together (not Pecun's platform fee, not gas, which Pecun pays) may
 * cost at most this much of what's moved. Quotes above it are refused before anything is sent, and each leg's slippage
 * tolerance is sized so that even the worst fill stays inside it.
 */
export const MAX_ROUTE_COST_PCT = 0.5;
/** Per-leg slippage tolerance (bps) for quotes and the run in progress; set from the route's remaining budget. */
let legSlippageBps = 25;
export const legSlippageBpsNow = () => legSlippageBps;
export function setLegSlippageBps(bps: number) {
  legSlippageBps = Math.max(3, Math.min(25, Math.floor(bps)));
}
/** Sizes each leg's tolerance so expected cost + every leg's worst case stays within MAX_ROUTE_COST_PCT. */
export function budgetLegs(p: Preview) {
  const legs = Math.max(1, p.legs ?? 2);
  setLegSlippageBps(((MAX_ROUTE_COST_PCT - routeCostPct(p)) * 100) / legs);
}
export const resetLegSlippage = () => setLegSlippageBps(25);
/** A quote's total route cost in %: from its own measure when it has one, else from its price impact. */
export const routeCostPct = (p: Preview) => Math.max(0, p.costPct ?? -p.impactPct);

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
export type Who = Pick<Signer, "address" | "solanaAddress" | "suiAddress">;

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
  /** Everything the route costs (bridge/swap fees + price impact), as % of what goes in. */
  costPct?: number;
  /** How many bridge/swap legs the route has. */
  legs?: number;
  /** USD of the vault chain's gas token delivered with the deposit; it stays in the user's wallet for later moves. */
  gasReserveUsd?: number;
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
  /** Queued-withdrawal vaults only: what's waiting in the protocol's queue and what's been paid out but not brought home. */
  queue?: (s: Who) => Promise<QueueState>;
  /** Queued-withdrawal vaults only: brings paid-out funds back to USDG without requesting anything new. Null if nothing arrived. */
  bringHome?: (s: Signer, on: Progress) => Promise<string | null>;
};

export type QueueState = {
  symbol: string;
  /** Still in the protocol's queue (asset units). */
  pending: number;
  /** Paid out to the user's wallet, not yet brought back as USDG (asset units). */
  arrived: number;
  /** "about 3 days", "up to a week", or "" if unknown. */
  wait: string;
  /** When the withdrawal was requested from Pecun (ms), if known. */
  requestedAt?: number;
};

export class ExecError extends Error {}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
export async function ensureGas(s: Signer, chainId: number, address: string, need: bigint, have: bigint) {
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

/**
 * Tempo has no native coin. Gas is priced in attodollars (1e-18 USD) per gas and charged in a USD TIP-20 token: the
 * account's FeeManager preference if set, else (for a plain EIP-1559 transaction) pathUSD. Fee in token units =
 * ceil(gas × price / 1e12). eth_getBalance there is a placeholder, so balances are read from the fee token.
 */
const TEMPO_FEE_MANAGER = "0xfeEC000000000000000000000000000000000000" as Address;
const FEE_MANAGER_ABI = parseAbi(["function userTokens(address user) view returns (address)", "function setUserToken(address token)"]);
const TRANSFER_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/** Fee-token gas (Tempo): returns the top-up `need` and the user's current balance, in the fee token's units. */
async function feeTokenGas(s: Signer, chainId: number, feeToken: Address, tx: { to: Address; data?: Hex }, gasLimit: bigint, maxFeePerGas: bigint) {
  const c = chainClient(chainId);
  const fee = (gasLimit * maxFeePerGas + BigInt(10) ** BigInt(12) - BigInt(1)) / BigInt(10) ** BigInt(12);
  // The fee is reserved before the call runs, so whatever the call itself moves out of the fee token has to be left
  // over on top: a direct transfer of it, or what the target contract is allowed to pull.
  let spend = BigInt(0);
  if (tx.to.toLowerCase() === feeToken.toLowerCase()) {
    try {
      const d = decodeFunctionData({ abi: TRANSFER_ABI, data: tx.data ?? "0x" });
      spend = d.args[1];
    } catch {
      /* approve or another call: moves nothing itself */
    }
  } else {
    spend = await c.readContract({ address: feeToken, abi: erc20Abi, functionName: "allowance", args: [s.address, tx.to] });
  }
  const bal = await c.readContract({ address: feeToken, abi: erc20Abi, functionName: "balanceOf", args: [s.address] });
  if (spend > bal) spend = bal;
  return { need: fee + spend, bal };
}

/** Builds, gas-funds, signs (with the user's session) and sends one EVM transaction, then waits for it. */
export async function sendEvm(s: Signer, chainId: number, tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex> {
  const c = chainClient(chainId);
  const value = tx.value ?? BigInt(0);
  const feeToken = evmChain(chainId)?.feeToken?.address as Address | undefined;
  if (feeToken) {
    if (value > BigInt(0)) throw new ExecError("This network has no native coin to send.");
    // Pin the account's fee token so every transaction pays gas the same way (only needed if it was set elsewhere).
    const pref = await c.readContract({ address: TEMPO_FEE_MANAGER, abi: FEE_MANAGER_ABI, functionName: "userTokens", args: [s.address] });
    if (pref !== zeroAddress && pref.toLowerCase() !== feeToken.toLowerCase() && tx.to.toLowerCase() !== TEMPO_FEE_MANAGER.toLowerCase()) {
      await sendEvm(s, chainId, { to: TEMPO_FEE_MANAGER, data: encodeFunctionData({ abi: FEE_MANAGER_ABI, functionName: "setUserToken", args: [feeToken] }) });
    }
  }
  const [gas, fees, bal] = await Promise.all([
    c.estimateGas({ account: s.address, to: tx.to, data: tx.data, value }),
    c.estimateFeesPerGas(),
    feeToken ? Promise.resolve(BigInt(0)) : c.getBalance({ address: s.address }),
  ]);
  const gasLimit = (gas * BigInt(13)) / BigInt(10);
  if (feeToken) {
    const g = await feeTokenGas(s, chainId, feeToken, tx, gasLimit, fees.maxFeePerGas);
    await ensureGas(s, chainId, s.address, g.need, g.bal);
  } else {
    await ensureGas(s, chainId, s.address, gasLimit * fees.maxFeePerGas + value, bal);
  }
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

export const erc20Balance = (chainId: number, token: Address, owner: Address) =>
  chainClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });

/** The native coin, as Relay and LI.FI name it on EVM chains. */
export const NATIVE = zeroAddress;
export const isNative = (token: string) => token.toLowerCase() === zeroAddress;
/** Balance of an ERC-20, or of the native coin when `token` is the zero address. */
export const tokenBalance = (chainId: number, token: Address, owner: Address) =>
  isNative(token) ? chainClient(chainId).getBalance({ address: owner }) : erc20Balance(chainId, token, owner);

/** Approves `spender` for `amount` of `token` unless it already has that much (no-op for the native coin). */
export async function ensureAllowance(s: Signer, chainId: number, token: Address, spender: Address, amount: bigint) {
  if (isNative(token)) return;
  const allowance = await chainClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [s.address, spender] });
  if (allowance < amount) await sendEvm(s, chainId, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) });
}

/* ---------------- Solana ---------------- */

/** Covers fees plus rent for a new token account. */
export const SOL_NEEDED = BigInt(3_000_000); // 0.003 SOL: fees plus rent for one new token account

export async function sendSol(s: Signer, unsignedHex: () => Promise<string>): Promise<string> {
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
export type RelayQuote = {
  message?: string;
  steps?: { kind: string; items: RelayItem[] }[];
  details?: {
    currencyOut?: { amount?: string; amountFormatted?: string; minimumAmount?: string; currency?: { symbol?: string; decimals?: number } };
    totalImpact?: { percent?: string };
    slippageTolerance?: { destination?: { percent?: string } };
    timeEstimate?: number;
    currencyGasTopup?: { amountUsd?: string };
  };
  fees?: Record<string, { amountUsd?: string } | null>;
};
export type RelayLeg = { from: number; to: number; inToken: string; outToken: string; amount: bigint; user: string; recipient: string; gasUsd?: number; noGasLeg?: boolean };

const GAS_RESERVE_DEFAULT_USD = 0.15;
/**
 * How much of the vault chain's gas token (in USD) a deposit's bridge should also deliver. Only on legs leaving
 * Robinhood Chain for an EVM chain, and only when the user's wallet there is short, so Pecun's gas tank only has to
 * cover Robinhood Chain; it stays a backup everywhere else.
 */
async function gasReserveUsd(p: RelayLeg): Promise<number> {
  if (p.gasUsd !== undefined) return p.gasUsd;
  if (p.from !== ROBINHOOD_CHAIN_ID || p.to === ROBINHOOD_CHAIN_ID || !isAddr(p.recipient)) return 0;
  const c = evmChain(p.to);
  if (!c || c.feeToken || c.gasReserveUsd === 0) return 0;
  if (["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"].includes(p.outToken.toLowerCase())) return 0; // already delivers gas
  const bal = await chainClient(p.to).getBalance({ address: p.recipient as Address }).catch(() => null);
  if (bal === null || bal >= parseUnits(c.topUp, 18) * BigInt(2)) return 0;
  return c.gasReserveUsd ?? GAS_RESERVE_DEFAULT_USD;
}

/**
 * Solana: Relay can't add a gas top-up there, so when the user's Solana wallet is short on SOL, a deposit's bridge is
 * split: a small leg into native SOL (the user's gas reserve, about $0.60) and the rest into the vault's asset.
 */
const SOLANA_NATIVE = "11111111111111111111111111111111";
const SOL_RESERVE_USDG = BigInt(600_000); // $0.60 of USDG (6 decimals): about 0.008 SOL
async function solanaGasLeg(p: RelayLeg): Promise<RelayLeg | null> {
  if (p.noGasLeg || p.from !== ROBINHOOD_CHAIN_ID || p.to !== SOLANA_CHAIN_ID || p.outToken === SOLANA_NATIVE) return null;
  if (p.amount <= SOL_RESERVE_USDG * BigInt(5)) return null; // too small to split
  const have = await lamports(p.recipient).catch(() => null);
  if (have === null || have >= SOL_NEEDED) return null;
  return { ...p, outToken: SOLANA_NATIVE, amount: SOL_RESERVE_USDG, noGasLeg: true };
}

export async function relayQuote(p: RelayLeg): Promise<RelayQuote> {
  const solGas = await solanaGasLeg(p);
  if (solGas) {
    const q = await relayQuote({ ...p, amount: p.amount - solGas.amount, noGasLeg: true });
    return { ...q, details: { ...q.details, currencyGasTopup: { amountUsd: formatUnits(solGas.amount, USDG_DECIMALS) } } };
  }
  const gas = await gasReserveUsd(p);
  if (gas > 0) {
    const q = await relayQuoteOnce(p, gas).catch(() => null);
    if (q) return q;
  }
  return relayQuoteOnce(p, 0);
}

async function relayQuoteOnce(p: RelayLeg, gasUsd: number): Promise<RelayQuote> {
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
      slippageTolerance: String(legSlippageBps),
      ...(gasUsd > 0 ? { topupGas: true, topupGasAmount: String(Math.round(gasUsd * 1e6)) } : {}),
    }),
  });
  const q = (await res.json()) as RelayQuote;
  if (!res.ok || !q.steps) throw new ExecError(`No route right now: ${q.message ?? res.status}`);
  return q;
}

export function toPreview(q: RelayQuote, fallbackSymbol: string): Preview {
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
    // Relay's total impact is measured in USD out vs USD in, so it already includes its fees. (Not the gas
    // reserve: that's the user's own gas token, kept in their wallet, shown on its own line.)
    costPct: Math.max(0, -(Number(q.details?.totalImpact?.percent) || 0)),
    legs: 1,
    gasReserveUsd: Number(q.details?.currencyGasTopup?.amountUsd) || undefined,
  };
}

/** Quote + every transaction it asks for (EVM or Solana), then waits for Relay to report the transfer delivered. */
export async function relay(s: Signer, p: RelayLeg) {
  const solGas = await solanaGasLeg(p);
  if (solGas) {
    const before = await lamports(p.recipient);
    await relay(s, solGas);
    await waitForArrival(() => lamports(p.recipient), before, 5 * 60_000).catch(() => BigInt(0));
    p = { ...p, amount: p.amount - solGas.amount, noGasLeg: true };
  }
  const q = await relayQuote(p);
  checkAutoCost(toPreview(q, "").costPct);
  await noteLanding(s, p);
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
export async function waitForArrival(read: () => Promise<bigint>, before: bigint, timeoutMs = 120_000, failed?: () => Promise<string | null>): Promise<bigint> {
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

export const usdgOf = (s: { address: Address }) => () => erc20Balance(ROBINHOOD_CHAIN_ID, USDG, s.address);

/** Takes Pecun's fee from a USDG amount on Robinhood Chain; returns what's left. */
export async function takeUsdgFee(s: Signer, total: bigint, on: Progress): Promise<bigint> {
  const fee = (total * BigInt(feeBps)) / BigInt(10_000);
  on("fee", fee > BigInt(0) ? "running" : "skipped");
  if (fee > BigInt(0) && !TREASURY) {
    console.error("[pecun] NEXT_PUBLIC_PECUN_TREASURY is not set: no fee wallet to send the platform fee to.");
    throw new ExecError("Deposits are paused for a moment: Pecun's fee wallet isn't set up yet. Nothing was sent.");
  }
  const run = runs.get(s);
  if (fee > BigInt(0) && run?.deferFee) {
    // Inside a deposit: the fee stays in the user's wallet and is only sent once the deposit has landed (see guarded).
    run.fee += fee;
    on("fee", "pending", "Taken once your deposit lands");
    return total - fee;
  }
  if (fee > BigInt(0)) {
    await sendEvm(s, ROBINHOOD_CHAIN_ID, { to: USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TREASURY as Address, fee] }) });
    on("fee", "done");
  }
  return total - fee;
}

/* ---------------- Run safety: fee only after success, stranded funds brought home, cost cap on automatic moves ---------------- */

/** A token a run sent to the user on another chain, with the balance before it arrived. */
type Landing = { chainId: number; token: Address; owner: Address; before: bigint };
type Run = { deferFee: boolean; fee: bigint; landings: Landing[] };
const runs = new WeakMap<object, Run>();
/** Runs in progress in this tab: the stranded-funds check waits while any are going. */
let activeRuns = 0;
export const runsInProgress = () => activeRuns > 0;
/** While > 0 (automatic returns and sweeps), every bridge or swap leg must cost at most MAX_ROUTE_COST_PCT. */
let autoGuard = 0;
const NATIVE_TOKENS = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);

function checkAutoCost(costPct: number | undefined) {
  if (autoGuard > 0 && costPct !== undefined && costPct > MAX_ROUTE_COST_PCT)
    throw new ExecError(`Moving these funds home would cost ${costPct.toFixed(2)}% right now, above Pecun's ${MAX_ROUTE_COST_PCT}% limit. Pecun will try again later.`);
}

/** Remembers what a Relay leg delivers to the user's own EVM wallet, so a failed run can send it home. */
async function noteLanding(s: Signer, p: RelayLeg) {
  const run = runs.get(s);
  if (!run || p.to === ROBINHOOD_CHAIN_ID || !isAddr(p.recipient) || p.recipient.toLowerCase() !== s.address.toLowerCase()) return;
  const token = p.outToken as Address;
  if (!isAddr(token) || NATIVE_TOKENS.has(token.toLowerCase())) return;
  if (run.landings.some((l) => l.chainId === p.to && l.token.toLowerCase() === token.toLowerCase())) return;
  const before = await erc20Balance(p.to, token, s.address).catch(() => null);
  if (before !== null) run.landings.push({ chainId: p.to, token, owner: s.address, before });
}

/** Runs `f` with every leg held to MAX_ROUTE_COST_PCT. */
export async function withCostCap<T>(f: () => Promise<T>): Promise<T> {
  autoGuard++;
  try {
    return await f();
  } finally {
    autoGuard--;
  }
}

/**
 * Sends anything a failed run left on another chain back to USDG. What can't move now (still in flight, or too costly
 * right now) is remembered, and the background check (AutoWithdraw) tries again every few minutes.
 */
async function sweepHome(s: Signer, landings: Landing[]) {
  for (const l of [...landings].reverse()) {
    try {
      const moved = await sweepOne(s, l);
      if (!moved) rememberStranded(l);
    } catch (e) {
      console.error("[pecun] couldn't bring stranded funds home yet:", e);
      rememberStranded(l);
    }
  }
}

/** Moves what arrived since `before` home. False when nothing has arrived yet. */
async function sweepOne(s: Signer, l: Landing): Promise<boolean> {
  const now = await erc20Balance(l.chainId, l.token, l.owner);
  if (now <= l.before) return false;
  const amount = now - l.before;
  await withCostCap(async () => {
    const plan = await planRoute({ from: l.chainId, to: ROBINHOOD_CHAIN_ID, inToken: l.token, outToken: USDG, amount, user: l.owner, recipient: l.owner }, "USDG");
    checkAutoCost(routeCostPct(plan.preview));
    const before = await usdgOf(s)();
    await runRoute(s, { from: l.chainId, to: ROBINHOOD_CHAIN_ID, inToken: l.token, outToken: USDG, amount, user: l.owner, recipient: l.owner });
    await waitForArrival(usdgOf(s), before, 10 * 60_000).catch(() => BigInt(0));
  });
  return true;
}

/* Stranded funds, remembered per user on this device until they're home (or a week has passed). */
type StrandedNote = { chainId: number; token: Address; before: string; at: number };
const strandedKey = (owner: string) => `pecun:stranded:${owner.toLowerCase()}`;
const WEEK = 7 * 24 * 3600_000;
function readStranded(owner: string): StrandedNote[] {
  try {
    return (JSON.parse(globalThis.localStorage?.getItem(strandedKey(owner)) ?? "[]") as StrandedNote[]).filter((n) => Date.now() - n.at < WEEK);
  } catch {
    return [];
  }
}
function writeStranded(owner: string, list: StrandedNote[]) {
  try {
    if (list.length) globalThis.localStorage?.setItem(strandedKey(owner), JSON.stringify(list));
    else globalThis.localStorage?.removeItem(strandedKey(owner));
  } catch {
    /* storage unavailable */
  }
}
function rememberStranded(l: Landing) {
  const list = readStranded(l.owner).filter((n) => !(n.chainId === l.chainId && n.token.toLowerCase() === l.token.toLowerCase()));
  writeStranded(l.owner, [...list, { chainId: l.chainId, token: l.token, before: l.before.toString(), at: Date.now() }]);
}
export const hasStranded = (owner: string) => readStranded(owner).length > 0;

/** Background check: brings home funds a failed run left behind. Returns how many were moved. */
export async function sweepStranded(s: Signer): Promise<number> {
  if (activeRuns > 0) return 0;
  let moved = 0;
  const keep: StrandedNote[] = [];
  for (const n of readStranded(s.address)) {
    const l: Landing = { chainId: n.chainId, token: n.token, owner: s.address, before: BigInt(n.before) };
    try {
      // If the balance dropped below the mark (spent elsewhere), only what arrives from here on counts.
      const now = await erc20Balance(l.chainId, l.token, l.owner);
      if (now < l.before) l.before = now;
      if (await sweepOne(s, l)) moved++;
      else keep.push({ ...n, before: l.before.toString() });
    } catch (e) {
      console.error("[pecun] stranded funds still waiting:", e);
      keep.push({ ...n, before: l.before.toString() });
    }
  }
  writeStranded(s.address, keep);
  return moved;
}

/**
 * Wraps an adapter so every run is safe:
 * - deposit: Pecun's fee is only sent after the deposit lands; if the run fails, no fee is taken and anything already
 *   moved to the vault's chain goes back to USDG.
 * - withdraw: if it fails part-way, what reached another chain goes home the same way.
 * - bringHome (automatic returns): every leg is held to Pecun's route-cost limit, or it waits and tries again later.
 */
export function guarded(a: Adapter): Adapter {
  const run = async <T,>(s: Signer, deferFee: boolean, on: Progress, f: (s: Signer) => Promise<T>): Promise<T> => {
    const rs: Signer = { ...s };
    const r: Run = { deferFee, fee: BigInt(0), landings: [] };
    runs.set(rs, r);
    activeRuns++;
    try {
      const out = await f(rs);
      if (r.fee > BigInt(0)) {
        on("fee", "running");
        await sendEvm(s, ROBINHOOD_CHAIN_ID, { to: USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TREASURY as Address, r.fee] }) }).then(
          () => on("fee", "done"),
          (e) => {
            console.error("[pecun] deposit landed but the fee transfer failed:", e);
            on("fee", "skipped");
          },
        );
      }
      return out;
    } catch (e) {
      if (r.fee > BigInt(0)) on("fee", "skipped", "Not charged: the deposit didn't complete");
      if (r.landings.length) {
        await sweepHome(s, r.landings);
        if (e instanceof ExecError || e instanceof Error) e.message += " No fee was taken; any funds already moved are being sent back to your wallet.";
      }
      throw e;
    } finally {
      activeRuns--;
    }
  };
  return {
    ...a,
    deposit: (s, usdg, on) => run(s, true, on, (rs) => a.deposit(rs, usdg, on)),
    withdraw: (s, amount, on) => run(s, false, on, (rs) => a.withdraw(rs, amount, on)),
    bringHome: a.bringHome ? (s, on) => run(s, false, on, (rs) => withCostCap(() => a.bringHome!(rs, on))) : undefined,
  };
}

/* ---------------- Routes: always end in the vault's own asset ---------------- */

/** USDC on each chain: the stepping stone when Relay has no direct route to a vault asset. */
export const USDC_ON: Record<number, Address> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  143: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  999: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
  747474: "0x203A662b0BD271A6ed5a60EdFbd04bFce608FD36",
};

export const outOf = (q: RelayQuote) => {
  const out = BigInt(q.details?.currencyOut?.amount ?? "0");
  return { out, min: BigInt(q.details?.currencyOut?.minimumAmount ?? out.toString()), decimals: q.details?.currencyOut?.currency?.decimals ?? 6 };
};

/**
 * A leg Relay can't do, between USDC on a hub chain (Base or Arbitrum) and a chain Relay doesn't reach: LI.FI, or
 * Circle's CCTP when both ends are native USDC. On a deposit it runs after the Relay hop; on a withdrawal, before it.
 */
export type FarLeg = { via: "lifi" | "cctp"; leg: LifiLeg; out: bigint; min: bigint; decimals: number; preview: Preview };
/**
 * A planned route. `hops` are Relay transfers (one, or two through a middle token); `lifi` is a LI.FI transfer (with
 * an optional small leg into the chain's native coin first); `far` is the hub route for chains Relay can't reach.
 * `keep` is native coin a via-native deposit leaves in the wallet instead of swapping it into the vault's asset.
 */
type Plan = { hops: RelayLeg[]; preview: Preview; out: bigint; far?: FarLeg; lifi?: { gas?: LifiLeg; main: LifiLeg }; keep?: bigint; via?: string };

const NATIVE_EVM = "0x0000000000000000000000000000000000000000";
const isNativeEvm = (t: string) => t.toLowerCase() === NATIVE_EVM || t.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";


/** Relay's direct route. */
async function directPlan(leg: RelayLeg, outSymbol: string): Promise<Plan> {
  const q = await relayQuote(leg);
  return { hops: [leg], preview: toPreview(q, outSymbol), out: outOf(q).out, via: "relay" };
}

/** Two hops through USDC on the vault's chain: bridge to USDC, then swap USDC into the asset there (or the reverse). */
async function viaUsdcPlan(leg: RelayLeg, outSymbol: string): Promise<Plan | null> {
  const deposit = leg.from === ROBINHOOD_CHAIN_ID;
  const vaultChain = deposit ? leg.to : leg.from;
  const mid = USDC_ON[vaultChain];
  const vaultToken = deposit ? leg.outToken : leg.inToken;
  if (!mid || vaultChain === ROBINHOOD_CHAIN_ID || vaultToken.toLowerCase() === mid.toLowerCase()) return null;
  const hop1: RelayLeg = deposit ? { ...leg, outToken: mid } : { ...leg, to: vaultChain, outToken: mid, recipient: leg.user };
  const q1 = await relayQuote(hop1);
  const o1 = outOf(q1);
  const hop2: RelayLeg = deposit
    ? { from: vaultChain, to: vaultChain, inToken: mid, outToken: leg.outToken, amount: o1.out, user: leg.recipient, recipient: leg.recipient }
    : { from: vaultChain, to: leg.to, inToken: mid, outToken: leg.outToken, amount: o1.out, user: leg.user, recipient: leg.recipient };
  const q2 = await relayQuote(hop2);
  const o2 = outOf(q2);
  return { hops: [hop1, hop2], preview: chainPreview(toPreview(q1, "USDC"), o1.out, o1.min, toPreview(q2, outSymbol), o2.out, o2.min, o2.decimals), out: o2.out, via: "relay-usdc" };
}

/**
 * Two hops through the vault chain's native coin. Deposit: bridge USDG into the native coin, keep a slice of it in the
 * wallet for transactions (when the wallet there is short), swap the rest into the vault's asset. Withdraw: swap the
 * asset into the native coin there, then bridge it home. Every asset has a market against its chain's native coin.
 */
async function viaNativePlan(leg: RelayLeg, outSymbol: string): Promise<Plan | null> {
  const deposit = leg.from === ROBINHOOD_CHAIN_ID;
  const vaultChain = deposit ? leg.to : leg.from;
  const vaultToken = deposit ? leg.outToken : leg.inToken;
  const c = evmChain(vaultChain);
  if (!c || c.feeToken || c.gasReserveUsd === 0 || vaultChain === ROBINHOOD_CHAIN_ID || isNativeEvm(vaultToken)) return null;
  if (deposit) {
    const keepUsd = leg.inToken.toLowerCase() === USDG.toLowerCase() ? await gasReserveUsd(leg) : 0;
    const hop1: RelayLeg = { ...leg, outToken: NATIVE_EVM, gasUsd: 0 };
    const q1 = await relayQuote(hop1);
    const o1 = outOf(q1);
    const inUsd = Number(formatUnits(leg.amount, USDG_DECIMALS));
    const keep = keepUsd > 0 && inUsd > 0 ? (o1.out * BigInt(Math.round(keepUsd * 1e6))) / BigInt(Math.round(inUsd * 1e6)) : BigInt(0);
    if (keep >= o1.out) return null;
    const hop2: RelayLeg = { from: vaultChain, to: vaultChain, inToken: NATIVE_EVM, outToken: leg.outToken, amount: o1.out - keep, user: leg.recipient, recipient: leg.recipient, gasUsd: 0 };
    const q2 = await relayQuote(hop2);
    const o2 = outOf(q2);
    const p = chainPreview(toPreview(q1, c.native), o1.out - keep, o1.min > keep ? o1.min - keep : o1.min, toPreview(q2, outSymbol), o2.out, o2.min, o2.decimals);
    return { hops: [hop1, hop2], preview: { ...p, gasReserveUsd: keepUsd || undefined }, out: o2.out, keep, via: "relay-native" };
  }
  const hop1: RelayLeg = { from: vaultChain, to: vaultChain, inToken: leg.inToken, outToken: NATIVE_EVM, amount: leg.amount, user: leg.user, recipient: leg.user, gasUsd: 0 };
  const q1 = await relayQuote(hop1);
  const o1 = outOf(q1);
  const hop2: RelayLeg = { from: vaultChain, to: leg.to, inToken: NATIVE_EVM, outToken: leg.outToken, amount: o1.out, user: leg.user, recipient: leg.recipient };
  const q2 = await relayQuote(hop2);
  const o2 = outOf(q2);
  return { hops: [hop1, hop2], preview: chainPreview(toPreview(q1, c.native), o1.out, o1.min, toPreview(q2, outSymbol), o2.out, o2.min, o2.decimals), out: o2.out, via: "relay-native" };
}

/**
 * LI.FI's best route (it aggregates many bridges and DEXes: Across, Stargate, CCTP, Mayan, deBridge, ...). On a
 * deposit, when the wallet on the vault's chain is short on its native coin, a small separate LI.FI leg delivers it.
 */
async function lifiPlan(leg: RelayLeg): Promise<Plan | null> {
  if (leg.from === leg.to || !evmChain(leg.from) || !evmChain(leg.to)) return null;
  const fromUsdg = leg.from === ROBINHOOD_CHAIN_ID && leg.inToken.toLowerCase() === USDG.toLowerCase();
  const reserveUsd = fromUsdg && !isNativeEvm(leg.outToken) ? await gasReserveUsd(leg) : 0;
  let gasAmt = reserveUsd > 0 ? BigInt(Math.round(reserveUsd * 1e6)) : BigInt(0);
  if (gasAmt * BigInt(5) >= leg.amount) gasAmt = BigInt(0);
  const main: LifiLeg = { fromChain: leg.from, toChain: leg.to, fromToken: leg.inToken, toToken: leg.outToken, amount: leg.amount - gasAmt, from: leg.user, to: leg.recipient };
  const r = await lifiRoute(main);
  const gas: LifiLeg | undefined =
    gasAmt > BigInt(0) ? { fromChain: leg.from, toChain: leg.to, fromToken: leg.inToken, toToken: NATIVE_EVM, amount: gasAmt, from: leg.user, to: leg.recipient } : undefined;
  return { hops: [], preview: { ...lifiPreview(r), gasReserveUsd: gas ? reserveUsd : undefined }, out: BigInt(r.toAmount), lifi: { gas, main }, via: "lifi" };
}

/** One LI.FI transfer from the user's wallet: approve the token if needed, then send. Returns the transaction hash. */
async function lifiSend(s: Signer, leg: LifiLeg): Promise<Hex> {
  const q = await lifiQuote(leg);
  if (!isNativeEvm(leg.fromToken)) {
    const spender = q.estimate.approvalAddress ?? q.transactionRequest.to!;
    const token = leg.fromToken as Address;
    const allowance = await chainClient(leg.fromChain).readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [s.address, spender] });
    if (allowance < leg.amount) await sendEvm(s, leg.fromChain, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, leg.amount] }) });
  }
  return sendEvm(s, leg.fromChain, { to: q.transactionRequest.to!, data: q.transactionRequest.data as Hex, value: q.transactionRequest.value ? BigInt(q.transactionRequest.value) : undefined });
}

/** Runs a LI.FI plan: the native-coin leg first (and waits for it), then the main transfer. The caller waits for the main arrival. */
async function runLifi(s: Signer, p: { gas?: LifiLeg; main: LifiLeg }) {
  let waitGas: (() => Promise<unknown>) | null = null;
  if (p.gas) {
    const g = p.gas;
    const read = () => tokenBalance(g.toChain, NATIVE_EVM, g.to as Address);
    const before = await read();
    const hash = await lifiSend(s, g);
    waitGas = () => waitForArrival(read, before, 10 * 60_000, lifiFailed(hash, g.fromChain, g.toChain)).catch(() => BigInt(0));
  }
  const m = p.main;
  await noteLanding(s, { from: m.fromChain, to: m.toChain, inToken: m.fromToken, outToken: m.toToken, amount: m.amount, user: m.from, recipient: m.to });
  await lifiSend(s, m);
  if (waitGas) await waitGas();
}

/**
 * Plans USDG → vault asset (or back), always ending in the vault's own asset. Quotes Relay's direct route and the
 * route through USDC on the vault's chain side by side, and picks whichever delivers more. `force` is for tests.
 */
export async function planRoute(leg: RelayLeg, outSymbol: string, force?: "direct" | "via"): Promise<Plan> {
  if (!viaRelay(leg.from) || !viaRelay(leg.to)) return hubRoute(leg, outSymbol);
  const [direct, via, native, lifi] = await Promise.allSettled([
    force === "via" ? Promise.reject(new ExecError("skipped")) : directPlan(leg, outSymbol),
    force === "direct" ? Promise.resolve(null) : viaUsdcPlan(leg, outSymbol),
    force ? Promise.resolve(null) : viaNativePlan(leg, outSymbol),
    force ? Promise.resolve(null) : lifiPlan(leg),
  ]);
  const options = [direct, via, native, lifi].flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  if (!options.length) throw direct.status === "rejected" ? direct.reason : new ExecError("No route right now.");
  // The route that delivers the most of the vault's asset wins (each one's own gas slice already taken out).
  return options.reduce((best, o) => (o.out > best.out ? o : best));
}

/** Runs a planned route: one Relay transfer, or bridge to USDC, wait for it, then swap what arrived. */
export async function runRoute(s: Signer, leg: RelayLeg): Promise<void> {
  const plan = await planRoute(leg, "");
  if (plan.far) return runHubRoute(s, plan as Plan & { far: FarLeg });
  if (plan.lifi) return runLifi(s, plan.lifi);
  const { hops } = plan;
  if (hops.length === 1) return relay(s, hops[0]);
  const [h1, h2] = hops;
  const read = () => tokenBalance(h1.to, h1.outToken as Address, h1.recipient as Address);
  const before = await read();
  await relay(s, h1);
  const got = await waitForArrival(read, before, 10 * 60_000);
  // A via-native deposit keeps a slice of the native coin in the wallet for transactions on that chain.
  const keep = plan.keep && plan.keep < got ? plan.keep : BigInt(0);
  await relay(s, { ...h2, amount: got - keep });
}

/** Brings funds back to USDG on Robinhood Chain, then takes Pecun's fee from what arrived. */
export async function backToUsdg(s: Signer, leg: Omit<RelayLeg, "to" | "outToken" | "recipient">, on: Progress): Promise<string> {
  on("bridge", "running");
  const before = await usdgOf(s)();
  await runRoute(s, { ...leg, to: ROBINHOOD_CHAIN_ID, outToken: USDG, recipient: s.address });
  const back = await waitForArrival(usdgOf(s), before, 10 * 60_000);
  on("bridge", "done", `${formatUnits(back, USDG_DECIMALS)} USDG`);
  const kept = await takeUsdgFee(s, back, on);
  return `${formatUnits(kept, USDG_DECIMALS)} USDG`;
}

export const IN_STEPS: Step[] = [
  { id: "fee", label: "Pecun fee (taken once your deposit lands)" },
  { id: "bridge", label: "Move and swap funds" },
  { id: "deposit", label: "Deposit" },
];
export const OUT_STEPS: Step[] = [
  { id: "withdraw", label: "Withdraw" },
  { id: "bridge", label: "Move funds back to your wallet" },
  { id: "fee", label: "Pecun fee" },
];

/* ---------------- EVM vaults: one adapter, a small protocol object per family ---------------- */

/** `value` is native coin sent with the call (deposits into native-coin markets such as Venus vBNB). */
export type Call = { to: Address; data: Hex; value?: bigint };
/** `address` is the zero address (NATIVE) when the asset is the chain's native coin. */
export type TokenMeta = { address: Address; decimals: number; symbol: string };
/** What differs between EVM vault families. Amounts are in the underlying asset's smallest units. */
export type Proto = {
  asset: () => Promise<TokenMeta>;
  position: (owner: Address) => Promise<bigint>;
  spender: () => Promise<Address>;
  deposit: (owner: Address, amount: bigint) => Promise<Call>;
  withdraw: (owner: Address, amount: bigint | "max") => Promise<Call>;
  /** Optional: a token the withdraw call pulls from the user (e.g. sUSDS into Spark's PSM), approved first. */
  withdrawSpend?: (owner: Address, amount: bigint | "max") => Promise<{ token: Address; spender: Address; amount: bigint } | null>;
};

export const MAX_UINT = BigInt(2) ** BigInt(256) - BigInt(1);
export const isAddr = (a?: string | null): a is Address => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
/** Robinhood Chain USDG: already the user's wallet token, so there is nothing to bridge or swap. */
export const isHomeUsdg = (chainId: number, token: string) => chainId === ROBINHOOD_CHAIN_ID && token.toLowerCase() === USDG.toLowerCase();

export async function tokenMeta(chainId: number, token: Address): Promise<TokenMeta> {
  const c = chainClient(chainId);
  const [decimals, symbol] = await Promise.all([
    c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    c.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "token"),
  ]);
  return { address: token, decimals, symbol };
}

/** Caches a lazy async value, retrying after a failure. */
export function lazy<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= f().catch((e) => ((p = undefined), Promise.reject(e))));
}

const sameAmountPreview = (amount: string, symbol: string): Preview => ({ out: amount, outSymbol: symbol, minOut: amount, slippagePct: 0, impactPct: 0, feesUsd: 0, seconds: 0 });
export const netOfFee = (usdg: string) => parseUnits(usdg, USDG_DECIMALS) - (parseUnits(usdg, USDG_DECIMALS) * BigInt(feeBps)) / BigInt(10_000);

export function evmVault(chainId: number, proto: Proto, label: string): Adapter {
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
      return (await planRoute({ from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: a.address, amount: net, user: s.address, recipient: s.address }, a.symbol)).preview;
    },

    previewWithdraw: async (s, amount) => {
      const a = await asset();
      if (await home()) return sameAmountPreview(amount, "USDG");
      return (await planRoute({ from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: a.address, outToken: USDG, amount: parseUnits(amount, a.decimals), user: s.address, recipient: s.address }, "USDG")).preview;
    },

    deposit: async (s, usdg, on) => {
      const a = await asset();
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      let received = net;
      if (await home()) {
        on("bridge", "skipped");
      } else {
        on("bridge", "running");
        const read = () => tokenBalance(chainId, a.address, s.address);
        const before = await read();
        await runRoute(s, { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: a.address, amount: net, user: s.address, recipient: s.address });
        received = await waitForArrival(read, before, 10 * 60_000);
        on("bridge", "done", `${formatUnits(received, a.decimals)} ${a.symbol}`);
      }
      on("deposit", "running");
      // Native-coin markets take the coin as the call's value; no approval. (Gas on top comes from the gas tank.)
      if (!isNative(a.address)) await ensureAllowance(s, chainId, a.address, await proto.spender(), received);
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
      const held = await proto.position(s.address);
      if (held === BigInt(0)) throw new ExecError("You don't have a position in this vault.");
      const want = amount === "max" ? "max" : parseUnits(amount, a.decimals);
      const spend = await proto.withdrawSpend?.(s.address, want);
      if (spend) await ensureAllowance(s, chainId, spend.token, spend.spender, spend.amount);
      const native = isNative(a.address);
      const read = () => tokenBalance(chainId, a.address, s.address);
      const before = await read();
      await sendEvm(s, chainId, await proto.withdraw(s.address, want));
      // A native coin's balance also moves by the gas paid (and any gas top-up), so count what left the position
      // instead (slightly under, if interest accrued at redeem: safe to bridge).
      const out = native ? held - (await proto.position(s.address)) : (await read()) - before;
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

export function erc4626(chainId: number, vault: Address): Proto {
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

export function yearn(chainId: number, vault: Address): Proto {
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

export function aaveStyle(chainId: number, pool: () => Promise<Address>, underlying: () => Promise<Address>): Proto {
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

/* Aave V4: each spoke lends one reserve id; supply / withdraw go through the spoke. */
const AAVE_V4_ABI = parseAbi([
  "function getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)",
  "function supply(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
]);

export function aaveV4(chainId: number, spoke: Address, reserveId: bigint, underlying: Address): Proto {
  const supplied = (owner: Address) => chainClient(chainId).readContract({ address: spoke, abi: AAVE_V4_ABI, functionName: "getUserSuppliedAssets", args: [reserveId, owner] });
  return {
    asset: () => tokenMeta(chainId, underlying),
    position: supplied,
    spender: async () => spoke,
    deposit: async (owner, amount) => ({ to: spoke, data: encodeFunctionData({ abi: AAVE_V4_ABI, functionName: "supply", args: [reserveId, amount, owner] }) }),
    withdraw: async (owner, amount) => ({
      to: spoke,
      data: encodeFunctionData({ abi: AAVE_V4_ABI, functionName: "withdraw", args: [reserveId, amount === "max" ? await supplied(owner) : amount, owner] }),
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

export function comet(chainId: number, market: Address): Proto {
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

export function compoundV2(chainId: number, cToken: Address): Proto {
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

/* Compound v2 native-coin markets (Venus vBNB, cETH-style): mint() is payable; redeeming pays out the coin itself. */
const CETHER_ABI = parseAbi(["function mint() payable"]);

export function compoundV2Native(chainId: number, cToken: Address, symbol: string, decimals = 18): Proto {
  const base = compoundV2(chainId, cToken);
  return {
    ...base,
    asset: async () => ({ address: NATIVE, decimals, symbol }),
    deposit: async (_owner, amount) => ({ to: cToken, data: encodeFunctionData({ abi: CETHER_ABI, functionName: "mint" }), value: amount }),
  };
}

/*
 * Spark PSM3 (L2s): swaps USDC <-> sUSDS at Spark's oracle rate, no slippage. The "vault" is holding sUSDS; its
 * value is shown in USDC, the asset the route delivers. Addresses checked on-chain (usdc() / susds() match).
 */
export const SPARK_PSM3: Record<number, Address> = {
  42161: "0x2B05F8e1cACC6974fD79A673a341Fe1f58d27266",
  10: "0xe0F9978b907853F354d79188A3dEfbD41978af62",
  130: "0x7b42Ed932f26509465F7cE3FAF76FfCe1275312f",
  8453: "0x1601843c5E9bC251A3272907010AFa41Fa18347E",
};
const PSM3_ABI = parseAbi([
  "function usdc() view returns (address)",
  "function susds() view returns (address)",
  "function previewSwapExactIn(address assetIn, address assetOut, uint256 amountIn) view returns (uint256)",
  "function previewSwapExactOut(address assetIn, address assetOut, uint256 amountOut) view returns (uint256)",
  "function swapExactIn(address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, address receiver, uint256 referralCode) returns (uint256)",
  "function swapExactOut(address assetIn, address assetOut, uint256 amountOut, uint256 maxAmountIn, address receiver, uint256 referralCode) returns (uint256)",
]);

export function psm3(chainId: number, psm: Address, susds: Address): Proto {
  const c = () => chainClient(chainId);
  const usdc = lazy(() => c().readContract({ address: psm, abi: PSM3_ABI, functionName: "usdc" }));
  const preview = (fn: "previewSwapExactIn" | "previewSwapExactOut", a: Address, b: Address, amt: bigint) => c().readContract({ address: psm, abi: PSM3_ABI, functionName: fn, args: [a, b, amt] });
  // The rate only moves up, and slowly; 0.1% covers the seconds between quote and inclusion.
  const less = (x: bigint) => (x * BigInt(9990)) / BigInt(10_000);
  const more = (x: bigint) => (x * BigInt(10_010)) / BigInt(10_000) + BigInt(1);
  /** sUSDS to sell for `amount` USDC (all of it for "max", or when that's within rounding of everything). */
  const sell = async (owner: Address, amount: bigint | "max") => {
    const bal = await erc20Balance(chainId, susds, owner);
    if (amount === "max") return { all: true, shares: bal };
    const need = more(await preview("previewSwapExactOut", susds, await usdc(), amount));
    return need >= bal ? { all: true, shares: bal } : { all: false, shares: need };
  };
  return {
    asset: async () => tokenMeta(chainId, await usdc()),
    position: async (owner) => {
      const bal = await erc20Balance(chainId, susds, owner);
      return bal > BigInt(0) ? preview("previewSwapExactIn", susds, await usdc(), bal) : BigInt(0);
    },
    spender: async () => psm,
    deposit: async (owner, amount) => {
      const u = await usdc();
      const min = less(await preview("previewSwapExactIn", u, susds, amount));
      return { to: psm, data: encodeFunctionData({ abi: PSM3_ABI, functionName: "swapExactIn", args: [u, susds, amount, min, owner, BigInt(0)] }) };
    },
    withdraw: async (owner, amount) => {
      const u = await usdc();
      const { all, shares } = await sell(owner, amount);
      if (all || amount === "max") {
        const min = less(await preview("previewSwapExactIn", susds, u, shares));
        return { to: psm, data: encodeFunctionData({ abi: PSM3_ABI, functionName: "swapExactIn", args: [susds, u, shares, min, owner, BigInt(0)] }) };
      }
      return { to: psm, data: encodeFunctionData({ abi: PSM3_ABI, functionName: "swapExactOut", args: [susds, u, amount, shares, owner, BigInt(0)] }) };
    },
    withdrawSpend: async (owner, amount) => ({ token: susds, spender: psm, amount: (await sell(owner, amount)).shares }),
  };
}

/* Morpho markets: supply directly to one isolated market on Morpho's core contract. */
/** Morpho's core contract per chain (from Morpho's own API). */
export const MORPHO_BLUE: Record<number, Address> = {
  1: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  8453: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  42161: "0x6c247b1F6182318877311737BaC0844bAa518F5e",
  10: "0xce95AfbB8EA029495c66020883F87aaE8864AF92",
  143: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
  999: "0x68e37dE8d93d3496ae143F2E900490f6280C57cD",
  4663: "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010",
  747474: "0xD50F2DffFd62f94Ee4AEd9ca05C61d0753268aBc",
  137: "0x1bF0c2541F820E775182832f06c0B7Fc27A25f67",
  130: "0x8f5ae9CddB9f68de460C77730b018Ae7E04a140A",
  5042: "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD",
  988: "0xa40103088A899514E3fe474cD3cc5bf811b1102e",
  196: "0xeb00C490E888286357dC5B0a35D37D9260D11Ab5",
  4217: "0x10EE9AAC980A180dd4DcFc96C746d60B0EA88f97",
};
const MORPHO_ABI = parseAbi([
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
  "function withdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
]);

export function morphoMarket(chainId: number, id: Hex): Proto {
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
export function evmToken(chainId: number, token: Address, symbol: string): Adapter {
  const meta = lazy(() => tokenMeta(chainId, token));
  return {
    positionSymbol: symbol,
    depositSteps: [IN_STEPS[0], { id: "bridge", label: `Move funds and buy ${symbol}` }],
    withdrawSteps: [{ id: "bridge", label: `Sell ${symbol} and move funds back` }, OUT_STEPS[2]],
    position: async (s) => Number(formatUnits(await erc20Balance(chainId, token, s.address), (await meta()).decimals)),
    previewDeposit: async (s, usdg) =>
      (await planRoute({ from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount: netOfFee(usdg), user: s.address, recipient: s.address }, symbol)).preview,
    previewWithdraw: async (s, amount) =>
      (await planRoute({ from: chainId, to: ROBINHOOD_CHAIN_ID, inToken: token, outToken: USDG, amount: parseUnits(amount, (await meta()).decimals), user: s.address, recipient: s.address }, "USDG")).preview,
    deposit: async (s, usdg, on) => {
      const m = await meta();
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const read = () => erc20Balance(chainId, token, s.address);
      const before = await read();
      await runRoute(s, { from: ROBINHOOD_CHAIN_ID, to: chainId, inToken: USDG, outToken: token, amount: net, user: s.address, recipient: s.address });
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
export const HL_USDC = "0x00000000000000000000000000000000";

export const hlInfo = async <T,>(body: object): Promise<T> => {
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

export async function signDigest(s: Signer, digest: Hex): Promise<Hex> {
  const r = await s.signEvmDigest(digest);
  if (!r.ok) throw new ExecError(r.error);
  return r.signature;
}

export async function hlExchange(body: object) {
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
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
/** Gas a Sui transaction may use (MIST). The gas tank tops up when the user has less. */
export const SUI_GAS = BigInt(20_000_000); // 0.02 SUI

/** `slippage` (optional) is a fraction, e.g. 0.005; LI.FI picks its own default when it's left out. */
export type LifiLeg = { fromChain: number; toChain: number; fromToken: string; toToken: string; amount: bigint; from: string; to: string; slippage?: number };
type LifiFee = { amountUSD?: string; included?: boolean };
export type LifiRoute = {
  toAmount: string;
  toAmountMin: string;
  fromAmountUSD?: string;
  toAmountUSD?: string;
  toToken: { symbol: string; decimals: number };
  steps: { estimate: { executionDuration?: number; feeCosts?: LifiFee[]; gasCosts?: LifiFee[] }; action?: { slippage?: number } }[];
};

/** Best route (price only; nothing is built), so previews work before the user has gas on the far side. */
export async function lifiRoute(p: LifiLeg): Promise<LifiRoute> {
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
      options: { order: "CHEAPEST", slippage: p.slippage ?? legSlippageBps / 10_000 },
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { routes?: LifiRoute[]; message?: string };
  if (!j.routes?.length) throw new ExecError(`No route right now${j.message ? `: ${j.message}` : ""}.`);
  return j.routes[0];
}

export type LifiQuote = { transactionRequest: { to?: Address; data: string; value?: string }; estimate: { approvalAddress?: Address; toAmount: string } };

/** A ready-to-sign transaction for one leg (EVM call data, or base64 Sui transaction bytes). */
export async function lifiQuote(p: LifiLeg): Promise<LifiQuote> {
  const q = new URLSearchParams({
    fromChain: String(p.fromChain),
    toChain: String(p.toChain),
    fromToken: p.fromToken,
    toToken: p.toToken,
    fromAmount: p.amount.toString(),
    fromAddress: p.from,
    toAddress: p.to,
    slippage: String(p.slippage ?? legSlippageBps / 10_000),
  });
  const res = await fetch(`${LIFI}/quote?${q}`);
  const j = (await res.json().catch(() => ({}))) as Partial<LifiQuote> & { message?: string };
  if (!j.transactionRequest?.data) throw new ExecError(`Couldn't build the transfer${j.message ? `: ${j.message}` : ""}.`);
  const est = (j as { estimate?: { fromAmountUSD?: string; toAmountUSD?: string } }).estimate;
  const fromUsd = Number(est?.fromAmountUSD) || 0;
  if (fromUsd > 0) checkAutoCost(Math.max(0, ((fromUsd - (Number(est?.toAmountUSD) || 0)) / fromUsd) * 100));
  return j as LifiQuote;
}

/** LI.FI's view of a transfer: a message if it failed or was refunded, else null. */
export const lifiFailed = (txHash: string, fromChain: number, toChain: number) => async () => {
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
export function chainPreview(first: Preview, firstOut: bigint, firstMin: bigint, second: Preview, secondOutRaw: bigint, secondMinRaw: bigint, decimals: number): Preview {
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
    costPct: routeCostPct(first) + routeCostPct(second),
    legs: (first.legs ?? 1) + (second.legs ?? 1),
    gasReserveUsd: (first.gasReserveUsd ?? 0) + (second.gasReserveUsd ?? 0) || undefined,
  };
}

export function lifiPreview(r: LifiRoute): Preview {
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
    // USD out vs USD in: fees taken from the amount are already in it; gas is paid by Pecun's gas tank.
    costPct: fromUsd ? Math.max(0, ((fromUsd - toUsd) / fromUsd) * 100) : undefined,
    legs: 1,
  };
}

/* ---------------- Chains Relay can't reach: Relay to USDC on a hub, then LI.FI or Circle CCTP ---------------- */

/** Hubs between Relay and the far leg; both have deep native USDC and are reached by Relay, LI.FI and CCTP. */
export const HUB_CHAINS = [BASE_CHAIN_ID, 42161];
/** LI.FI applies 0.1% on some stablecoin paths, which leaves bridges like Stargate unquotable. */

const IRIS = "https://iris-api.circle.com/v2";
const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address;
const MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as Address;
const CCTP_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
]);
/** CCTP V2 domains and native USDC, for the chains a hub leg can use it on (XDC's checked on-chain: localDomain 18). */
export const CCTP: Record<number, { domain: number; usdc: Address }> = {
  8453: { domain: 6, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  42161: { domain: 3, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  50: { domain: 18, usdc: "0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1" },
};
const FAST_FINALITY = 1000; // CCTP "fast transfer": attested in seconds for a small fee

const sameToken = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** CCTP fast-transfer fee for `amount` (6 decimals), plus the cap we allow on-chain (50% headroom). */
async function cctpFee(fromChain: number, toChain: number, amount: bigint) {
  const rows = (await fetch(`${IRIS}/burn/USDC/fees/${CCTP[fromChain].domain}/${CCTP[toChain].domain}`).then((r) => r.json())) as { finalityThreshold: number; minimumFee: number }[];
  const bps = rows.find((r) => r.finalityThreshold === FAST_FINALITY)?.minimumFee ?? 0;
  const fee = (amount * BigInt(Math.ceil(bps * 100)) + BigInt(999_999)) / BigInt(1_000_000);
  return { fee, maxFee: fee + fee / BigInt(2) + BigInt(1) };
}

const cctpFits = (l: LifiLeg) => !!CCTP[l.fromChain] && !!CCTP[l.toChain] && sameToken(l.fromToken, CCTP[l.fromChain].usdc) && sameToken(l.toToken, CCTP[l.toChain].usdc);

async function cctpFar(leg: LifiLeg): Promise<FarLeg> {
  const { fee, maxFee } = await cctpFee(leg.fromChain, leg.toChain, leg.amount);
  const out = leg.amount - fee;
  const min = leg.amount - maxFee;
  return {
    via: "cctp",
    leg,
    out,
    min,
    decimals: 6,
    preview: { out: formatUnits(out, 6), outSymbol: "USDC", minOut: formatUnits(min, 6), slippagePct: 0, impactPct: 0, feesUsd: Number(fee) / 1e6, seconds: 30 },
  };
}

async function lifiFar(leg: LifiLeg): Promise<FarLeg> {
  const r = await lifiRoute(leg);
  return { via: "lifi", leg, out: BigInt(r.toAmount), min: BigInt(r.toAmountMin), decimals: r.toToken.decimals, preview: lifiPreview(r) };
}

/** The far leg: LI.FI, or CCTP where both ends are native USDC; whichever delivers more. */
export async function farQuote(leg: LifiLeg): Promise<FarLeg> {
  const tries = await Promise.allSettled([lifiFar(leg), cctpFits(leg) ? cctpFar(leg) : Promise.reject(new ExecError("No CCTP route."))]);
  const ok = tries.flatMap((t) => (t.status === "fulfilled" ? [t.value] : []));
  if (!ok.length) throw (tries[0] as PromiseRejectedResult).reason;
  return ok.reduce((best, o) => (o.out > best.out ? o : best));
}

async function hubPlan(leg: RelayLeg, outSymbol: string, hub: number): Promise<Plan> {
  const usdc = USDC_ON[hub];
  if (!viaRelay(leg.from)) {
    // Leaving: far leg into the hub's USDC, then Relay onward.
    const far = await farQuote({ fromChain: leg.from, toChain: hub, fromToken: leg.inToken, toToken: usdc, amount: leg.amount, from: leg.user, to: leg.user });
    const hop: RelayLeg = { from: hub, to: leg.to, inToken: usdc, outToken: leg.outToken, amount: far.out, user: leg.user, recipient: leg.recipient };
    const q = await relayQuote(hop);
    const o = outOf(q);
    return { hops: [hop], far, out: o.out, preview: chainPreview(far.preview, far.out, far.min, toPreview(q, outSymbol), o.out, o.min, o.decimals) };
  }
  // Arriving: Relay into the hub's USDC, then the far leg into the asset.
  const hop: RelayLeg = { ...leg, to: hub, outToken: usdc };
  const q = await relayQuote(hop);
  const o = outOf(q);
  const far = await farQuote({ fromChain: hub, toChain: leg.to, fromToken: usdc, toToken: leg.outToken, amount: o.out, from: leg.recipient, to: leg.recipient });
  return { hops: [hop], far, out: far.out, preview: chainPreview(toPreview(q, "USDC"), o.out, o.min, far.preview, far.out, far.min, far.decimals) };
}

/** Routes to or from a chain Relay can't reach, through whichever hub delivers more. */
async function hubRoute(leg: RelayLeg, outSymbol: string): Promise<Plan> {
  const tries = await Promise.allSettled(HUB_CHAINS.map((h) => hubPlan(leg, outSymbol, h)));
  const ok = tries.flatMap((t) => (t.status === "fulfilled" ? [t.value] : []));
  if (!ok.length) throw (tries[0] as PromiseRejectedResult).reason;
  return ok.reduce((best, o) => (o.out > best.out ? o : best));
}

/** CCTP V2: burn on the source chain, wait for Circle's attestation, mint on the destination (the user's own tx). */
async function cctpTransfer(s: Signer, leg: LifiLeg, read: () => Promise<bigint>, before: bigint): Promise<bigint> {
  const { maxFee } = await cctpFee(leg.fromChain, leg.toChain, leg.amount);
  const token = CCTP[leg.fromChain].usdc;
  await ensureAllowance(s, leg.fromChain, token, TOKEN_MESSENGER_V2, leg.amount);
  const hash = await sendEvm(s, leg.fromChain, {
    to: TOKEN_MESSENGER_V2,
    data: encodeFunctionData({
      abi: CCTP_ABI,
      functionName: "depositForBurn",
      args: [leg.amount, CCTP[leg.toChain].domain, pad(leg.to as Address, { size: 32 }), token, pad("0x", { size: 32 }), maxFee, FAST_FINALITY],
    }),
  });
  let msg: { message: Hex; attestation: Hex } | null = null;
  for (let i = 0; i < 400 && !msg; i++) {
    const j = (await fetch(`${IRIS}/messages/${CCTP[leg.fromChain].domain}?transactionHash=${hash}`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))) as { messages?: { status?: string; message?: Hex; attestation?: Hex | "PENDING" }[] };
    const m = j.messages?.[0];
    if (m?.status === "complete" && m.message && m.attestation && m.attestation !== "PENDING") msg = { message: m.message, attestation: m.attestation };
    else await sleep(3000);
  }
  if (!msg) throw new ExecError(`Circle hasn't confirmed the transfer yet (source tx ${hash}). It can still be completed on the destination chain once it does.`);
  if ((await read()) <= before) {
    try {
      await sendEvm(s, leg.toChain, { to: MESSAGE_TRANSMITTER_V2, data: encodeFunctionData({ abi: CCTP_ABI, functionName: "receiveMessage", args: [msg.message, msg.attestation] }) });
    } catch (e) {
      if ((await read()) <= before) throw e; // someone else may have delivered it first
    }
  }
  return waitForArrival(read, before, 3 * 60_000);
}

/**
 * Buys exactly `wei` of the native coin with `token` on one chain (LI.FI same-chain swap, exact output); returns
 * how much of `token` it took.
 */
export async function buyNative(s: Signer, chainId: number, token: Address, wei: bigint): Promise<bigint> {
  const q = new URLSearchParams({ fromChain: String(chainId), toChain: String(chainId), fromToken: token, toToken: NATIVE, toAmount: wei.toString(), fromAddress: s.address, toAddress: s.address, slippage: "0.01" });
  const res = await fetch(`${LIFI}/quote/toAmount?${q}`);
  const j = (await res.json().catch(() => ({}))) as Partial<LifiQuote> & { message?: string; action?: { fromAmount?: string } };
  if (!j.transactionRequest?.data || !j.action?.fromAmount) throw new ExecError(`Couldn't buy the bridge's network fee${j.message ? `: ${j.message}` : ""}.`);
  const spend = BigInt(j.action.fromAmount);
  const tx = j.transactionRequest;
  await ensureAllowance(s, chainId, token, j.estimate?.approvalAddress ?? tx.to!, spend);
  const before = await tokenBalance(chainId, token, s.address);
  await sendEvm(s, chainId, { to: tx.to!, data: tx.data as Hex, value: tx.value ? BigInt(tx.value) : undefined });
  const after = await tokenBalance(chainId, token, s.address);
  return before > after ? before - after : spend;
}

/** Runs one far leg for `amount`; returns how much arrived on the other side. */
export async function runFar(s: Signer, far: FarLeg, amount: bigint): Promise<bigint> {
  const leg = { ...far.leg, amount };
  const read = () => tokenBalance(leg.toChain, leg.toToken as Address, leg.to as Address);
  const before = await read();
  if (far.via === "cctp") return cctpTransfer(s, leg, read, before);
  let q = await lifiQuote(leg);
  // Some bridges (Stargate) charge a native-coin messaging fee as the tx value. The gas tank only covers gas, so a
  // larger fee is bought from the leg's own input token first, and the transfer re-quoted with what's left.
  const fee = q.transactionRequest.value ? BigInt(q.transactionRequest.value) : BigInt(0);
  const topUpCap = parseUnits(evmChain(leg.fromChain)?.topUp ?? "0", 18);
  if (fee > topUpCap && !isNative(leg.fromToken)) {
    const have = await chainClient(leg.fromChain).getBalance({ address: s.address });
    const want = (fee * BigInt(11)) / BigInt(10); // headroom: the fee can move between quotes
    if (have < want) {
      const spent = await buyNative(s, leg.fromChain, leg.fromToken as Address, want - have);
      leg.amount = amount - spent;
      q = await lifiQuote(leg);
    }
  }
  const tx = q.transactionRequest;
  await ensureAllowance(s, leg.fromChain, leg.fromToken as Address, q.estimate.approvalAddress ?? tx.to!, leg.amount);
  const hash = await sendEvm(s, leg.fromChain, { to: tx.to!, data: tx.data as Hex, value: tx.value ? BigInt(tx.value) : undefined });
  return waitForArrival(read, before, 20 * 60_000, lifiFailed(hash, leg.fromChain, leg.toChain));
}

async function runHubRoute(s: Signer, plan: Plan & { far: FarLeg }): Promise<void> {
  const [hop] = plan.hops;
  if (plan.far.leg.fromChain === hop.to) {
    // Arriving: Relay to the hub, then send on what actually arrived.
    const read = () => erc20Balance(hop.to, hop.outToken as Address, hop.recipient as Address);
    const before = await read();
    await relay(s, hop);
    await runFar(s, plan.far, await waitForArrival(read, before, 10 * 60_000));
  } else {
    // Leaving: far leg to the hub first, then Relay what arrived.
    const got = await runFar(s, plan.far, plan.far.leg.amount);
    await relay(s, { ...hop, amount: got });
  }
}

export const needSui = (s: { suiAddress?: string }) => {
  if (!s.suiAddress) throw new ExecError("Your Sui account is still being set up. Try again in a moment.");
  return s.suiAddress;
};

/** Signs and runs a Sui transaction with the user's session, after the gas tank covers `spendSui` plus gas. */
export async function sendSui(s: Signer, tx: () => Promise<SuiTx | string> | SuiTx | string, spendSui = BigInt(0)): Promise<string> {
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
/** Scallop assets with no swap route from USDC on Sui right now. */
const SUI_NO_ROUTE = new Set(["wAPT"]);
export const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

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

/* Shared Sui route: USDG → USDC (Relay) → USDC on Sui (LI.FI/Mayan) → swap into the asset on Sui (LI.FI), and back. */

export const isSuiCoin = (t: string) => t === SUI_TYPE || t === "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const lifiSuiType = (t: string) => (isSuiCoin(t) ? SUI_TYPE : t);
/** Scales a later leg's minimum by how far the earlier legs could fall short. */
export const scaledMin = (min: bigint, prevOut: bigint, prevMin: bigint) => (prevOut > BigInt(0) ? (min * prevMin) / prevOut : min);

export const suiInSteps = (coinType: string, symbol: string, depositLabel?: string): Step[] => [
  IN_STEPS[0],
  { id: "bridge", label: "Move funds" },
  { id: "sui", label: "Move funds onward" },
  ...(coinType === SUI_USDC ? [] : [{ id: "swap", label: `Swap into ${symbol}` }]),
  ...(depositLabel ? [{ id: "deposit", label: depositLabel }] : []),
];
export const suiOutSteps = (coinType: string, symbol: string, withdrawLabel?: string): Step[] => [
  ...(withdrawLabel ? [{ id: "withdraw", label: withdrawLabel }] : []),
  ...(coinType === SUI_USDC ? [] : [{ id: "swap", label: `Swap ${symbol} to USDC` }]),
  { id: "sui", label: "Move funds onward" },
  OUT_STEPS[1],
  OUT_STEPS[2],
];

/**
 * Sui: no bridge adds gas there, so when the user's Sui wallet is short on SUI, a little of the USDC that reaches Base
 * (about $0.30) is bridged into SUI as their gas reserve, and the rest goes on to the vault.
 */
const SUI_RESERVE_USDC = BigInt(300_000); // $0.30 of USDC (6 decimals)
async function suiReserveFor(sui: string, usdc: bigint): Promise<bigint> {
  if (usdc <= SUI_RESERVE_USDC * BigInt(5)) return BigInt(0);
  const have = await suiBalance(sui, SUI_TYPE).catch(() => null);
  return have !== null && have < SUI_GAS * BigInt(3) ? SUI_RESERVE_USDC : BigInt(0);
}
const withReserve = (p: Preview, reserve: bigint): Preview =>
  reserve > BigInt(0) ? { ...p, gasReserveUsd: (p.gasReserveUsd ?? 0) + Number(formatUnits(reserve, 6)) } : p;

/** One LI.FI transfer from the user's Base wallet: approve if needed, send; returns the transaction hash. */
async function lifiFromBase(s: Signer, leg: LifiLeg): Promise<Hex> {
  const q = await lifiQuote(leg);
  const spender = q.estimate.approvalAddress ?? q.transactionRequest.to!;
  const allowance = await chainClient(BASE_CHAIN_ID).readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "allowance", args: [s.address, spender] });
  if (allowance < leg.amount) await sendEvm(s, BASE_CHAIN_ID, { to: BASE_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, leg.amount] }) });
  return sendEvm(s, BASE_CHAIN_ID, { to: q.transactionRequest.to!, data: q.transactionRequest.data as Hex, value: q.transactionRequest.value ? BigInt(q.transactionRequest.value) : undefined });
}

export async function previewToSui(s: Who, usdg: string, coinType: string): Promise<Preview> {
  const sui = needSui(s);
  const rq = await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: BASE_CHAIN_ID, inToken: USDG, outToken: BASE_USDC, amount: netOfFee(usdg), user: s.address, recipient: s.address });
  const o1 = outOf(rq);
  const reserve = await suiReserveFor(sui, o1.out);
  const main = o1.out - reserve;
  const r1 = await lifiRoute({ fromChain: BASE_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: BASE_USDC, toToken: SUI_USDC, amount: main, from: s.address, to: sui });
  const p12 = chainPreview(toPreview(rq, "USDC"), o1.out, o1.min, lifiPreview(r1), BigInt(r1.toAmount), BigInt(r1.toAmountMin), 6);
  if (coinType === SUI_USDC) return withReserve(p12, reserve);
  const min12 = scaledMin(BigInt(r1.toAmountMin), o1.out, o1.min);
  const r2 = await lifiRoute({ fromChain: SUI_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: SUI_USDC, toToken: lifiSuiType(coinType), amount: BigInt(r1.toAmount), from: sui, to: sui });
  return withReserve(chainPreview(p12, BigInt(r1.toAmount), min12, lifiPreview(r2), BigInt(r2.toAmount), BigInt(r2.toAmountMin), r2.toToken.decimals), reserve);
}

export async function previewFromSui(s: Who, coinType: string, raw: bigint): Promise<Preview> {
  const sui = needSui(s);
  let usdc = raw;
  let usdcMin = raw;
  let swap: Preview | null = null;
  if (coinType !== SUI_USDC) {
    const r0 = await lifiRoute({ fromChain: SUI_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: lifiSuiType(coinType), toToken: SUI_USDC, amount: raw, from: sui, to: sui });
    swap = lifiPreview(r0);
    usdc = BigInt(r0.toAmount);
    usdcMin = BigInt(r0.toAmountMin);
  }
  const r1 = await lifiRoute({ fromChain: SUI_CHAIN_ID, toChain: BASE_CHAIN_ID, fromToken: SUI_USDC, toToken: BASE_USDC, amount: usdc, from: sui, to: s.address });
  const p01 = swap ? chainPreview(swap, usdc, usdcMin, lifiPreview(r1), BigInt(r1.toAmount), BigInt(r1.toAmountMin), 6) : lifiPreview(r1);
  const min01 = scaledMin(BigInt(r1.toAmountMin), usdc, usdcMin);
  const rq = await relayQuote({ from: BASE_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: BASE_USDC, outToken: USDG, amount: BigInt(r1.toAmount), user: s.address, recipient: s.address });
  const o2 = outOf(rq);
  return chainPreview(p01, BigInt(r1.toAmount), min01, toPreview(rq, "USDG"), o2.out, o2.min, USDG_DECIMALS);
}

/** Runs the fee + route into `coinType` on Sui; returns how much of it arrived. */
export async function toSui(s: Signer, usdg: string, coinType: string, decimals: number, symbol: string, on: Progress): Promise<bigint> {
  const sui = needSui(s);
  const usdcOnBase = () => erc20Balance(BASE_CHAIN_ID, BASE_USDC, s.address);
  const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);

  on("bridge", "running");
  const baseBefore = await usdcOnBase();
  await relay(s, { from: ROBINHOOD_CHAIN_ID, to: BASE_CHAIN_ID, inToken: USDG, outToken: BASE_USDC, amount: net, user: s.address, recipient: s.address });
  const usdc = await waitForArrival(usdcOnBase, baseBefore, 10 * 60_000);
  on("bridge", "done", `${formatUnits(usdc, 6)} USDC`);

  on("sui", "running");
  // Gas reserve first (when the Sui wallet is short): a little of the USDC becomes SUI.
  const readSui = () => suiBalance(sui, SUI_TYPE);
  const suiBefore = await readSui();
  const reserve = await suiReserveFor(sui, usdc);
  const gasHash = reserve > BigInt(0)
    ? await lifiFromBase(s, { fromChain: BASE_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: BASE_USDC, toToken: SUI_TYPE, amount: reserve, from: s.address, to: sui })
    : null;
  const readUsdc = () => suiBalance(sui, SUI_USDC);
  const usdcBefore = await readUsdc();
  const hash = await lifiFromBase(s, { fromChain: BASE_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: BASE_USDC, toToken: SUI_USDC, amount: usdc - reserve, from: s.address, to: sui });
  const usdcSui = await waitForArrival(readUsdc, usdcBefore, 15 * 60_000, lifiFailed(hash, BASE_CHAIN_ID, SUI_CHAIN_ID));
  if (gasHash) await waitForArrival(readSui, suiBefore, 15 * 60_000, lifiFailed(gasHash, BASE_CHAIN_ID, SUI_CHAIN_ID)).catch(() => BigInt(0));
  on("sui", "done", `${formatUnits(usdcSui, 6)} USDC`);
  if (coinType === SUI_USDC) return usdcSui;

  on("swap", "running");
  const readAsset = () => suiBalance(sui, coinType);
  const before = await readAsset();
  // Quoted after the gas top-up (inside sendSui), so the swap is built against fresh coins.
  await sendSui(s, async () => (await lifiQuote({ fromChain: SUI_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: SUI_USDC, toToken: lifiSuiType(coinType), amount: usdcSui, from: sui, to: sui })).transactionRequest.data);
  const got = await waitForArrival(readAsset, before, 3 * 60_000);
  on("swap", "done", `${formatUnits(got, decimals)} ${symbol}`);
  return got;
}

/** Runs the route from `raw` of `coinType` on Sui back to USDG, then takes the fee. */
export async function fromSui(s: Signer, coinType: string, raw: bigint, on: Progress): Promise<string> {
  const sui = needSui(s);
  const readUsdc = () => suiBalance(sui, SUI_USDC);
  let usdcSui = raw;
  if (coinType !== SUI_USDC) {
    on("swap", "running");
    const usdcBefore = await readUsdc();
    await sendSui(
      s,
      async () => (await lifiQuote({ fromChain: SUI_CHAIN_ID, toChain: SUI_CHAIN_ID, fromToken: lifiSuiType(coinType), toToken: SUI_USDC, amount: raw, from: sui, to: sui })).transactionRequest.data,
      isSuiCoin(coinType) ? raw : BigInt(0),
    );
    usdcSui = await waitForArrival(readUsdc, usdcBefore, 3 * 60_000);
    on("swap", "done", `${formatUnits(usdcSui, 6)} USDC`);
  }
  on("sui", "running");
  const usdcOnBase = () => erc20Balance(BASE_CHAIN_ID, BASE_USDC, s.address);
  const baseBefore = await usdcOnBase();
  await noteLanding(s, { from: SUI_CHAIN_ID, to: BASE_CHAIN_ID, inToken: SUI_USDC, outToken: BASE_USDC, amount: usdcSui, user: s.address, recipient: s.address });
  const digest = await sendSui(
    s,
    async () => (await lifiQuote({ fromChain: SUI_CHAIN_ID, toChain: BASE_CHAIN_ID, fromToken: SUI_USDC, toToken: BASE_USDC, amount: usdcSui, from: sui, to: s.address })).transactionRequest.data,
  );
  const usdc = await waitForArrival(usdcOnBase, baseBefore, 15 * 60_000, lifiFailed(digest, SUI_CHAIN_ID, BASE_CHAIN_ID));
  on("sui", "done", `${formatUnits(usdc, 6)} USDC`);
  return backToUsdg(s, { from: BASE_CHAIN_ID, inToken: BASE_USDC, amount: usdc, user: s.address }, on);
}

/** Sui tokens where holding the token is the position (vSUI, afSUI). */
function suiToken(coinType: string, symbol: string, decimals = 9): Adapter {
  return {
    positionSymbol: symbol,
    depositSteps: suiInSteps(coinType, symbol),
    withdrawSteps: suiOutSteps(coinType, symbol),
    position: async (s) => (s.suiAddress ? Number(formatUnits(await suiBalance(s.suiAddress, coinType), decimals)) : 0),
    previewDeposit: (s, usdg) => previewToSui(s, usdg, coinType),
    previewWithdraw: (s, amount) => previewFromSui(s, coinType, parseUnits(amount, decimals)),
    deposit: async (s, usdg, on) => `${formatUnits(await toSui(s, usdg, coinType, decimals, symbol, on), decimals)} ${symbol}`,
    withdraw: async (s, amount, on) => {
      const bal = await suiBalance(needSui(s), coinType);
      const amt = amount === "max" ? bal : parseUnits(amount, decimals);
      if (amt <= BigInt(0) || amt > bal) throw new ExecError(`You don't have that much ${symbol}.`);
      return fromSui(s, coinType, amt, on);
    },
  };
}

function scallop(coinType: string, symbol: string): Adapter {
  const isSui = isSuiCoin(coinType);
  return {
    positionSymbol: symbol,
    depositSteps: suiInSteps(coinType, symbol, "Deposit"),
    withdrawSteps: suiOutSteps(coinType, symbol, "Withdraw"),

    position: async (s) => {
      if (!s.suiAddress) return 0;
      const p = await scallopPool(coinType);
      const shares = await suiBalance(s.suiAddress, p.marketCoinType);
      return (Number(shares) * p.conversionRate) / 10 ** p.coinDecimal;
    },
    previewDeposit: (s, usdg) => previewToSui(s, usdg, coinType),
    previewWithdraw: async (s, amount) => previewFromSui(s, coinType, parseUnits(amount, (await scallopPool(coinType)).coinDecimal)),

    deposit: async (s, usdg, on) => {
      const [p, obj] = await Promise.all([scallopPool(coinType), scallopObjects()]);
      const got = await toSui(s, usdg, coinType, p.coinDecimal, symbol, on);
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
      return `${formatUnits(got, p.coinDecimal)} ${symbol}`;
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
      return fromSui(s, coinType, out, on);
    },
  };
}

/* ---------------- which vaults get one-click ---------------- */

export type Opp = { chain: string; protocol: string; asset: string; name?: string; kind?: string; ticker?: string; address?: string | null; id: string; ref?: { source: string; id: string } | null };

/** Standard ERC-4626 vaults (deposit / withdraw / redeem). */
const VAULT_PROTOCOLS = new Set(["Euler", "Fluid", "Gearbox", "Silo", "Sky", "Frgmnt"]);
/** Tokens that are the position themselves; bought and sold through Relay. */
const TOKEN_PROTOCOLS = new Set(["ether.fi", "Rocket Pool", "Kinetiq", "Ethena"]);
const SPARK_POOL: Record<number, Address> = { 1: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987" };

/** Adapters are built once per vault, since the panel and the page both ask. */
const cache = new Map<string, Adapter | null>();

/** Adapter factories registered by protocol modules (src/lib/exec/*). Each returns null for vaults it doesn't own. */
const factories: ((o: Opp) => Adapter | null)[] = [];
export function registerAdapters(f: (o: Opp) => Adapter | null) {
  factories.push(f);
  cache.clear();
}

/** The one-click adapter for a vault, or null when it isn't supported yet. */
export function adapterFor(o: Opp): Adapter | null {
  for (const f of factories) {
    const a = f(o);
    if (a) return a;
  }
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
    // Aave V4: id is aavev4:<chain>:<spoke>:<reserveId>, address is the underlying token.
    if (o.id.startsWith("aavev4:") && isAddr(a)) {
      const [, , spoke, reserve] = o.id.split(":");
      return isAddr(spoke) && /^\d+$/.test(reserve ?? "") ? evmVault(evm, aaveV4(evm, spoke, BigInt(reserve), a), o.asset) : null;
    }
    // Lido stETH: holding it is the position.
    if (o.id === "lido:1:steth") return evmToken(1, "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", "stETH");
    // Native-coin markets (Venus vBNB) take BNB itself: Relay delivers native BNB, mint() is payable.
    if (o.protocol === "Venus" && evm === 56 && isAddr(a) && a.toLowerCase() === "0xa07c5b74c9b40447a954e1466938b865b6bbea36") return evmVault(56, compoundV2Native(56, a, "BNB"), o.asset);
    if ((o.protocol === "Venus" || o.protocol === "Moonwell") && isAddr(a)) return evmVault(evm, compoundV2(evm, a), o.asset);
    if ((TOKEN_PROTOCOLS.has(o.protocol) || (o.protocol === "Frax" && o.kind === "Liquid staking")) && isAddr(a)) {
      const symbol = o.ticker ?? o.name?.match(/\(([^)]+)\)/)?.[1] ?? o.asset;
      return evmToken(evm, a, symbol);
    }
    // Curve-LP vaults hold LP tokens Relay can't buy, so they stay on the regular deposit page.
    if (o.protocol === "Yearn" && isAddr(a) && !/^(Curve|LP) /.test(o.name ?? "")) return evmVault(evm, yearn(evm, a), o.asset);
    // Spark's savings vaults are ERC-4626 on Ethereum; elsewhere they're plain bridged tokens.
    // Spark savings: ERC-4626 on Ethereum; elsewhere it's a plain sUSDS token you hold.
    // sUSDS only has swap liquidity on Base among the L2s; on Arbitrum, Optimism and Unichain it goes through Spark's PSM3.
    if (o.protocol === "Spark" && o.kind === "Vault" && isAddr(a)) {
      if (evm === 1) return evmVault(evm, erc4626(evm, a), o.asset);
      if (evm === 8453) return evmToken(evm, a, o.ticker ?? "sUSDS");
      return SPARK_PSM3[evm] ? evmVault(evm, psm3(evm, SPARK_PSM3[evm], a), o.asset) : null;
    }
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
  if (o.id === "volo:sui:vsui") return suiToken("0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT", "vSUI");
  if (o.id === "aftermath:sui:afsui") return suiToken("0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI", "afSUI");
  if (o.chain === "Sui" && o.protocol === "Scallop" && !SUI_NO_ROUTE.has(o.asset) && o.id.startsWith("scallop:sui:")) {
    return scallop(o.id.slice("scallop:sui:".length), o.asset);
  }
  return null;
}

export function oneClickFor(o: Opp): Adapter | null {
  if (!cache.has(o.id)) {
    const a = adapterFor(o);
    cache.set(o.id, a && guarded(a));
  }
  return cache.get(o.id)!;
}

export const supportsOneClick = (o: Opp) => oneClickFor(o) !== null;

/** The EVM protocol builders, exported for tests and scripts. */
export const evmProtocols = { aaveV4, yearn, erc4626, aaveStyle, comet, compoundV2, compoundV2Native, psm3, morphoMarket, MORPHO_BLUE, SPARK_PSM3 };
export const hyperliquidSigning = { hlL1Action, hlUserAction };
export const routing = { planRoute };
