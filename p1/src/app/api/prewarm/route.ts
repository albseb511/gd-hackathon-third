import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, playthroughs } from "@/db/schema";
import { generateImage } from "@/lib/artist";
import { loadPlaythroughContext } from "@/lib/storyEngine/loadContext";
import { withTiming } from "@/lib/gemini";
import { PlayState } from "@/lib/storyEngine/types";

export const maxDuration = 120;

// Pre-paints the opening scenes right after character creation — the first
// beat plus everything it branches to — so the story starts with zero image
// wait and the first choices swap instantly. Fired fire-and-forget from the
// character forge while the player admires their portrait.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    playthroughId?: string;
    aspect?: "16:9" | "9:16";
  } | null;
  if (!body?.playthroughId || !db) {
    return NextResponse.json({ ok: false, warmed: 0 });
  }
  const ctx = await loadPlaythroughContext(body.playthroughId);
  if (!ctx || ctx.sceneCount > 0) {
    // never prewarm a story already in motion
    return NextResponse.json({ ok: true, warmed: 0 });
  }

  const beats = ctx.outline.acts.flatMap((a) => a.beats);
  const first = beats[0];
  const targetIds = [first.id, ...first.leadsTo].slice(0, 5);
  const targets = targetIds
    .map((id) => beats.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  // portrait as reference for protagonist consistency
  let referenceImages: { data: Buffer; mime: string }[] = [];
  const portraitIds = (ctx.charactersSheets as { portraitAssetId?: string | null }[])
    .map((c) => c.portraitAssetId)
    .filter((x): x is string => Boolean(x));
  if (portraitIds.length) {
    const [row] = await db
      .select({ mime: assets.mime, bytes: assets.bytes })
      .from(assets)
      .where(eq(assets.id, portraitIds[0]));
    if (row) referenceImages = [{ data: row.bytes, mime: row.mime }];
  }

  const results = await Promise.all(
    targets.map((beat) =>
      withTiming("prewarm-image", { playthroughId: body.playthroughId }, () =>
        generateImage({
          prompt: `${beat.sceneHint}. Opening chapter of the story.`,
          artStyle: ctx.outline.artStyle,
          referenceImages,
          aspectRatio: body.aspect ?? "16:9",
          timeoutMs: 25000,
        }),
      )
        .then(async (img) => {
          const [inserted] = await db!
            .insert(assets)
            .values({
              kind: "scene",
              playthroughId: body.playthroughId,
              mime: img.mime,
              bytes: img.data,
            })
            .returning({ id: assets.id });
          return { beatId: beat.id, assetId: inserted.id };
        })
        .catch(() => null),
    ),
  );

  const cache: Record<string, string> = {};
  for (const r of results) if (r) cache[r.beatId] = r.assetId;

  if (Object.keys(cache).length) {
    const state = { ...(ctx.state as PlayState), sceneCache: cache };
    await db
      .update(playthroughs)
      .set({ state })
      .where(eq(playthroughs.id, body.playthroughId));
  }

  return NextResponse.json({ ok: true, warmed: Object.keys(cache).length });
}
