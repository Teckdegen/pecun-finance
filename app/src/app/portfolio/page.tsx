import { PortfolioView } from "@/components/portfolio";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta({
  title: "Portfolio",
  description: "See what you've supplied, what you've earned and your open positions, all in one place.",
  path: "/portfolio",
});

export default function PortfolioPage() {
  return <PortfolioView />;
}
