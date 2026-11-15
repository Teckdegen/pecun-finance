import type { Metadata } from "next";
import { ThankYouNote } from "@/components/thank-you-note";
import { pageMeta } from "@/lib/meta";

export const metadata: Metadata = pageMeta({
  title: "Thank you",
  description: "Thanks for writing to Pecun.",
  path: "/thank-you",
  noindex: true,
});

/** Where a valid contact form lands. Not indexed. */
export default function ThankYouPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-20 text-center">
      <ThankYouNote />
    </main>
  );
}
