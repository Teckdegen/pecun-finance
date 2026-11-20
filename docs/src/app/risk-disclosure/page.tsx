import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal";
import { LEGAL } from "@/lib/site";

export const metadata: Metadata = { title: "Risk Disclosure", description: "The risks of using Pecun and the yield products it lists." };

const b = (title: string, text: string) => (
  <>
    <span className="text-ink">{title}</span> — {text}
  </>
);

/**
 * Pecun's risk disclosure, written for what Pecun actually lists (lending markets, curated vaults,
 * liquid staking, fixed yield, liquidity pools, perp vaults) and how it works (routing, bridges,
 * sponsored gas, fees).
 */
const SECTIONS: LegalSection[] = [
  {
    heading: "What Pecun is",
    body: [
      "Pecun is an interface that finds yield across EVM chains, Solana, Sui and Hyperliquid and routes your deposits and withdrawals into them. Every vault, lending market, pool and staking product shown is run by an independent protocol or manager, not by Pecun. Pecun does not manage strategies, make investment decisions or give investment advice. Make sure you understand a product and its risks before you deposit.",
      "Pecun does not hold the assets you deposit. They sit in the protocol you choose, and the position belongs to your wallet. Pecun builds the transactions you approve and charges a fee on deposits only, shown before you confirm; withdrawals carry no Pecun fee. Protocols may charge their own fees (performance, management, withdrawal or unstaking), which are separate from Pecun's.",
    ],
  },
  {
    heading: "Smart contract risks",
    body: ["Every product runs on smart contracts written and maintained by its protocol. Audits reduce risk but do not remove it, and several distinct risks remain:"],
    bullets: [
      b("Security vulnerabilities", "Bugs, logic flaws or exploits can cause partial or total loss of funds."),
      b("Admin keys and upgrades", "Protocol teams, multisigs or DAOs can change contract behaviour, and a compromised key can drain a protocol."),
      b("Oracles", "Prices often come from external oracles that can be wrong, delayed or manipulated, triggering bad liquidations or bad debt."),
      b("Composability", "Many vaults deposit into other protocols, so a failure in one can spread to the products built on it."),
    ],
  },
  {
    heading: "Third-party protocol and manager risks",
    body: [
      "Curators and vault managers decide where vault funds go, and their choices, mistakes or governance changes affect both returns and safety. Protocols can freeze, pause, deprecate or delist a product at any time. When that happens Pecun closes new deposits and shows the product as withdraw-only or paused where it can detect it, but whether and when you can withdraw is up to the protocol.",
    ],
  },
  {
    heading: "Lending risks",
    body: [
      "Supplied assets are lent to borrowers. When a market is heavily borrowed you may be unable to withdraw until borrowers repay or new deposits arrive. Failed or late liquidations can leave bad debt that reduces what lenders get back.",
    ],
  },
  {
    heading: "Liquid staking risks",
    body: [
      "Staking tokens such as stETH, mSOL or afSUI can trade below the value of the staked asset. Unstaking can take days or weeks, instant exits usually cost a fee, and validator penalties (slashing) can reduce the amount staked.",
    ],
  },
  {
    heading: "Fixed-yield risks",
    body: [
      "A fixed rate is only locked in if you hold to maturity. Selling before maturity happens at the market price and can return less than you put in, and the underlying yield source can still fail.",
    ],
  },
  {
    heading: "Liquidity pool risks",
    body: [
      "Providing liquidity exposes you to both tokens in a pool and to impermanent loss when their prices move apart. Pool yields are based on recent trading fees and can fall sharply, and concentrated positions stop earning when the price leaves their range.",
    ],
  },
  {
    heading: "Perp vault risks",
    body: ["Vaults that trade or provide liquidity on perpetuals exchanges can lose money, sometimes quickly, and may have lockups or withdrawal delays."],
  },
  {
    heading: "Stablecoin and asset risks",
    body: [
      "Stablecoins can lose their peg, and yield-bearing stablecoins depend on strategies such as lending, basis trades or real-world assets that can fail. Issuers may be able to freeze tokens. The asset you deposit can also fall in value regardless of the yield it earns.",
    ],
  },
  {
    heading: "Data and APY risks",
    body: [
      "APY, TVL and other figures come from each protocol's own data and may be delayed, estimated or wrong. APYs are variable, can change at any time and are not a promise of future returns. Past performance does not guarantee future results.",
    ],
  },
  {
    heading: "Cross-chain and routing risks",
    body: ["Moving funds between chains or tokens uses third-party bridges and swap routers. They can fail, be exploited, be delayed, or fill at a worse price than quoted (slippage)."],
  },
  {
    heading: "Network risks",
    body: [
      "Blockchains can become congested, halt or reorganise, and transactions can fail or be delayed. Pecun cannot guarantee when or whether a transaction is included.",
    ],
  },
  {
    heading: "Regulatory risks",
    body: [
      "Rules for digital assets change and differ between jurisdictions. Access to Pecun or to individual protocols may be restricted in some places, and regulatory action can restrict, delay or close products without notice.",
    ],
  },
  {
    heading: "Operational risks",
    body: [
      "Pecun depends on its own software and on wallet, data and network providers. Outages or failures can make the interface unavailable. Your positions remain on-chain and can still be managed directly through each protocol.",
    ],
  },
  {
    heading: "Your acceptance",
    body: [
      <>
        Using Pecun and the products it lists is entirely at your own risk. You could lose some or all of what you deposit, and returns are never guaranteed. See also our{" "}
        <Link className="font-medium text-[#2f7d1c] underline decoration-[#2f7d1c]/30 underline-offset-[3px] hover:decoration-[#2f7d1c]" href="/terms">Terms and Conditions</Link>.
      </>,
    ],
  },
];

export default function RiskDisclosurePage() {
  return (
    <LegalPage
      title="Risk Disclosure"
      effective={LEGAL.effectiveDate}
      intro={<p>Using Pecun involves risk. Read this before you deposit into any product listed on Pecun.</p>}
      sections={SECTIONS}
    />
  );
}
