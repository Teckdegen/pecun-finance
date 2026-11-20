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
  /** false when Relay can't reach the chain: routes then go Relay to USDC on a hub (Base/Arbitrum) and LI.FI or CCTP from there. */
  relay?: boolean;
  /**
   * Chains with no native gas coin (Tempo): fees are paid in this TIP-20 stablecoin, and `topUp` / `maxTopUp` are
   * amounts of it. The gas tank tops users up by sending it.
   */
  feeToken?: { address: `0x${string}`; decimals: number };
  /**
   * 0 turns off the gas a deposit's bridge delivers here (stablecoin-gas chains). Otherwise it's sized from the live
   * gas estimate (see gasReserveUsd in execute.ts).
   */
  gasReserveUsd?: number;
};

export const EVM_CHAINS: EvmChain[] = [
  { id: 4663, names: ["Robinhood"], rpc: "https://rpc.mainnet.chain.robinhood.com", native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 8453, names: ["Base"], rpc: "https://mainnet.base.org", backups: ["https://base-rpc.publicnode.com"], native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 1, names: ["Ethereum"], rpc: "https://ethereum-rpc.publicnode.com", backups: ["https://eth.drpc.org", "https://cloudflare-eth.com"], native: "ETH", topUp: "0.0005", maxTopUp: "0.003" },
  { id: 42161, names: ["Arbitrum"], rpc: "https://arb1.arbitrum.io/rpc", backups: ["https://arbitrum-one-rpc.publicnode.com"], native: "ETH", topUp: "0.00003", maxTopUp: "0.0015" },
  { id: 10, names: ["Optimism"], rpc: "https://mainnet.optimism.io", backups: ["https://optimism-rpc.publicnode.com"], native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 56, names: ["BNB Chain", "BSC"], rpc: "https://bsc-rpc.publicnode.com", backups: ["https://bsc-dataseed.bnbchain.org"], native: "BNB", topUp: "0.0002", maxTopUp: "0.001" },
  { id: 43114, names: ["Avalanche"], rpc: "https://api.avax.network/ext/bc/C/rpc", backups: ["https://avalanche-c-chain-rpc.publicnode.com"], native: "AVAX", topUp: "0.02", maxTopUp: "0.25" },
  { id: 143, names: ["Monad"], rpc: "https://rpc.monad.xyz", native: "MON", topUp: "0.3", maxTopUp: "1.5" },
  { id: 999, names: ["HyperEVM"], rpc: "https://rpc.hyperliquid.xyz/evm", native: "HYPE", topUp: "0.0005", maxTopUp: "0.003" },
  { id: 747474, names: ["Katana"], rpc: "https://rpc.katana.network", backups: ["https://katana.drpc.org"], native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 137, names: ["Polygon"], rpc: "https://polygon-bor-rpc.publicnode.com", backups: ["https://polygon-rpc.com"], native: "POL", topUp: "0.8", maxTopUp: "3" },
  { id: 130, names: ["Unichain"], rpc: "https://mainnet.unichain.org", native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 59144, names: ["Linea"], rpc: "https://rpc.linea.build", native: "ETH", topUp: "0.0002", maxTopUp: "0.001" },
  { id: 57073, names: ["Ink"], rpc: "https://ink.drpc.org", native: "ETH", topUp: "0.00003", maxTopUp: "0.0001" },
  { id: 5000, names: ["Mantle"], rpc: "https://rpc.mantle.xyz", native: "MNT", topUp: "0.5", maxTopUp: "3" },
  { id: 100, names: ["Gnosis"], rpc: "https://rpc.gnosischain.com", native: "xDAI", topUp: "0.01", maxTopUp: "0.05" },
  { id: 42220, names: ["Celo"], rpc: "https://forno.celo.org", native: "CELO", topUp: "0.5", maxTopUp: "2" },
  { id: 196, names: ["X Layer", "Chain 196"], rpc: "https://rpc.xlayer.tech", native: "OKB", topUp: "0.0002", maxTopUp: "0.001" },
  { id: 9745, names: ["Plasma"], rpc: "https://rpc.plasma.to", native: "XPL", topUp: "0.05", maxTopUp: "0.3" },
  { id: 5042, names: ["Arc"], rpc: "https://rpc.mainnet.arc.io", native: "USDC", topUp: "0.05", maxTopUp: "0.3", gasReserveUsd: 0 },
  { id: 4326, names: ["MegaETH", "Megaeth"], rpc: "https://mainnet.megaeth.com/rpc", native: "ETH", topUp: "0.0001", maxTopUp: "0.0005" },
  { id: 324, names: ["zkSync"], rpc: "https://mainnet.era.zksync.io", native: "ETH", topUp: "0.0003", maxTopUp: "0.001" },
  { id: 988, names: ["Stable", "Chain 988"], rpc: "https://rpc.stable.xyz", native: "USDT", topUp: "0.05", maxTopUp: "0.3", gasReserveUsd: 0 },
  // Tempo has no native coin: gas is paid in pathUSD (see feeToken). Relay reaches it directly.
  {
    id: 4217,
    names: ["Tempo"],
    rpc: "https://rpc.mainnet.tempo.xyz",
    backups: ["https://rpc.tempo.xyz", "https://tempo.drpc.org"],
    native: "pathUSD",
    topUp: "0.02",
    maxTopUp: "0.1",
    feeToken: { address: "0x20C0000000000000000000000000000000000000", decimals: 6 },
  },
  // Relay can't reach these; routes go through USDC on Base or Arbitrum and LI.FI (or Circle CCTP) from there.
  {
    id: 50,
    names: ["XDC"],
    rpc: "https://rpc.xinfin.network",
    backups: ["https://rpc1.xinfin.network", "https://erpc.xinfin.network", "https://rpc.ankr.com/xdc", "https://xdc.public-rpc.com"],
    native: "XDC",
    topUp: "0.1",
    maxTopUp: "0.5",
    relay: false,
  },
  { id: 14, names: ["Flare"], rpc: "https://flare-api.flare.network/ext/C/rpc", backups: ["https://rpc.ankr.com/flare", "https://flare.rpc.thirdweb.com"], native: "FLR", topUp: "2", maxTopUp: "10", relay: false },
  { id: 252, names: ["Fraxtal"], rpc: "https://rpc.frax.com", backups: ["https://fraxtal-rpc.publicnode.com", "https://fraxtal.drpc.org"], native: "FRAX", topUp: "0.01", maxTopUp: "0.05", relay: false },
];

export const evmChain = (id: number) => EVM_CHAINS.find((c) => c.id === id);
export const chainIdByName = (name: string) => EVM_CHAINS.find((c) => c.names.includes(name))?.id;
/** Whether Relay reaches the chain (Robinhood, Solana, Hyperliquid and every chain not marked otherwise). */
export const viaRelay = (id: number) => evmChain(id)?.relay !== false;
