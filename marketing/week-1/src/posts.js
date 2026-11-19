// Week 1 of Pecun posts: 3 a day (morning, midday partner post, evening).
// Each post has its X text and the card its graphic is rendered from (card.html?id=<id>).
// Rates were read from the Pecun app on 19 Nov 2026: check them in the app on the day you post, they move.
const RATES_DATE = "19 Nov 2026";

const POSTS = [
  /* ---------------- Day 1: launch ---------------- */
  {
    id: "d1-1-launch",
    day: 1,
    slot: "Morning",
    card: { type: "headline", title: "Every yield in crypto.<br />One click.", sub: "1,600+ vaults · 30 protocols · 20+ chains" },
    text: [
      "Yield onchain isn't hard to find. It's hard to reach.\n\nThe best rate is usually on a chain you're not on, behind a bridge, a swap and a gas token you don't hold. That's why most money just sits.\n\nPecun is live: 1,600+ vaults, 30 protocols, 20+ chains, each one click from your wallet.",
      "Why one click matters more than the rate:\n\nOn a $100 deposit, a careless route can cost 2% to get in and 2% to get out. That's months of yield gone before you earn anything.\n\nPecun quotes the whole round trip first and won't run a route that costs over 0.5%.",
      "What's one click away now:\n\nLending: @aave @MorphoLabs @compoundfinance @eulerfinance @0xfluid @VenusProtocol @MoonwellDeFi\nFixed yield: @pendle_fi\nAuto-compounding: @beefyfinance @yearnfi\nStaking: @LidoFinance @Rocket_Pool @MarinadeFinance\nSolana: @KaminoFinance @MeteoraAG",
      "Rates are variable and every vault has its own risks: Pecun shows them on each vault page before you press.\n\nStop picking a chain. Pick the vault.\n\napp.pecun.finance"
    ],
  },
  {
    id: "d1-2-aave",
    day: 1,
    slot: "Midday · partner",
    card: { type: "partner", logo: "logos/aave.png", name: "Aave", sub: "Aave lending on 14 chains, one click from Robinhood Chain." },
    text: [
      "Lending is the oldest yield in DeFi: borrowers pay interest, suppliers earn it. No token emissions needed, just demand to borrow.\n\n@aave runs the biggest lending markets onchain, on 14 chains. On Pecun, every one of them is one click from your wallet."
    ],
  },
  {
    id: "d1-3-how",
    day: 1,
    slot: "Evening",
    card: {
      type: "steps",
      title: "How Pecun works",
      steps: [
        ["Sign in", "Email or passkey. Your wallet is ready."],
        ["Pick a vault", "1,600+ across 20+ chains, sorted by rate."],
        ["Press once", "Pecun moves, swaps and deposits."],
      ],
    },
    text: [
      "The real cost of DeFi isn't the fee. It's the hour.\n\nFind the vault, bridge, buy gas, swap, approve, deposit. Then all of it backwards to leave.\n\nOn Pecun: sign in, pick a vault, press once. Exiting is one press too."
    ],
  },

  /* ---------------- Day 2 ---------------- */
  {
    id: "d2-1-rates",
    day: 2,
    slot: "Morning",
    card: {
      type: "rates",
      title: "Stablecoin rates this week",
      rows: [
        ["Moonwell", "USDC lending · Base", "17.0%"],
        ["Pendle", "PT USD3 · fixed to 17 Dec", "14.8%"],
        ["Morpho", "USDC market · Ethereum", "13.6%"],
        ["Fluid", "USDC lending · Ethereum", "13.4%"],
      ],
      note: `APY as of ${RATES_DATE}. Rates are variable and not guaranteed.`,
    },
    text: [
      "APY is a speed, not a promise.\n\nThese are this week's stablecoin rates on Pecun. They will move: lending rates follow borrowing demand, and fixed rates (like Pendle's) only hold if you keep to maturity.\n\nCompare rates, then compare exits. Rates as of 19 Nov 2026, variable, not guaranteed."
    ],
  },
  {
    id: "d2-2-morpho",
    day: 2,
    slot: "Midday · partner",
    card: { type: "partner", logo: "logos/morpho.ico", name: "Morpho", sub: "680 Morpho vaults and markets, one click away." },
    text: [
      "Curators are the fund managers of DeFi, and most people have never heard of them.\n\nOn @MorphoLabs, teams like Steakhouse and Gauntlet choose which markets a vault lends into and how much risk it takes. Picking a vault is picking a curator.\n\n680 Morpho vaults and markets, one click away on Pecun."
    ],
  },
  {
    id: "d2-3-fees",
    day: 2,
    slot: "Evening",
    card: { type: "headline", title: "0.5%. Shown before<br />you press.", sub: "Not charged if a deposit doesn't complete." },
    text: [
      "A fee you can't see before you press isn't a fee. It's a surprise.\n\nPecun shows its 0.5% fee and the full bridge and swap cost up front, takes the fee only after your deposit lands, and charges nothing if it doesn't complete."
    ],
  },

  /* ---------------- Day 3 ---------------- */
  {
    id: "d3-1-nobridge",
    day: 3,
    slot: "Morning",
    card: { type: "headline", title: "No bridging.<br />No gas tokens.", sub: "Hold USDG. Earn on any chain." },
    text: [
      "\"Gas token\" is a UX bug, not a feature.\n\nNobody should have to buy ETH to earn on Ethereum, SOL to earn on Solana and SUI to earn on Sui.\n\nOn Pecun you hold USDG. The moves and the network fees on the way are handled for you."
    ],
  },
  {
    id: "d3-2-kamino",
    day: 3,
    slot: "Midday · partner",
    card: { type: "partner", logo: "logos/kamino.png", name: "Kamino", sub: "Kamino's Solana vaults, without holding SOL." },
    text: [
      "The chain you're on shouldn't decide what you earn.\n\nSome of the deepest stablecoin and SOL yields live on Solana, in @KaminoFinance vaults. Most EVM users never touch them because of the new wallet, the bridge and the SOL for gas.\n\nOn Pecun they're one click from USDG."
    ],
  },
  {
    id: "d3-3-cap",
    day: 3,
    slot: "Evening",
    card: { type: "headline", title: "Every route,<br />capped at 0.5%.", sub: "Why Pecun lists 1,600 vaults, not 2,100." },
    text: [
      "\"Just bridge it\" is the most expensive sentence in crypto.",
      "Bridges and swaps carry fixed costs. On $10,000 they're noise. On $100 they can be 2% each way, more than a month of yield.\n\nSo we checked every route into and out of every vault, and left out the ones that cost more than 0.5% at $100. Shorter list, better deal."
    ],
  },

  /* ---------------- Day 4 ---------------- */
  {
    id: "d4-1-chains",
    day: 4,
    slot: "Morning",
    card: {
      type: "list",
      title: "20+ chains. One wallet.",
      items: ["Ethereum", "Base", "Arbitrum", "Solana", "Optimism", "Avalanche", "BNB Chain", "Polygon", "HyperEVM", "Monad", "Katana", "Robinhood Chain", "Linea", "Plasma", "Ink", "Unichain"],
      note: "and more",
    },
    text: [
      "Stop picking a chain, then a vault. Pick the vault.\n\nThe old way: choose a network, move money there, see what's on offer.\nThe better way: see every vault on 20+ chains at once, pick the best, press once.\n\nThat's Pecun."
    ],
  },
  {
    id: "d4-2-pendle",
    day: 4,
    slot: "Midday · partner",
    card: { type: "partner", logo: "logos/pendle.png", name: "Pendle", sub: "Fixed yield on 6 chains, locked in with one press." },
    text: [
      "Fixed yield is the most underrated thing in DeFi.\n\nWith @pendle_fi you buy a PT at a discount and it's worth the full amount at maturity. The gap is a rate you lock in, like a bond. Sell early and you get that day's market price.\n\nOn Pecun it's one click from USDG."
    ],
  },
  {
    id: "d4-3-ask",
    day: 4,
    slot: "Evening",
    card: { type: "headline", title: "Where do your idle<br />stablecoins sit?", sub: "Wallet · Exchange · Lending · Vaults" },
    text: [
      "Idle stablecoins aren't safe from loss. They're losing quietly.\n\nMoney that earns nothing falls behind inflation every day it sits. The question isn't whether to put it to work, it's where, and at what risk.\n\nPecun shows you both, one click from any vault onchain."
    ],
  },

  /* ---------------- Day 5 ---------------- */
  {
    id: "d5-1-robinhood",
    day: 5,
    slot: "Morning",
    card: { type: "headline", title: "Yield for<br />Robinhood Chain.", sub: "Hold USDG. Earn across 20+ chains." },
    text: [
      "Being on Robinhood Chain shouldn't mean only earning what's on Robinhood Chain.\n\nHold USDG. Pecun takes it to the vault you pick on any of 20+ chains, and every withdrawal comes back to USDG at home."
    ],
  },
  {
    id: "d5-2-lido",
    day: 5,
    slot: "Midday · partner",
    card: { type: "partner", logo: "logos/lido.png", name: "Lido", sub: "Stake ETH with Lido, straight from USDG." },
    text: [
      "Liquid staking: earn staking rewards without locking your ETH.\n\nStake through @LidoFinance and you get stETH, which earns while you hold it and can be sold any time. That's why it's the biggest yield product onchain.\n\nOn Pecun, stETH is one click from USDG."
    ],
  },
  {
    id: "d5-3-keys",
    day: 5,
    slot: "Evening",
    card: { type: "headline", title: "Your wallet.<br />Your keys.", sub: "Pecun's servers can't move your money." },
    text: [
      "\"Not your keys\" was never just about exchanges. It's about who can move your money.\n\nYour Pecun wallet's keys sit in secure hardware, and only your own sign-in can approve a move. Pecun's servers can't move your funds on their own."
    ],
  },

  /* ---------------- Day 6 ---------------- */
  {
    id: "d6-1-exits",
    day: 6,
    slot: "Morning",
    card: { type: "headline", title: "Withdrawals that<br />finish themselves.", sub: "Queued exits come home automatically." },
    text: [
      "Most people compare rates. Almost nobody compares exits.\n\nSome vaults pay out instantly, some queue you for days, some lock until maturity. The exit is part of the yield.\n\nOn Pecun, queued withdrawals finish themselves: once the vault pays out, the money comes home to USDG. No second press."
    ],
  },
  {
    id: "d6-2-beefy",
    day: 6,
    slot: "Midday · partner",
    card: { type: "partner", logo: "logos/beefy.png", name: "Beefy", sub: "160+ auto-compounding vaults on 9 chains." },
    text: [
      "Auto-compounding is free yield people leave on the table.\n\nRewards that sit unclaimed earn nothing. @beefyfinance vaults claim and reinvest for you, so your earnings earn too, and there's nothing to claim, ever.\n\n160+ Beefy vaults on 9 chains, one click away on Pecun."
    ],
  },
  {
    id: "d6-3-vault",
    day: 6,
    slot: "Evening",
    card: {
      type: "steps",
      title: "What is a vault?",
      steps: [
        ["You deposit", "Your money joins a pool with others."],
        ["It's put to work", "Lent out, staked or used for liquidity."],
        ["It earns", "Your share grows. Withdraw any time*."],
      ],
      note: "*Some vaults have exit queues or maturity dates: the vault page says which.",
    },
    text: [
      "Higher APY usually means higher risk. Here's how to tell why:",
      "A vault pools deposits and puts them to work: lent to borrowers, staked, or used as trading liquidity. Ask where the yield comes from. Borrowers? Fees? Reward tokens? Leverage?\n\nIf you can't answer, you're the yield. Every vault on Pecun says what it does and how you exit."
    ],
  },

  /* ---------------- Day 7 ---------------- */
  {
    id: "d7-1-explore",
    day: 7,
    slot: "Morning",
    card: { type: "headline", title: "1,600 vaults.<br />One search.", sub: "Filter by asset, chain, rate and risk." },
    text: [
      "The yield isn't hidden. It's scattered.\n\nThis week's best stablecoin rate might be on Base, next week on Ethereum, after that on Solana. Chasing it by hand costs more than it earns.\n\nPecun puts 1,600+ vaults in one list, each one click from your wallet."
    ],
  },
  {
    id: "d7-2-gmx",
    day: 7,
    slot: "Midday · partner",
    card: { type: "partner", logo: "logos/gmx.png", name: "GMX", sub: "GMX liquidity pools on Arbitrum and Avalanche." },
    text: [
      "On a perp exchange, someone has to take the other side of every trade. Liquidity providers do, and earn the fees.\n\n@GMX_IO pools on Arbitrum and Avalanche pay LPs from trading fees, with the market risk that comes with it.\n\nOn Pecun they're one click from USDG."
    ],
  },
  {
    id: "d7-3-pen",
    day: 7,
    slot: "Evening",
    card: { type: "headline", title: "$PEN is coming<br />to Base.", sub: "Fair launch · No presale" },
    text: [
      "Most tokens ask you to trust that value flows back to holders. $PEN puts it in a fund you can see.\n\n$PEN launches on Base: fair launch, no presale. Terms and risks will be on docs.pecun.finance first, and the contract will only ever be posted there and here."
    ],
  },
];

if (typeof module !== "undefined") module.exports = { POSTS, RATES_DATE };
