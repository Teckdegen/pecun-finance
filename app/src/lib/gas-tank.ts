import "server-only";
import { createPublicClient, formatEther, http, parseEther, serializeTransaction, type Address, type Hex } from "viem";
import { PARENT_ORG, turnkey } from "./turnkey-server";

/**
 * Pecun's gas tank: one EVM wallet in Pecun's parent organization that pays users' network fees by topping them up
 * with a little native gas token just before a transaction. Same address on every EVM chain; fund it per chain.
 *
 * Limits keep it from being drained: a top-up only happens when the user is actually short, each one is capped per
 * chain, and each user gets a limited number per day. (Counts are kept in this server's memory, so they reset when
 * an instance restarts; a database would make them exact.)
 */

const GAS_WALLET_NAME = "Pecun Gas Tank";

type ChainGas = { name: string; rpc: string; /** most one top-up can send */ maxTopUp: string; /** sent when short: covers a few txs */ topUp: string };
export const GAS_CHAINS: Record<number, ChainGas> = {
  4663: { name: "Robinhood Chain", rpc: "https://rpc.mainnet.chain.robinhood.com", topUp: "0.00003", maxTopUp: "0.0001" },
  8453: { name: "Base", rpc: "https://mainnet.base.org", topUp: "0.00003", maxTopUp: "0.0001" },
};

const TOPUPS_PER_USER_PER_DAY = 20;
const usage = ((globalThis as unknown as { __pecunGasUse?: Map<string, { day: string; n: number }> }).__pecunGasUse ??= new Map());

let gasAddress: Promise<Address> | null = null;
/** The gas tank's address; the wallet is created in Pecun's organization on first use. */
export function gasTankAddress(): Promise<Address> {
  gasAddress ??= (async () => {
    const { wallets } = await turnkey().getWallets({ organizationId: PARENT_ORG });
    let walletId = wallets.find((w) => w.walletName === GAS_WALLET_NAME)?.walletId;
    if (!walletId) {
      walletId = (
        await turnkey().createWallet({
          walletName: GAS_WALLET_NAME,
          accounts: [{ curve: "CURVE_SECP256K1", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/60'/0'/0/0", addressFormat: "ADDRESS_FORMAT_ETHEREUM" }],
        })
      ).walletId;
    }
    const { accounts } = await turnkey().getWalletAccounts({ organizationId: PARENT_ORG, walletId });
    const evm = accounts.find((a) => a.addressFormat === "ADDRESS_FORMAT_ETHEREUM");
    if (!evm) throw new Error("Gas tank wallet has no EVM account");
    return evm.address as Address;
  })().catch((e) => {
    gasAddress = null;
    throw e;
  });
  return gasAddress;
}

const clients = new Map<number, ReturnType<typeof createPublicClient>>();
const client = (chainId: number) => {
  let c = clients.get(chainId);
  if (!c) clients.set(chainId, (c = createPublicClient({ transport: http(GAS_CHAINS[chainId].rpc, { timeout: 20_000, retryCount: 2 }) })));
  return c;
};

export type TopUpResult = { toppedUp: false; balance: string } | { toppedUp: true; amount: string; hash: Hex };

/**
 * Makes sure `to` holds at least `needWei` of native gas on `chainId`. Sends a top-up from the gas tank if not.
 * `user` is the user's Turnkey sub-organization id, used for the daily limit.
 */
export async function ensureGas(chainId: number, to: Address, needWei: bigint, user: string): Promise<TopUpResult> {
  const chain = GAS_CHAINS[chainId];
  if (!chain) throw new Error(`Pecun doesn't cover gas on chain ${chainId} yet.`);
  const c = client(chainId);
  const balance = await c.getBalance({ address: to });
  if (balance >= needWei) return { toppedUp: false, balance: formatEther(balance) };

  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(user);
  const n = u?.day === day ? u.n : 0;
  if (n >= TOPUPS_PER_USER_PER_DAY) throw new Error("Daily network-fee allowance used up. Try again tomorrow.");

  const short = needWei - balance;
  const standard = parseEther(chain.topUp);
  const amount = short > standard ? short : standard;
  if (amount > parseEther(chain.maxTopUp)) throw new Error("That transaction needs more network fee than Pecun covers.");

  const from = await gasTankAddress();
  const [nonce, fees, tank] = await Promise.all([c.getTransactionCount({ address: from, blockTag: "pending" }), c.estimateFeesPerGas(), c.getBalance({ address: from })]);
  const gas = BigInt(21000);
  if (tank < amount + gas * fees.maxFeePerGas) throw new Error(`Pecun's gas tank is empty on ${chain.name}. Please try again later.`);

  const unsigned = serializeTransaction({
    type: "eip1559",
    chainId,
    nonce,
    to,
    value: amount,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const { signedTransaction } = await turnkey().signTransaction({ signWith: from, unsignedTransaction: unsigned.slice(2), type: "TRANSACTION_TYPE_ETHEREUM" });
  const raw = (signedTransaction.startsWith("0x") ? signedTransaction : `0x${signedTransaction}`) as Hex;
  const hash = await c.sendRawTransaction({ serializedTransaction: raw });
  await c.waitForTransactionReceipt({ hash, timeout: 60_000 });
  usage.set(user, { day, n: n + 1 });
  return { toppedUp: true, amount: formatEther(amount), hash };
}

/** Gas tank address and its balance on each covered chain, for funding it. */
export async function gasTankStatus() {
  const address = await gasTankAddress();
  const balances = await Promise.all(
    Object.entries(GAS_CHAINS).map(async ([id, ch]) => ({
      chainId: Number(id),
      chain: ch.name,
      balance: await client(Number(id)).getBalance({ address }).then(formatEther).catch(() => "unavailable"),
    })),
  );
  return { address, balances };
}
