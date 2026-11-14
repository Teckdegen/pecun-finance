import { buildCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = await buildCatalog();
  return Response.json(catalog);
}
