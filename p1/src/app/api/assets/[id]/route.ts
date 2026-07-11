import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!db) {
    return new Response("Not found", { status: 404 });
  }

  const [row] = await db
    .select({ mime: assets.mime, bytes: assets.bytes })
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);

  if (!row) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(row.bytes), {
    status: 200,
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
