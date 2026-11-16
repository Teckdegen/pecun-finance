"use client";

import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, parseAbi, parseUnits, serializeTransaction, type Address, type Hex } from "viem";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC, USDG, USDG_DECIMALS } from "./wallet";

/**
 * One-click execution. A single button press runs every step (Pecun's fee, Relay bridge + swap, gas top-ups, approvals,
 * the vault deposit or withdrawal), each signed in the background with the user's own Turnkey session. Turnkey holds
 * the keys in the user's own account; Pecun's server can't sign for them. Network fees come from Pecun's gas tank.
 */

export const BASE_CHAIN_ID = 8453;
const RPC: Record<number, string> = { [ROBINHOOD_CHAIN_ID]: ROBINHOOD_RPC, [BASE_CHAIN_ID]: "https://mainnet.base.org" };
const RELAY = "https://api.relay.link";

/** Pecun's fee on deposits and withdrawals, sent to the treasury. Off when either value is missing. */
const TREASURY = (process.env.NEXT_PUBLIC_PECUN_TREASURY ?? "") as Address | "";
const FEE_BPS = Number(process.env.NEXT_PUBLIC_PECUN_FEE_BPS ?? "0") || 0;
export const feeBps = TREASURY ? FEE_BPS : 0;

const VAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
]);

const clients = new Map<number, ReturnType<typeof createPublicClient>>();
export function chainClient(chainId: number) {
  let c = clients.get(chainId);
  if (!c) clients.set(chainId, (c = createPublicClient({ transport: http(RPC[chainId], { timeout: 25_000, retryCount: 2 }) })));
  return c;
}

/** What the executor needs from the signed-in user. */
export type Signer = {
  address: Address;
  sendEvmTransaction: (unsigned: string, rpcUrl: string) => Promise<{ ok: true; hash: Hex } | { ok: false; error: string }>;
  signAccountsRequest: () => Promise<unknown | null>;
};

export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type Progress = (id: string, status: StepStatus, detail?: string) => void;

class ExecError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks Pecun's gas tank to make sure the user has `needWei` of native gas on the chain. */
async function ensureGas(s: Signer, chainId: number, needWei: bigint) {
  const bal = await chainClient(chainId).getBalance({ address: s.address });
  if (bal >= needWei) return;
  const signed = await s.signAccountsRequest();
  if (!signed) throw new ExecError("Your session has expired. Sign in again.");
  const res = await fetch("/api/gas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signed, chainId, address: s.address, needWei: needWei.toString() }),
  });
  if (!res.ok) throw new ExecError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't cover the network fee.");
}

