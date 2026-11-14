import { ActivityView } from "@/components/portfolio";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta({
  title: "Activity",
  description: "Your deposit and withdrawal history, plus anything still pending, in one list.",
  path: "/portfolio/activity",
  noindex: true,
});

export default function ActivityPage() {
  return <ActivityView />;
}
