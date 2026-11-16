"use client";

import { Signer, type SignatureScheme } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

/** Sui helpers for one-click execution. Users' Sui addresses live in their own Turnkey wallet. */

export const SUI_CHAIN_ID = 9270000000000000; // LI.FI's id for Sui
export const SUI_TYPE = "0x2::sui::SUI";
const SUI_GRPC = "https://fullnode.mainnet.sui.io:443"; // Sui's public JSON-RPC is retired; gRPC-web works from the browser

let client: SuiGrpcClient | null = null;
export const sui = () => (client ??= new SuiGrpcClient({ network: "mainnet", baseUrl: SUI_GRPC }));

/** Raw balance of `coinType` held by `owner`. */
export const suiBalance = async (owner: string, coinType = SUI_TYPE) => BigInt((await sui().getBalance({ owner, coinType })).balance.balance);

const fromHex = (hex: string) => Uint8Array.from(hex.replace(/^0x/, "").match(/../g) ?? [], (h) => parseInt(h, 16));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * A Sui signer backed by the user's Turnkey key. The Sui SDK hands it the 32-byte transaction digest; Turnkey signs it
 * with the user's own Ed25519 key under their session (no prompt). Pecun never holds this key.
 */
export class TurnkeySuiSigner extends Signer {
  private pub: Ed25519PublicKey;
  constructor(
    publicKeyHex: string,
    address: string,
    private signHex: (digestHex: string) => Promise<{ r: string; s: string }>,
  ) {
    super();
    this.pub = new Ed25519PublicKey(fromHex(publicKeyHex));
    if (this.pub.toSuiAddress() !== address) throw new Error("Your Sui account key doesn't match its address.");
  }
  async sign(digest: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const { r, s } = await this.signHex(toHex(digest));
    const sig = fromHex(r.replace(/^0x/, "") + s.replace(/^0x/, ""));
    if (sig.length !== 64) throw new Error("Turnkey returned an unexpected Sui signature.");
    return sig as Uint8Array<ArrayBuffer>;
  }
  getKeyScheme(): SignatureScheme {
    return "ED25519";
  }
  getPublicKey() {
    return this.pub;
  }
}

/** Builds (fresh gas and object versions), signs and executes a Sui transaction, then waits for it. Returns the digest. */
export async function executeSui(tx: Transaction | string, sender: string, signer: Signer): Promise<string> {
  const t = typeof tx === "string" ? Transaction.from(tx) : tx;
  t.setSender(sender);
  const r = await sui().signAndExecuteTransaction({ transaction: t, signer, include: { effects: true } });
  const result = r.Transaction ?? r.FailedTransaction;
  if (r.$kind !== "Transaction" || !result?.effects?.status.success) {
    throw new Error(`A Sui transaction failed${result?.effects?.status.error ? `: ${String(JSON.stringify(result.effects.status.error)).slice(0, 160)}` : ""}. Nothing more was sent.`);
  }
  await sui().waitForTransaction({ result: r });
  return result.digest;
}
