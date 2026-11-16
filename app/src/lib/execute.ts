"use client";

import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, parseAbi, parseUnits, serializeTransaction, type Address, type Hex } from "viem";
import { base64ToHex, confirmSolana, createTokenAccountTx, hasTokenAccount, lamports, SOLANA_CHAIN_ID, SOLANA_RPC, splBalance, splDecimals, txFromInstructions } from "./solana";
import { coinWithBalance, Transaction as SuiTx } from "@mysten/sui/transactions";
import { SUI_CHAIN_ID, SUI_TYPE, suiBalance } from "./sui";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC, USDG, USDG_DECIMALS } from "./wallet";

/**
 * One-click execution. A single press runs every step (Pecun's fee, Relay bridge + swap, gas top-ups, approvals, the
 * vault deposit or withdrawal), each signed in the background with the user's own Turnkey session. Turnkey holds the
 * keys in the user's own account; Pecun's server can't sign for them. Network fees come from Pecun's gas tank.
 *
 * Every vault type is an `Adapter` (position, preview, deposit, withdraw), so the panel works the same everywhere.
 */

export const BASE_CHAIN_ID = 8453;
const RPC: Record<number, string> = { [ROBINHOOD_CHAIN_ID]: ROBINHOOD_RPC, [BASE_CHAIN_ID]: "https://mainnet.base.org" };
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
  if (!c) clients.set(chainId, (c = createPublicClient({ transport: http(RPC[chainId], { timeout: 25_000, retryCount: 2 }) })));
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
  data: { to?: Address; data?: Hex; value?: string; chainId?: number; instructions?: Parameters<typeof txFromInstructions>[1]; addressLookupTableAddresses?: string[] };
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
    if (step.kind !== "transaction") throw new ExecError("This route needs a signature step Pecun doesn't support yet.");
    for (const item of step.items) {
      const d = item.data;
      if (d.instructions) {
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
  for (let i = 0; i < 90; i++) {
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

/* ---------------- Base ERC-4626 vaults (Morpho) ---------------- */

const VAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
]);

async function vaultInfo(vault: Address) {
  const c = chainClient(BASE_CHAIN_ID);
  const asset = await c.readContract({ address: vault, abi: VAULT_ABI, functionName: "asset" });
  const [decimals, symbol] = await Promise.all([
    c.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
    c.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { asset, decimals, symbol };
}

async function vaultShares(vault: Address, owner: Address) {
  const c = chainClient(BASE_CHAIN_ID);
  const shares = await c.readContract({ address: vault, abi: VAULT_ABI, functionName: "balanceOf", args: [owner] });
  const assets = shares > BigInt(0) ? await c.readContract({ address: vault, abi: VAULT_ABI, functionName: "convertToAssets", args: [shares] }) : BigInt(0);
  return { shares, assets };
}

function baseVault(vault: Address, assetSymbol: string): Adapter {
  let infoP: ReturnType<typeof vaultInfo> | undefined;
  const info = () => (infoP ??= vaultInfo(vault).catch((e) => ((infoP = undefined), Promise.reject(e))));
  return {
    positionSymbol: assetSymbol,
    depositSteps: IN_STEPS,
    withdrawSteps: OUT_STEPS,
    position: async (s) => {
      const [i, p] = await Promise.all([info(), vaultShares(vault, s.address)]);
      return Number(formatUnits(p.assets, i.decimals));
    },
    previewDeposit: async (s, usdg) => {
      const i = await info();
      const net = parseUnits(usdg, USDG_DECIMALS) - (parseUnits(usdg, USDG_DECIMALS) * BigInt(feeBps)) / BigInt(10_000);
      return toPreview(await relayQuote({ from: ROBINHOOD_CHAIN_ID, to: BASE_CHAIN_ID, inToken: USDG, outToken: i.asset, amount: net, user: s.address, recipient: s.address }), i.symbol);
    },
    previewWithdraw: async (s, amount) => {
      const i = await info();
      return toPreview(await relayQuote({ from: BASE_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: i.asset, outToken: USDG, amount: parseUnits(amount, i.decimals), user: s.address, recipient: s.address }), "USDG");
    },
    deposit: async (s, usdg, on) => {
      const i = await info();
      const net = await takeUsdgFee(s, parseUnits(usdg, USDG_DECIMALS), on);
      on("bridge", "running");
      const read = () => erc20Balance(BASE_CHAIN_ID, i.asset, s.address);
      const before = await read();
      await relay(s, { from: ROBINHOOD_CHAIN_ID, to: BASE_CHAIN_ID, inToken: USDG, outToken: i.asset, amount: net, user: s.address, recipient: s.address });
      const received = await waitForArrival(read, before);
      on("bridge", "done", `${formatUnits(received, i.decimals)} ${i.symbol}`);
      on("deposit", "running");
      const allowance = await chainClient(BASE_CHAIN_ID).readContract({ address: i.asset, abi: erc20Abi, functionName: "allowance", args: [s.address, vault] });
      if (allowance < received) await sendEvm(s, BASE_CHAIN_ID, { to: i.asset, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, received] }) });
      await sendEvm(s, BASE_CHAIN_ID, { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [received, s.address] }) });
      on("deposit", "done");
      return `${formatUnits(received, i.decimals)} ${i.symbol}`;
    },
    withdraw: async (s, amount, on) => {
      const i = await info();
      on("withdraw", "running");
      const read = () => erc20Balance(BASE_CHAIN_ID, i.asset, s.address);
      const before = await read();
      if (amount === "max") {
        const { shares } = await vaultShares(vault, s.address);
        if (shares === BigInt(0)) throw new ExecError("You don't have a position in this vault.");
        await sendEvm(s, BASE_CHAIN_ID, { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "redeem", args: [shares, s.address, s.address] }) });
      } else {
        await sendEvm(s, BASE_CHAIN_ID, { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [parseUnits(amount, i.decimals), s.address, s.address] }) });
      }
      const out = (await read()) - before;
      if (out <= BigInt(0)) throw new ExecError("The vault didn't release any funds.");
      on("withdraw", "done", `${formatUnits(out, i.decimals)} ${i.symbol}`);
      return backToUsdg(s, { from: BASE_CHAIN_ID, inToken: i.asset, amount: out, user: s.address }, on);
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

type Opp = { chain: string; protocol: string; asset: string; ticker?: string; address?: string; id: string; ref?: { source: string; id: string } };

/** The one-click adapter for a vault, or null when it isn't supported yet. */
export function adapterFor(o: Opp): Adapter | null {
  if (o.chain === "Base" && o.ref && /^morpho-v[12]$/.test(o.ref.source) && /^0x[0-9a-fA-F]{40}$/.test(o.ref.id)) return baseVault(o.ref.id as Address, o.asset);
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

export const supportsOneClick = (o: Opp) => adapterFor(o) !== null;
