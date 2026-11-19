import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, parseUnits, serializeTransaction, type Address, type Hex } from "viem";

/**
 * The Pecun wallet that users see: their EVM address on Base, funded with USDC. Every deposit starts here and every
 * withdrawal comes back here; Pecun's gas tank only covers this chain.
 * (Every account also has Solana and Sui addresses; those stay behind the scenes for routing.)
 */
export const HOME_CHAIN_ID = 8453;
export const HOME_CHAIN_NAME = "Base";
export const HOME_RPC = "https://mainnet.base.org";
export const HOME_EXPLORER = "https://basescan.org";
export const HOME_TOKEN: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
export const HOME_DECIMALS = 6;
export const HOME_SYMBOL = "USDC";
export const ETH_LOGO = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png";
export const HOME_LOGO = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png";

/**
 * Older names, kept because the executor uses them everywhere: they mean "the home chain / token" (now USDC on Base),
 * not Robinhood Chain or USDG. Vaults that live on Robinhood Chain use chain id 4663 from exec-chains.
 */
export const ROBINHOOD_CHAIN_ID = HOME_CHAIN_ID;
export const ROBINHOOD_EXPLORER = HOME_EXPLORER;
export const USDG = HOME_TOKEN;
export const USDG_DECIMALS = HOME_DECIMALS;
export const USDG_LOGO = HOME_LOGO;

const client = createPublicClient({ transport: http(HOME_RPC, { timeout: 20_000, retryCount: 2 }) });

export type Balances = { usdg: number; eth: number; usdgRaw: bigint; ethRaw: bigint; /** USD per ETH; 0 if the price couldn't be loaded */ ethPrice: number };

/** USDC and ETH held by the address on Base. */
export async function getBalances(address: Address): Promise<Balances> {
  const [usdgRaw, ethRaw, ethPrice] = await Promise.all([
    client.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    client.getBalance({ address }),
    // LI.FI's open price for native ETH on Base.
    fetch(`https://li.quest/v1/token?chain=${HOME_CHAIN_ID}&token=0x0000000000000000000000000000000000000000`)
      .then((r) => r.json() as Promise<{ priceUSD?: string }>)
      .then((t) => Number(t.priceUSD) || 0)
      .catch(() => 0),
  ]);
  return { usdg: Number(formatUnits(usdgRaw, USDG_DECIMALS)), eth: Number(formatUnits(ethRaw, 18)), usdgRaw, ethRaw, ethPrice };
}

export const isAddress = (v: string): v is Address => /^0x[a-fA-F0-9]{40}$/.test(v.trim());

/**
 * Builds an unsigned EIP-1559 USDC transfer on Base, ready for Turnkey to sign.
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
    chainId: HOME_CHAIN_ID,
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

/** Builds an unsigned EIP-1559 ETH transfer on Base. Same output as `buildUsdgTransfer`. */
export async function buildEthTransfer(from: Address, to: Address, amount: string): Promise<{ unsigned: string; feeEth: number }> {
  const value = parseUnits(amount, 18);
  const [nonce, gas, fees] = await Promise.all([
    client.getTransactionCount({ address: from, blockTag: "pending" }),
    client.estimateGas({ account: from, to, value }),
    client.estimateFeesPerGas(),
  ]);
  const gasLimit = (gas * BigInt(12)) / BigInt(10);
  const serialized = serializeTransaction({
    type: "eip1559",
    chainId: HOME_CHAIN_ID,
    nonce,
    to,
    value,
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
