/**
 * EVM chains Pecun executes on: RPC, native gas token, and how much gas the gas tank sends per top-up.
 * Shared by the browser executor and the server gas tank. Every RPC is free, public and allows browser calls.
 */

export type EvmChain = {
  id: number;
  /** Name as the catalog writes it (vault `chain` field). */
  names: string[];
  rpc: string;
  /** Backups, used automatically when the main RPC is slow or rate-limits. */
  backups?: string[];
  native: string;
  /** Sent when the user is short; covers a few transactions. */
  topUp: string;
  /** Most a single top-up may send. */
  maxTopUp: string;
};

export const EVM_CHAINS: EvmChain[] = [
  { id: 4663, names: ["Robinhood"], rpc: "https://rpc.mainnet.chain.robinhood.com", native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 8453, names: ["Base"], rpc: "https://mainnet.base.org", backups: ["https://base-rpc.publicnode.com"], native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 1, names: ["Ethereum"], rpc: "https://ethereum-rpc.publicnode.com", backups: ["https://eth.drpc.org", "https://cloudflare-eth.com"], native: "ETH", topUp: "0.0005", maxTopUp: "0.003" },
  { id: 42161, names: ["Arbitrum"], rpc: "https://arb1.arbitrum.io/rpc", backups: ["https://arbitrum-one-rpc.publicnode.com"], native: "ETH", topUp: "0.00003", maxTopUp: "0.0002" },
  { id: 10, names: ["Optimism"], rpc: "https://mainnet.optimism.io", backups: ["https://optimism-rpc.publicnode.com"], native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 56, names: ["BNB Chain", "BSC"], rpc: "https://bsc-rpc.publicnode.com", backups: ["https://bsc-dataseed.bnbchain.org"], native: "BNB", topUp: "0.0002", maxTopUp: "0.001" },
  { id: 43114, names: ["Avalanche"], rpc: "https://api.avax.network/ext/bc/C/rpc", backups: ["https://avalanche-c-chain-rpc.publicnode.com"], native: "AVAX", topUp: "0.02", maxTopUp: "0.08" },
  { id: 143, names: ["Monad"], rpc: "https://rpc.monad.xyz", native: "MON", topUp: "0.3", maxTopUp: "1.5" },
  { id: 999, names: ["HyperEVM"], rpc: "https://rpc.hyperliquid.xyz/evm", native: "HYPE", topUp: "0.0005", maxTopUp: "0.003" },
  { id: 747474, names: ["Katana"], rpc: "https://rpc.katana.network", backups: ["https://katana.drpc.org"], native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
];

export const evmChain = (id: number) => EVM_CHAINS.find((c) => c.id === id);
export const chainIdByName = (name: string) => EVM_CHAINS.find((c) => c.names.includes(name))?.id;
