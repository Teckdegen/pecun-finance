import { notFound } from "next/navigation";
import { VaultView } from "@/components/vault-view";
import { findBySlug } from "@/lib/catalog.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { item } = await findBySlug(slug);
  return { title: item ? `${item.name} · PECUN` : "Vault · PECUN" };
}

export default async function VaultPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { item } = await findBySlug(slug);
  if (!item) notFound();

  return <VaultView o={item} deployments={[item]} />;
}
