export type Kind =
  | "Lending"
  | "Vault"
  | "Fixed yield"
  | "Liquidity"
  | "Liquid staking"
  | "Perp vault";

export interface Manager {
  name: string;
  logoUrl?: string;
}

export interface Integration {
  name: string;
  description: string;
  url: string;
  logoUrl?: string;
  chain?: string;
}

/**
 * open: deposits and withdrawals work.
 * withdraw-only: no new deposits (frozen, deprecated, supply paused, or delisted by the protocol); exits still work.
 * paused: the protocol has stopped deposits and withdrawals for now.
 */
export type VaultStatus = "open" | "withdraw-only" | "paused";

export interface Opportunity {
  /** Stable unique id: protocol:chain:address */
  id: string;
  /** Missing means open. */
  status?: VaultStatus;
  /** Why the vault isn't open, in plain words (e.g. "Frozen by Aave governance"). */
  statusReason?: string;
  /** When PECUN noticed the vault had dropped off its protocol's list (ISO time). */
  delistedAt?: string;
  /** URL slug for /earn/[slug]; assigned by the catalog so it is unique */
  slug?: string;
  protocol: string;
  name: string;
  /** Receipt / share token symbol, e.g. hBTC */
  ticker?: string;
  /** Main deposit asset symbol, e.g. USDC */
  asset: string;
  kind: Kind;
  /** Short strategy label, e.g. "Bitcoin Yield", "Stablecoin Yield" */
  category?: string;
  chain: string;
  /** Net APY as a fraction (0.05 = 5%). null when the source doesn't publish one. */
  apy: number | null;
  apy7d: number | null;
  apy30d: number | null;
  /** Part of the APY paid as rewards (fraction), when the source splits it out */
  rewardApy?: number | null;
  /** How the APY figure is measured, when it isn't a live rate (e.g. "Average since launch") */
  apyNote?: string;
  tvlUsd: number;
  /** Who runs the strategy: curator, manager or the protocol itself */
  manager: string;
  managers?: Manager[];
  /** Human-readable exit timing, e.g. "Instant", "7 days", "Maturity 30 Dec 2027" */
  redemption: string;
  stablecoin: boolean;
  featured?: boolean;
  url: string;
  /** Contract / pool / vault address on its chain */
  address?: string;
  description?: string;
  sharePrice?: number;
  /** Deposit cap in USD, when the vault has one */
  capUsd?: number;
  /** Instant exit through a liquidity facility (e.g. Ember Atomic): share paid now, fee, remaining capacity */
  instantExit?: { via: string; instantPct: number; feePct: number; capacityUsd: number; settlement: string; facilityAddress: string };
  /** Lending-market facts (supply/borrow sides, collateral rules, rate model) */
  lending?: LendingInfo;
  /** Extra facts for the vault page's details grid */
  details?: { label: string; value: string }[];
  links?: { label: string; url: string }[];
  integrations?: Integration[];
  /** Source-specific ids used to load history on the vault page */
  ref?: { source: string; id: string; chainId?: number };
  /** Vault's own logo, when the protocol API provides one */
  logoUrl?: string;
  /** Deposit token logo (from LI.FI's token list, else the protocol API) */
  assetLogo?: string;
  protocolLogo?: string;
  chainLogo?: string;
}

export interface SourceStatus {
  protocol: string;
  ok: boolean;
  count: number;
  error?: string;
  ms: number;
}

export interface Catalog {
  /** Open vaults: what Explore lists. */
  opportunities: Opportunity[];
  /** Withdraw-only, paused or delisted vaults: hidden from Explore, but their pages and withdrawals keep working. */
  closed: Opportunity[];
  sources: SourceStatus[];
  updatedAt: string;
}

/** Time series for the vault page charts: [unix ms, value]. */
export interface History {
  apy?: [number, number][];
  tvl?: [number, number][];
  sharePrice?: [number, number][];
  /** Ember-style averages: window → { deposit, total } as fractions */
  averages?: Record<string, { deposit: number; total: number }>;
  /** Protocol-specific vault facts for the vault page (allocation, fees, roles…) */
  profile?: VaultProfile;
  /** Proof of reserves: where the vault's capital sits right now */
  reserves?: {
    totalUsd: number;
    generatedAt: number;
    groups: { label: string; logoUrl?: string; pct: number; rows: { asset: string; protocol: string; usd: number; pct: number; url?: string }[] }[];
  };
}

export interface AllocationRow {
  id: string;
  loan: { symbol: string; logo?: string };
  collateral?: { symbol: string; logo?: string };
  /** Liquidation LTV as a fraction */
  lltv?: number;
  allocationUsd: number;
  pct: number;
  liquidityUsd?: number;
  utilization?: number;
}

export interface VaultProfile {
  version?: string;
  createdAt?: number;
  description?: string;
  liquidityUsd?: number;
  idleUsd?: number;
  fees?: { label: string; value: string }[];
  roles?: { label: string; address: string }[];
  allocators?: string[];
  timelocks?: { label: string; seconds: number }[];
  allocation?: AllocationRow[];
  /** How the headline APY is built, as the protocol reports it. Fractions. */
  apy?: { native?: number; net?: number; rewards?: { symbol: string; logo?: string; apr: number }[]; performanceFee?: number; managementFee?: number };
}

/** Lending market facts, as each protocol's own app shows them. All rates/ratios are fractions. */
export interface LendingInfo {
  totalSuppliedUsd?: number;
  totalBorrowedUsd?: number;
  liquidityUsd?: number;
  utilization?: number;
  supplyApy?: number;
  borrowApy?: number;
  supplyCapUsd?: number;
  borrowCapUsd?: number;
  maxLtv?: number;
  liquidationThreshold?: number;
  liquidationPenalty?: number;
  canBeCollateral?: boolean;
  reserveFactor?: number;
  priceUsd?: number;
  /** Borrow rate by utilization: points of [utilization, borrow APR] */
  rateCurve?: [number, number][];
  /** Isolated markets (Morpho): the collateral that backs this market */
  collateral?: { symbol: string; logo?: string };
}
