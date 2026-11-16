import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, parseUnits, serializeTransaction, type Address, type Hex } from "viem";

/**
 * The Pecun wallet that users see: their EVM address on Robinhood Chain, funded with USDG.
 * (Every account also has Solana and Sui addresses; those stay behind the scenes for routing.)
 * All values below were checked on-chain: chain id 4663, USDG symbol, 6 decimals.
 */
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER = "https://robinhoodchain.blockscout.com";
export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const USDG_DECIMALS = 6;
export const ETH_LOGO = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png";
export const USDG_LOGO = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xe343167631d89B6Ffc58B88d6b7fB0228795491D/logo.png";

const client = createPublicClient({ transport: http(ROBINHOOD_RPC, { timeout: 20_000, retryCount: 2 }) });

export type Balances = { usdg: number; eth: number; usdgRaw: bigint; ethRaw: bigint; /** USD per ETH; 0 if the price couldn't be loaded */ ethPrice: number };

/** USDG and ETH (for network fees) held by the address on Robinhood Chain. */
export async function getBalances(address: Address): Promise<Balances> {
  const [usdgRaw, ethRaw, ethPrice] = await Promise.all([
    client.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    client.getBalance({ address }),
    // LI.FI's open price for native ETH on Robinhood Chain.
    fetch(`https://li.quest/v1/token?chain=${ROBINHOOD_CHAIN_ID}&token=0x0000000000000000000000000000000000000000`)
      .then((r) => r.json() as Promise<{ priceUSD?: string }>)
      .then((t) => Number(t.priceUSD) || 0)
      .catch(() => 0),
  ]);
  return { usdg: Number(formatUnits(usdgRaw, USDG_DECIMALS)), eth: Number(formatUnits(ethRaw, 18)), usdgRaw, ethRaw, ethPrice };
}

export const isAddress = (v: string): v is Address => /^0x[a-fA-F0-9]{40}$/.test(v.trim());

/**
 * Builds an unsigned EIP-1559 USDG transfer on Robinhood Chain, ready for Turnkey to sign.
 * Returns the serialized transaction without the 0x prefix, plus the network fee estimate in ETH.
 */
export async function buildUsdgTransfer(from: Address, to: Address, amount: string): Promise<{ unsigned: string; feeEth: number }> {
  const value = parseUnits(amount, USDG_DECIMALS);
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, value] });
  const [nonce, gas, fees] = await Promise.all([
    client.getTransactionCount({ address: from, blockTag: "pending" }),
    client.estimateGas({ account: from, to: USDG, data }),
    client.estimateFeesPerGas(),
  ]);
  const gasLimit = (gas * BigInt(12)) / BigInt(10); // 20% headroom
  const serialized = serializeTransaction({
    type: "eip1559",
    chainId: ROBINHOOD_CHAIN_ID,
    nonce,
    to: USDG,
    data,
    value: BigInt(0),
    gas: gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  return { unsigned: serialized.slice(2), feeEth: Number(formatUnits(gasLimit * fees.maxFeePerGas, 18)) };
}

/** Waits for the transaction to be mined; true when it succeeded. */
export async function waitForTx(hash: Hex): Promise<boolean> {
  const r = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return r.status === "success";
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