/** Builds, gas-funds, signs (with the user's session) and sends one EVM transaction, then waits for it. */
async function sendTx(s: Signer, chainId: number, tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex> {
  const c = chainClient(chainId);
  const value = tx.value ?? BigInt(0);
  const [gas, fees] = await Promise.all([c.estimateGas({ account: s.address, to: tx.to, data: tx.data, value }), c.estimateFeesPerGas()]);
  const gasLimit = (gas * BigInt(13)) / BigInt(10);
  await ensureGas(s, chainId, gasLimit * fees.maxFeePerGas + value);
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

/** Relay quote + every transaction it asks for, then waits for Relay to report the transfer delivered. */
async function relay(s: Signer, p: { from: number; to: number; inToken: Address; outToken: Address; amount: bigint }) {
  const res = await fetch(`${RELAY}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: s.address,
      recipient: s.address,
      originChainId: p.from,
      destinationChainId: p.to,
      originCurrency: p.inToken,
      destinationCurrency: p.outToken,
      amount: p.amount.toString(),
      tradeType: "EXACT_INPUT",
    }),
  });
  const q = (await res.json()) as {
    message?: string;
    steps?: { kind: string; items: { data: { to: Address; data?: Hex; value?: string; chainId: number }; check?: { endpoint: string } }[] }[];
  };
  if (!res.ok || !q.steps) throw new ExecError(`Couldn't get a route: ${q.message ?? res.status}`);
  let check: string | undefined;
  for (const step of q.steps) {
    if (step.kind !== "transaction") throw new ExecError("This route needs a signature step Pecun doesn't support yet.");
    for (const item of step.items) {
      await sendTx(s, item.data.chainId, { to: item.data.to, data: item.data.data, value: item.data.value ? BigInt(item.data.value) : undefined });
      if (item.check) check = item.check.endpoint;
    }
  }
  if (!check) return;
  for (let i = 0; i < 90; i++) {
    const st = (await fetch(`${RELAY}${check}`).then((r) => r.json()).catch(() => ({}))) as { status?: string };
    if (st.status === "success") return;
    if (st.status === "failure" || st.status === "refund") throw new ExecError(`The transfer didn't complete (${st.status}). Any funds are refunded by Relay.`);
    await sleep(2000);
  }
  throw new ExecError("The transfer is taking longer than usual. It will still arrive; check your balance in a few minutes.");
}

/** Waits until `token` balance on `chainId` rises above `before`; returns how much arrived. */
async function waitForArrival(chainId: number, token: Address, owner: Address, before: bigint): Promise<bigint> {
  for (let i = 0; i < 60; i++) {
    const now = await erc20Balance(chainId, token, owner);
    if (now > before) return now - before;
    await sleep(2000);
  }
  throw new ExecError("Funds haven't arrived yet. They will; check again in a few minutes.");
}

/* ---------------- Base ERC-4626 vaults (Morpho and others) ---------------- */

export type VaultInfo = { asset: Address; decimals: number; symbol: string };

export async function vaultInfo(vault: Address): Promise<VaultInfo> {
  const c = chainClient(BASE_CHAIN_ID);
  const asset = await c.readContract({ address: vault, abi: VAULT_ABI, functionName: "asset" });
  const [decimals, symbol] = await Promise.all([
    c.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
    c.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { asset, decimals, symbol };
}

/** The user's position in the vault, in the vault's asset. */
export async function vaultPosition(vault: Address, owner: Address): Promise<{ shares: bigint; assets: bigint }> {
  const c = chainClient(BASE_CHAIN_ID);
  const shares = await c.readContract({ address: vault, abi: VAULT_ABI, functionName: "balanceOf", args: [owner] });
  const assets = shares > BigInt(0) ? await c.readContract({ address: vault, abi: VAULT_ABI, functionName: "convertToAssets", args: [shares] }) : BigInt(0);
  return { shares, assets };
}

export const DEPOSIT_STEPS = [
  { id: "fee", label: "Pecun fee" },
  { id: "bridge", label: "Move funds to Base" },
  { id: "deposit", label: "Deposit into the vault" },
];
export const WITHDRAW_STEPS = [
  { id: "withdraw", label: "Withdraw from the vault" },
  { id: "fee", label: "Pecun fee" },
  { id: "bridge", label: "Move funds back to your wallet" },
];

/** One click: USDG on Robinhood Chain → fee → Relay to the vault's asset on Base → deposit. Returns the amount deposited. */
export async function depositBaseVault(s: Signer, vault: Address, usdgAmount: string, on: Progress): Promise<string> {
  const info = await vaultInfo(vault);
  const total = parseUnits(usdgAmount, USDG_DECIMALS);
  const fee = (total * BigInt(feeBps)) / BigInt(10_000);
  const net = total - fee;

  on("fee", fee > BigInt(0) ? "running" : "skipped");
  if (fee > BigInt(0)) {
    await sendTx(s, ROBINHOOD_CHAIN_ID, { to: USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TREASURY as Address, fee] }) });
    on("fee", "done");
  }

  on("bridge", "running");
  const before = await erc20Balance(BASE_CHAIN_ID, info.asset, s.address);
  await relay(s, { from: ROBINHOOD_CHAIN_ID, to: BASE_CHAIN_ID, inToken: USDG, outToken: info.asset, amount: net });
  const received = await waitForArrival(BASE_CHAIN_ID, info.asset, s.address, before);
  on("bridge", "done", `${formatUnits(received, info.decimals)} ${info.symbol}`);

  on("deposit", "running");
  const allowance = await chainClient(BASE_CHAIN_ID).readContract({ address: info.asset, abi: erc20Abi, functionName: "allowance", args: [s.address, vault] });
  if (allowance < received) {
    await sendTx(s, BASE_CHAIN_ID, { to: info.asset, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, received] }) });
  }
  await sendTx(s, BASE_CHAIN_ID, { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [received, s.address] }) });
  on("deposit", "done");
  return `${formatUnits(received, info.decimals)} ${info.symbol}`;
}

/** One click: withdraw from the Base vault → fee → Relay back to USDG on Robinhood Chain. `amount` in the vault's asset, or "max". */
export async function withdrawBaseVault(s: Signer, vault: Address, amount: string | "max", on: Progress): Promise<string> {
  const info = await vaultInfo(vault);
  const c = chainClient(BASE_CHAIN_ID);

  on("withdraw", "running");
  const before = await erc20Balance(BASE_CHAIN_ID, info.asset, s.address);
  if (amount === "max") {
    const { shares } = await vaultPosition(vault, s.address);
    if (shares === BigInt(0)) throw new ExecError("You don't have a position in this vault.");
    await sendTx(s, BASE_CHAIN_ID, { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "redeem", args: [shares, s.address, s.address] }) });
  } else {
    const assets = parseUnits(amount, info.decimals);
    await sendTx(s, BASE_CHAIN_ID, { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [assets, s.address, s.address] }) });
  }
  const out = (await erc20Balance(BASE_CHAIN_ID, info.asset, s.address)) - before;
  if (out <= BigInt(0)) throw new ExecError("The vault didn't release any funds.");
  on("withdraw", "done", `${formatUnits(out, info.decimals)} ${info.symbol}`);

  const fee = (out * BigInt(feeBps)) / BigInt(10_000);
  on("fee", fee > BigInt(0) ? "running" : "skipped");
  if (fee > BigInt(0)) {
    await sendTx(s, BASE_CHAIN_ID, { to: info.asset, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TREASURY as Address, fee] }) });
    on("fee", "done");
  }

  on("bridge", "running");
  const usdgBefore = await erc20Balance(ROBINHOOD_CHAIN_ID, USDG, s.address);
  await relay(s, { from: BASE_CHAIN_ID, to: ROBINHOOD_CHAIN_ID, inToken: info.asset, outToken: USDG, amount: out - fee });
  const back = await waitForArrival(ROBINHOOD_CHAIN_ID, USDG, s.address, usdgBefore);
  on("bridge", "done", `${formatUnits(back, USDG_DECIMALS)} USDG`);
  void c;
  return `${formatUnits(back, USDG_DECIMALS)} USDG`;
}

/** Which vaults have one-click execution today. */
export function supportsOneClick(o: { chain: string; ref?: { source: string; id: string } }): boolean {
  return o.chain === "Base" && !!o.ref && /^morpho-v[12]$/.test(o.ref.source) && /^0x[0-9a-fA-F]{40}$/.test(o.ref.id);
}
