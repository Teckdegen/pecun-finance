import "server-only";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import bs58 from "bs58";
import { createPublicClient, createWalletClient, fallback, formatEther, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EVM_CHAINS } from "./exec-chains";

/**
 * Pecun's gas tank: wallets that pay users' network fees by topping them up with a little native gas just before a
 * transaction. Their private keys live only in the server's environment (Vercel), never in code or in the browser:
 *
 *   GAS_TANK_EVM_PRIVATE_KEY      0x-prefixed hex key. Same address on every EVM chain; fund it per chain.
 *   GAS_TANK_SOLANA_PRIVATE_KEY   base58 secret key, or a JSON array of 64 numbers (Solana CLI keypair file).
 *   GAS_TANK_SUI_PRIVATE_KEY      suiprivkey1… (Sui wallet export), or a 0x-prefixed 32-byte hex Ed25519 key.
 *
 * Limits keep it from being drained: a top-up only happens when the user is actually short, each one is capped per
 * chain, and each user gets a limited number per day. (Counts are kept in this server's memory, so they reset when an
 * instance restarts; a database would make them exact.)
 */

export const SOLANA_CHAIN_ID = 792703809; // Relay's id for Solana
const SOLANA_RPC = "https://solana-rpc.publicnode.com";
export const SUI_CHAIN_ID = 9270000000000000; // LI.FI's id for Sui
const SUI_GRPC = "https://fullnode.mainnet.sui.io:443";

type EvmGas = { name: string; rpc: string; urls: string[]; /** sent when short; covers a few transactions */ topUp: string; /** most one top-up can send */ maxTopUp: string };
export const GAS_CHAINS: Record<number, EvmGas> = Object.fromEntries(
  EVM_CHAINS.map((c) => [c.id, { name: c.names[0], rpc: c.rpc, urls: [c.rpc, ...(c.backups ?? [])], topUp: c.topUp, maxTopUp: c.maxTopUp }]),
);
/** Solana: enough for fees plus rent for a couple of new token accounts. */
const SOL_TOP_UP = 0.005;
const SOL_MAX_TOP_UP = 0.012;
/** Sui: a few transactions' gas (MIST = 1e-9 SUI). */
const SUI_TOP_UP = BigInt(50_000_000); // 0.05 SUI
const SUI_MAX_TOP_UP = BigInt(200_000_000); // 0.2 SUI

export const isGasChain = (chainId: number) => chainId === SOLANA_CHAIN_ID || chainId === SUI_CHAIN_ID || !!GAS_CHAINS[chainId];

const TOPUPS_PER_USER_PER_DAY = 20;
const usage = ((globalThis as unknown as { __pecunGasUse?: Map<string, { day: string; n: number }> }).__pecunGasUse ??= new Map());

function countTopUp(user: string) {
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(user);
  const n = u?.day === day ? u.n : 0;
  if (n >= TOPUPS_PER_USER_PER_DAY) throw new Error("Daily network-fee allowance used up. Try again tomorrow.");
  return () => usage.set(user, { day, n: n + 1 });
}

/* ---------------- keys ---------------- */

function evmAccount() {
  const key = process.env.GAS_TANK_EVM_PRIVATE_KEY?.trim();
  if (!key) throw new Error("Pecun's gas tank isn't set up: GAS_TANK_EVM_PRIVATE_KEY is missing on the server.");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

function solanaKeypair() {
  const key = process.env.GAS_TANK_SOLANA_PRIVATE_KEY?.trim();
  if (!key) throw new Error("Pecun's gas tank isn't set up: GAS_TANK_SOLANA_PRIVATE_KEY is missing on the server.");
  const bytes = key.startsWith("[") ? Uint8Array.from(JSON.parse(key) as number[]) : bs58.decode(key);
  return Keypair.fromSecretKey(bytes);
}

function suiKeypair() {
  const key = process.env.GAS_TANK_SUI_PRIVATE_KEY?.trim();
  if (!key) throw new Error("Pecun's gas tank isn't set up: GAS_TANK_SUI_PRIVATE_KEY is missing on the server.");
  if (key.startsWith("suiprivkey")) return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey);
  const hex = key.replace(/^0x/, "");
  return Ed25519Keypair.fromSecretKey(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))));
}

let sui: SuiGrpcClient | null = null;
const suiClient = () => (sui ??= new SuiGrpcClient({ network: "mainnet", baseUrl: SUI_GRPC }));

export const gasTankConfigured = () =>
  Boolean(process.env.GAS_TANK_EVM_PRIVATE_KEY || process.env.GAS_TANK_SOLANA_PRIVATE_KEY || process.env.GAS_TANK_SUI_PRIVATE_KEY);

/* ---------------- top-ups ---------------- */

export type TopUpResult = { toppedUp: false; balance: string } | { toppedUp: true; amount: string; hash: string };

/** Makes sure `to` holds at least `need` (wei on EVM, lamports on Solana, MIST on Sui) of native gas; tops up from the tank if not. */
export async function ensureGas(chainId: number, to: string, need: bigint, user: string): Promise<TopUpResult> {
  if (chainId === SOLANA_CHAIN_ID) return ensureSol(to, need, user);
  if (chainId === SUI_CHAIN_ID) return ensureSui(to, need, user);
  return ensureEvm(chainId, to as Address, need, user);
}

