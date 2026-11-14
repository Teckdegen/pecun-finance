import { findBySlug } from "@/lib/catalog.ts";
import { getHistory } from "@/lib/history.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  const { item } = await findBySlug(slug);
  if (!item) return Response.json({ error: "Unknown vault" }, { status: 404 });
  return Response.json(await getHistory(item));
}
