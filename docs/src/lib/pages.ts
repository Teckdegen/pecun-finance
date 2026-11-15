/** The docs, in reading order. The sidebar, the page titles and the previous/next links all come from here. */
export type DocPage = { href: string; title: string; summary: string };
export type DocGroup = { title: string; pages: DocPage[] };

export const GROUPS: DocGroup[] = [
  {
    title: "Get started",
    pages: [
      { href: "/", title: "Introduction", summary: "What Pecun is and what you can do with it." },
      { href: "/getting-started", title: "Getting started", summary: "Sign up, add funds and make your first deposit." },
      { href: "/how-it-works", title: "How Pecun works", summary: "Find, deposit, earn, and what happens in between." },
    ],
  },
  {
    title: "Using Pecun",
    pages: [
      { href: "/explore", title: "Exploring yields", summary: "Categories, filters and how to compare vaults." },
      { href: "/deposits", title: "Deposits", summary: "How a deposit goes from your wallet into a protocol." },
      { href: "/withdrawals", title: "Withdrawals", summary: "Instant exit, withdrawal queues and maturity." },
      { href: "/rates", title: "Rates and APY", summary: "Where rates come from and what they include." },
      { href: "/fees", title: "Fees", summary: "What Pecun charges, and what protocols charge." },
    ],
  },
  {
    title: "Security",
    pages: [
      { href: "/wallet", title: "Wallet and custody", summary: "Your self-custodial wallet, powered by Turnkey." },
      { href: "/risks", title: "Risks", summary: "What can go wrong, and how to think about it." },
    ],
  },
  {
    title: "Ecosystem",
    pages: [
      { href: "/protocols", title: "Supported protocols", summary: "Every platform Pecun lists." },
      { href: "/providers", title: "Partners and providers", summary: "The infrastructure Pecun runs on." },
      { href: "/token", title: "Pecun token", summary: "What we can share so far." },
    ],
  },
  {
    title: "Resources",
    pages: [
      { href: "/faq", title: "FAQ", summary: "Short answers to common questions." },
      { href: "/availability", title: "Availability", summary: "Where Pecun is and isn't available." },
      { href: "/brand", title: "Brand kit", summary: "Logo, colours and images." },
      { href: "/legal", title: "Legal and contact", summary: "Terms, privacy, risk disclosure and how to reach us." },
    ],
  },
];

export const PAGES: DocPage[] = GROUPS.flatMap((g) => g.pages);

export function pageFor(href: string): DocPage {
  const p = PAGES.find((x) => x.href === href);
  if (!p) throw new Error(`No docs page registered for ${href}`);
  return p;
}