async function ensureEvm(chainId: number, to: Address, needWei: bigint, user: string): Promise<TopUpResult> {
  const chain = GAS_CHAINS[chainId];
  if (!chain) throw new Error(`Pecun doesn't cover gas on chain ${chainId} yet.`);
  const transport = () => fallback(chain.urls.map((u) => http(u, { timeout: 15_000, retryCount: 0 })), { retryCount: 2 });
  const pub = createPublicClient({ transport: transport() });
  const balance = await pub.getBalance({ address: to });
  if (balance >= needWei) return { toppedUp: false, balance: formatEther(balance) };

  const done = countTopUp(user);
  const standard = parseEther(chain.topUp);
  const amount = needWei - balance > standard ? needWei - balance : standard;
  if (amount > parseEther(chain.maxTopUp)) throw new Error("That transaction needs more network fee than Pecun covers.");

  const account = evmAccount();
  const tank = await pub.getBalance({ address: account.address });
  if (tank < amount * BigInt(2)) throw new Error(`Pecun's gas tank is low on ${chain.name}. Please try again later.`);
  const wallet = createWalletClient({ account, transport: transport() });
  const hash = await wallet.sendTransaction({ to, value: amount, chain: null });
  await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  done();
  return { toppedUp: true, amount: formatEther(amount), hash };
}

async function ensureSol(to: string, needLamports: bigint, user: string): Promise<TopUpResult> {
  const conn = new Connection(SOLANA_RPC, "confirmed");
  const dest = new PublicKey(to);
  const balance = BigInt(await conn.getBalance(dest));
  if (balance >= needLamports) return { toppedUp: false, balance: String(Number(balance) / LAMPORTS_PER_SOL) };

  const done = countTopUp(user);
  const standard = BigInt(Math.round(SOL_TOP_UP * LAMPORTS_PER_SOL));
  const amount = needLamports - balance > standard ? needLamports - balance : standard;
  if (amount > BigInt(Math.round(SOL_MAX_TOP_UP * LAMPORTS_PER_SOL))) throw new Error("That transaction needs more network fee than Pecun covers.");

  const kp = solanaKeypair();
  const tank = BigInt(await conn.getBalance(kp.publicKey));
  if (tank < amount * BigInt(2)) throw new Error("Pecun's gas tank is low on Solana. Please try again later.");
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports: amount }),
  );
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  done();
  return { toppedUp: true, amount: String(Number(amount) / LAMPORTS_PER_SOL), hash: sig };
}

const suiBalance = async (owner: string) => BigInt((await suiClient().getBalance({ owner })).balance.balance);
const fmtSui = (mist: bigint) => String(Number(mist) / 1e9);

async function ensureSui(to: string, needMist: bigint, user: string): Promise<TopUpResult> {
  const balance = await suiBalance(to);
  if (balance >= needMist) return { toppedUp: false, balance: fmtSui(balance) };

  const done = countTopUp(user);
  const amount = needMist - balance > SUI_TOP_UP ? needMist - balance : SUI_TOP_UP;
  if (amount > SUI_MAX_TOP_UP) throw new Error("That transaction needs more network fee than Pecun covers.");

  const kp = suiKeypair();
  const tank = await suiBalance(kp.toSuiAddress());
  if (tank < amount * BigInt(2)) throw new Error("Pecun's gas tank is low on Sui. Please try again later.");
  const tx = new SuiTransaction();
  const [coin] = tx.splitCoins(tx.gas, [amount]);
  tx.transferObjects([coin], to);
  const r = await suiClient().signAndExecuteTransaction({ transaction: tx, signer: kp, include: { effects: true } });
  if (r.$kind !== "Transaction" || !r.Transaction.effects?.status.success) throw new Error("Pecun's Sui gas top-up failed.");
  await suiClient().waitForTransaction({ result: r });
  done();
  return { toppedUp: true, amount: fmtSui(amount), hash: r.Transaction.digest };
}

/* ---------------- status ---------------- */

/** Tank addresses and balances on each covered chain, so they can be funded. */
export async function gasTankStatus() {
  const out: {
    evm?: { address: string; balances: { chain: string; balance: string }[] };
    solana?: { address: string; balance: string };
    sui?: { address: string; balance: string };
  } = {};
  if (process.env.GAS_TANK_EVM_PRIVATE_KEY) {
    const address = evmAccount().address;
    const balances = await Promise.all(
      Object.values(GAS_CHAINS).map(async (ch) => ({
        chain: ch.name,
        balance: await createPublicClient({ transport: fallback(ch.urls.map((u) => http(u, { timeout: 15_000, retryCount: 0 }))) }).getBalance({ address }).then(formatEther).catch(() => "unavailable"),
      })),
    );
    out.evm = { address, balances };
  }
  if (process.env.GAS_TANK_SOLANA_PRIVATE_KEY) {
    const kp = solanaKeypair();
    const lamports = await new Connection(SOLANA_RPC).getBalance(kp.publicKey).catch(() => -1);
    out.solana = { address: kp.publicKey.toBase58(), balance: lamports < 0 ? "unavailable" : String(lamports / LAMPORTS_PER_SOL) };
  }
  if (process.env.GAS_TANK_SUI_PRIVATE_KEY) {
    const address = suiKeypair().toSuiAddress();
    out.sui = { address, balance: await suiBalance(address).then(fmtSui).catch(() => "unavailable") };
  }
  return out;
}
