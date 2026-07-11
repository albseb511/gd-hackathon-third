import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { generateImage, ImageGenError } from "@/lib/artist";
import { loadPlaythroughContext } from "@/lib/storyEngine/loadContext";
import { PlayState } from "@/lib/storyEngine/types";

export const maxDuration = 60;

// The server owns ALL image-generation context: the player's portrait +
// visual tokens ride every call, NPC portraits attach whenever their name
// appears in the prompt, and the previous frame carries scene continuity.
// The client only says WHAT to paint, never assembles the references.
interface SceneImageBody {
  prompt: string;
  artStyle: string;
  mood?: string;
  shot?: "new" | "edit";
  playthroughId?: string;
  previousAssetId?: string;
  kind?: "scene" | "item" | "portrait" | "ui";
  aspect?: "16:9" | "9:16" | "3:4" | "4:3" | "1:1" | "2:3" | "3:2" | "21:9";
}

async function loadAssetBytes(
  ids: string[],
): Promise<Map<string, { data: Buffer; mime: string }>> {
  if (!db || ids.length === 0) return new Map();
  const rows = await db
    .select({ id: assets.id, mime: assets.mime, bytes: assets.bytes })
    .from(assets)
    .where(inArray(assets.id, ids));
  return new Map(rows.map((r) => [r.id, { data: r.bytes, mime: r.mime }]));
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

  // quoted dialogue in an image prompt becomes literal speech bubbles
  const prompt = body.prompt.replace(/["“][^"”]{3,}["”]/g, "").replace(/\s{2,}/g, " ").trim();

  const referenceImages: { data: Buffer; mime: string }[] = [];
  const promptExtras: string[] = [];

  if (body.playthroughId && body.kind !== "portrait" && body.kind !== "ui") {
    const ctx = await loadPlaythroughContext(body.playthroughId).catch(() => null);
    if (ctx) {
      const wantedIds: string[] = [];

      // protagonist(s): portrait + visual tokens on EVERY scene generation
      const playerPortraits = ctx.charactersSheets
        .map((c) => c.portraitAssetId)
        .filter((x): x is string => Boolean(x));
      wantedIds.push(...playerPortraits);

      // NPCs actually present in this shot (name-matched against the prompt)
      const npcPortraits = (ctx.state as PlayState).npcPortraits ?? {};
      const promptLower = `${prompt} ${body.mood ?? ""}`.toLowerCase();
      const npcsInShot = ctx.outline.characters.filter((c) =>
        c.name
          .toLowerCase()
          .split(/\s+/)
          .some((part) => part.length > 2 && promptLower.includes(part)),
      );
      for (const npc of npcsInShot) {
        const assetId = npcPortraits[npc.name];
        if (assetId) wantedIds.push(assetId);
      }

      // previous frame for continuity
      if (body.previousAssetId) wantedIds.push(body.previousAssetId);

      const bytes = await loadAssetBytes([...new Set(wantedIds)]);

      let refIndex = 0;
      for (const [i, id] of playerPortraits.entries()) {
        const img = bytes.get(id);
        if (!img) continue;
        referenceImages.push(img);
        refIndex++;
        const sheet = ctx.charactersSheets[i];
        promptExtras.push(
          `Reference image ${refIndex} is the protagonist ("you"${sheet?.name ? `, ${sheet.name}` : ""}): ${sheet?.visualTokens ?? ""}. Keep their face, hair, build and outfit exactly consistent.`,
        );
      }
      for (const npc of npcsInShot) {
        const img = npcPortraits[npc.name] ? bytes.get(npcPortraits[npc.name]) : undefined;
        if (img) {
          referenceImages.push(img);
          refIndex++;
          promptExtras.push(
            `Reference image ${refIndex} is ${npc.name}: keep their appearance exactly consistent.`,
          );
        } else {
          // no portrait yet: at least pin the description
          promptExtras.push(`${npc.name} looks like: ${npc.visualDescription}.`);
        }
      }

      const prev = body.previousAssetId ? bytes.get(body.previousAssetId) : undefined;
      if (prev && body.shot !== "edit") {
        // new shot: previous frame rides as a world/style continuity anchor
        referenceImages.push(prev);
        refIndex++;
        promptExtras.push(
          `Reference image ${refIndex} is the previous scene — same world, same palette, same characters; new camera and moment.`,
        );
      }

      try {
        const image = await generateImage({
          prompt: promptExtras.length ? `${prompt}\n${promptExtras.join(" ")}` : prompt,
          artStyle: body.artStyle,
          mood: body.mood,
          referenceImages,
          previousImage: body.shot === "edit" ? prev : undefined,
          shot: body.shot,
          aspectRatio: body.aspect,
        });
        return await persistAndRespond(image, body);
      } catch (err) {
        return errorResponse(err);
      }
    }
  }

  // no playthrough context (portraits, ui kinds, db-less mode): plain call
  try {
    const prevMap = body.previousAssetId
      ? await loadAssetBytes([body.previousAssetId])
      : new Map<string, { data: Buffer; mime: string }>();
    const image = await generateImage({
      prompt,
      artStyle: body.artStyle,
      mood: body.mood,
      previousImage: body.previousAssetId ? prevMap.get(body.previousAssetId) : undefined,
      shot: body.shot,
      aspectRatio: body.aspect,
    });
    return await persistAndRespond(image, body);
  } catch (err) {
    return errorResponse(err);
  }
}

async function persistAndRespond(
  image: { data: Buffer; mime: string },
  body: SceneImageBody,
) {
  const dataUrl = `data:${image.mime};base64,${image.data.toString("base64")}`;
  if (!db) return NextResponse.json({ assetId: null, dataUrl });
  const [inserted] = await db
    .insert(assets)
    .values({
      kind: body.kind ?? "scene",
      playthroughId:
        body.playthroughId && !body.playthroughId.startsWith("local-")
          ? body.playthroughId
          : null,
      storyId: null,
      mime: image.mime,
      bytes: image.data,
    })
    .returning({ id: assets.id });
  return NextResponse.json({ assetId: inserted.id, dataUrl });
}

function errorResponse(err: unknown) {
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
