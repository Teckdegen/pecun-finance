"use client";

import { AddressLookupTableAccount, Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

/** Solana helpers for one-click execution. Users' Solana addresses live in their own Turnkey wallet. */

export const SOLANA_CHAIN_ID = 792703809; // Relay's id for Solana
export const SOLANA_RPC = "https://solana-rpc.publicnode.com";

let conn: Connection | null = null;
export const solana = () => (conn ??= new Connection(SOLANA_RPC, "confirmed"));

const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** A mint's decimals and token program (classic SPL or Token-2022), read straight from the mint account. */
const mints = new Map<string, Promise<{ decimals: number; program: PublicKey }>>();
function mintInfo(mint: string) {
  let m = mints.get(mint);
  if (!m) {
    m = solana()
      .getAccountInfo(new PublicKey(mint))
      .then((a) => {
        if (!a || a.data.length < 45) throw new Error("Couldn't read the token on Solana.");
        return { decimals: a.data[44], program: a.owner };
      });
    m.catch(() => mints.delete(mint)); // retry next time
    mints.set(mint, m);
  }
  return m;
}

export const splDecimals = async (mint: string) => (await mintInfo(mint)).decimals;

/**
 * Raw balance (smallest units) of an SPL token in `owner`'s associated token account, which is where Relay and Jupiter
 * deliver. Reads one account directly, because free RPCs block "all token accounts by owner" lookups.
 */
async function ataOf(owner: string, mint: string) {
  const { program } = await mintInfo(mint);
  const [ata] = PublicKey.findProgramAddressSync([new PublicKey(owner).toBytes(), program.toBytes(), new PublicKey(mint).toBytes()], ATA_PROGRAM);
  return { ata, program };
}

export const hasTokenAccount = async (owner: string, mint: string) => !!(await solana().getAccountInfo((await ataOf(owner, mint)).ata));

/** Unsigned transaction (hex) creating `owner`'s token account for `mint` (no-op if it already exists), paid by `owner`. */
export async function createTokenAccountTx(owner: string, mint: string): Promise<string> {
  const { ata, program } = await ataOf(owner, mint);
  const me = new PublicKey(owner);
  const ix = new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: me, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: me, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: program, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.from([1]) as Buffer, // CreateIdempotent
  });
  const { blockhash } = await solana().getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: me, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
  return hexOf(new VersionedTransaction(msg).serialize());
}

export async function splBalance(owner: string, mint: string): Promise<bigint> {
  const { ata } = await ataOf(owner, mint);
  const acc = await solana().getAccountInfo(ata);
  if (!acc || acc.data.length < 72) return BigInt(0);
  let v = BigInt(0);
  for (let i = 71; i >= 64; i--) v = (v << BigInt(8)) | BigInt(acc.data[i]); // u64 little-endian amount
  return v;
}

export const lamports = async (owner: string) => BigInt(await solana().getBalance(new PublicKey(owner)));

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
/** Hex → bytes without Node's Buffer (not available in the browser). */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const base64ToHex = (b64: string) => hexOf(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

type RelayInstruction = { keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; programId: string; data: string };

/** Builds an unsigned v0 transaction (hex) from Relay's Solana instructions and lookup tables, paid by `payer`. */
export async function txFromInstructions(payer: string, instructions: RelayInstruction[], lookupTables: string[]): Promise<string> {
  const c = solana();
  const tables = (
    await Promise.all(lookupTables.map((a) => c.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)))
  ).filter((t): t is AddressLookupTableAccount => !!t);
  const { blockhash } = await c.getLatestBlockhash();
  const ixs = instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: hexToBytes(ix.data) as Buffer,
      }),
  );
  const msg = new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(tables);
  return hexOf(new VersionedTransaction(msg).serialize());
}

/** Waits for a Solana signature to confirm; throws if the transaction failed. */
export async function confirmSolana(signature: string, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { value } = await solana().getSignatureStatuses([signature]);
    const s = value[0];
    if (s?.err) throw new Error("A Solana transaction failed. Nothing more was sent.");
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("A Solana transaction is taking longer than usual to confirm.");
}
