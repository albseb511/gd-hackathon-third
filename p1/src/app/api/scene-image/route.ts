import { NextResponse } from "next/server";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { generateImage, ImageGenError } from "@/lib/artist";

export const maxDuration = 60;

interface SceneImageBody {
  prompt: string;
  artStyle: string;
  mood?: string;
  shot?: "new" | "edit";
  playthroughId?: string;
  referenceAssetIds?: string[];
  previousAssetId?: string;
  kind?: "scene" | "item" | "portrait" | "ui";
}

export async function POST(req: Request) {
  let body: SceneImageBody;
  try {
    body = (await req.json()) as SceneImageBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.prompt || !body.artStyle) {
    return NextResponse.json(
      { error: "prompt and artStyle are required" },
      { status: 400 },
    );
  }

  // Load reference/previous asset bytes when the db is wired up.
  let referenceImages: { data: Buffer; mime: string }[] | undefined;
  let previousImage: { data: Buffer; mime: string } | undefined;

  if (db) {
    const refIds = body.referenceAssetIds ?? [];
    if (refIds.length > 0) {
      const rows = await db
        .select({ id: assets.id, mime: assets.mime, bytes: assets.bytes })
        .from(assets)
        .where(inArray(assets.id, refIds));
      // Preserve caller ordering — the first reference is the protagonist.
      const byId = new Map(rows.map((r) => [r.id, r]));
      referenceImages = refIds
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ data: r.bytes, mime: r.mime }));
    }

    if (body.previousAssetId) {
      const [row] = await db
        .select({ mime: assets.mime, bytes: assets.bytes })
        .from(assets)
        .where(eq(assets.id, body.previousAssetId))
        .limit(1);
      if (row) previousImage = { data: row.bytes, mime: row.mime };
    }
  }

  try {
    const image = await generateImage({
      prompt: body.prompt,
      artStyle: body.artStyle,
      mood: body.mood,
      referenceImages,
      previousImage,
      shot: body.shot,
    });

    const dataUrl = `data:${image.mime};base64,${image.data.toString("base64")}`;

    if (!db) {
      return NextResponse.json({ assetId: null, dataUrl });
    }

    const [inserted] = await db
      .insert(assets)
      .values({
        kind: body.kind ?? "scene",
        playthroughId: body.playthroughId ?? null,
        storyId: null,
        mime: image.mime,
        bytes: image.data,
      })
      .returning({ id: assets.id });

    return NextResponse.json({ assetId: inserted.id, dataUrl });
  } catch (err) {
    if (err instanceof ImageGenError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "timeout" ? 504 : 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Image generation failed" },
      { status: 500 },
    );
  }
}
