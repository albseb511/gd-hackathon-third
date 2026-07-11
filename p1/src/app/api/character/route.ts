// POST /api/character — build a playable character from a selfie (or just a
// name + one-line self description). Portrait painting and sheet extraction
// run in parallel; everything degrades gracefully without a database.
//
// multipart/form-data fields:
//   photo (File, optional) · name (string) · whoAmI (string, optional)
//   playthroughId (string, optional) · deviceKey (string)
//
// -> { characterId, sheet, portraitAssetId, portraitDataUrl }

import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { db } from "@/db";
import { assets, characters, participants } from "@/db/schema";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import { generateImage } from "@/lib/artist";
import { getOrCreatePlayer } from "@/lib/player";
import { loadPlaythroughContext } from "@/lib/storyEngine/loadContext";
import { BASE_ART_STYLE } from "@/lib/storyEngine/outline";
import type { CharacterSheet } from "@/lib/storyEngine/types";

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PORTRAIT_PROMPT =
  "Reimagine this person as a story character portrait, waist-up, dramatic lighting, plain dark background. Preserve facial likeness, hair, build.";

// ---- sheet extraction (vision or text-only, structured output) --------------

const sheetPayloadZ = z.object({
  visualTokens: z.string().min(1),
  personalityHints: z.string().min(1),
  voiceStyle: z.string().min(1),
  stats: z.object({
    might: z.number(),
    wit: z.number(),
    charm: z.number(),
  }),
});

const sheetG: Schema = {
  type: Type.OBJECT,
  properties: {
    visualTokens: {
      type: Type.STRING,
      description:
        "Comma-separated visual phrase for an image model: age band, hair, build, distinctive features, outfit.",
    },
    personalityHints: {
      type: Type.STRING,
      description: "One short line of playable personality traits.",
    },
    voiceStyle: {
      type: Type.STRING,
      description:
        "How this character SOUNDS when quoted, performable by a voice actor: pitch, pace, texture, one verbal tic.",
    },
    stats: {
      type: Type.OBJECT,
      description:
        "Each stat is an integer 1-5; the three must total 9 to 11. Justify the spread by the self-description and appearance vibe.",
      properties: {
        might: { type: Type.INTEGER },
        wit: { type: Type.INTEGER },
        charm: { type: Type.INTEGER },
      },
      required: ["might", "wit", "charm"],
    },
  },
  required: ["visualTokens", "personalityHints", "voiceStyle", "stats"],
  propertyOrdering: ["visualTokens", "personalityHints", "voiceStyle", "stats"],
};

const clampStat = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

function sheetPrompt(name: string, whoAmI: string, hasPhoto: boolean): string {
  return `You are the character-smith for a dark cinematic visual novel. ${
    hasPhoto
      ? "Study the attached photo and the player's self-description, then write their character sheet."
      : "Invent a vivid character sheet from the player's name and self-description alone."
  }

PLAYER NAME: ${name}
SELF-DESCRIPTION: ${whoAmI || "(none given — infer a fitting persona)"}

Rules:
- visualTokens: a comma-separated phrase ready for an image model — age band, hair, build, distinctive features, outfit.${
    hasPhoto ? " Describe the person in the photo faithfully." : ""
  }
- personalityHints: one short line of playable traits, grounded in the self-description${
    hasPhoto ? " and the photo's vibe" : ""
  }.
- voiceStyle: how this character sounds when quoted, performable by a voice actor — pitch, pace, texture, one verbal tic. Ground it in the self-description${
    hasPhoto ? " and the photo's vibe" : ""
  }.
- stats: might, wit, charm — integers 1-5 each, summing to 9-11. Justify the spread by the self-description${
    hasPhoto ? " and appearance" : ""
  }; no flat 3/3/3 unless truly warranted.

Return JSON only, matching the response schema.`;
}

async function generateSheet(
  name: string,
  whoAmI: string,
  photo: { data: Buffer; mime: string } | null,
): Promise<CharacterSheet> {
  const parts = [
    ...(photo
      ? [{ inlineData: { data: photo.data.toString("base64"), mimeType: photo.mime } }]
      : []),
    { text: sheetPrompt(name, whoAmI, !!photo) },
  ];

  const res = await withTiming("character-sheet", { model: MODELS.text }, () =>
    genai().models.generateContent({
      model: MODELS.text,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: sheetG,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  );

  const text = res.text;
  if (!text) throw new Error("character sheet: empty model response");
  const payload = sheetPayloadZ.parse(JSON.parse(text));

  return {
    name,
    visualTokens: payload.visualTokens,
    personalityHints: payload.personalityHints,
    voiceStyle: payload.voiceStyle,
    stats: {
      might: clampStat(payload.stats.might),
      wit: clampStat(payload.stats.wit),
      charm: clampStat(payload.stats.charm),
    },
  };
}

// ---- art style: the playthrough's locked style, else the base ----------------

async function resolveArtStyle(playthroughId?: string): Promise<string> {
  if (!playthroughId) return BASE_ART_STYLE;
  try {
    const ctx = await loadPlaythroughContext(playthroughId);
    return ctx?.outline.artStyle ?? BASE_ART_STYLE;
  } catch {
    return BASE_ART_STYLE;
  }
}

// ---- handler --------------------------------------------------------------------

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const name = String(form.get("name") ?? "").trim();
  const whoAmI = String(form.get("whoAmI") ?? "").trim();
  const deviceKey = String(form.get("deviceKey") ?? "").trim();
  const playthroughId = String(form.get("playthroughId") ?? "").trim() || undefined;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!deviceKey) {
    return NextResponse.json({ error: "deviceKey is required" }, { status: 400 });
  }

  const photoEntry = form.get("photo");
  let photo: { data: Buffer; mime: string } | null = null;
  if (photoEntry instanceof File && photoEntry.size > 0) {
    photo = {
      data: Buffer.from(await photoEntry.arrayBuffer()),
      mime: photoEntry.type || "image/jpeg",
    };
  }

  const artStyle = await resolveArtStyle(playthroughId);

  let sheet: CharacterSheet;
  let portrait: { data: Buffer; mime: string } | null = null;

  try {
    if (photo) {
      // Portrait and sheet extraction race in parallel; a failed portrait
      // must not sink the character, so it soft-fails to null.
      const [portraitResult, sheetResult] = await Promise.all([
        generateImage({
          prompt: PORTRAIT_PROMPT,
          artStyle,
          referenceImages: [photo],
          timeoutMs: 20_000,
        }).catch((err) => {
          console.warn("[character] portrait from photo failed:", err);
          return null;
        }),
        generateSheet(name, whoAmI, photo),
      ]);
      portrait = portraitResult;
      sheet = sheetResult;
    } else {
      sheet = await generateSheet(name, whoAmI, null);
      portrait = await generateImage({
        prompt: `Story character portrait of ${name}: ${sheet.visualTokens}. Waist-up, dramatic lighting, plain dark background.`,
        artStyle,
        timeoutMs: 20_000,
      }).catch((err) => {
        console.warn("[character] portrait from tokens failed:", err);
        return null;
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Character creation failed",
      },
      { status: 502 },
    );
  }

  const portraitDataUrl = portrait
    ? `data:${portrait.mime};base64,${portrait.data.toString("base64")}`
    : null;

  // ---- no database: ephemeral character ----
  if (!db) {
    return NextResponse.json({
      characterId: null,
      sheet,
      portraitAssetId: null,
      portraitDataUrl,
    });
  }

  // ---- persist: assets -> character -> host participant ----
  const assetPlaythroughId =
    playthroughId && UUID_RE.test(playthroughId) ? playthroughId : null;

  let sourcePhotoAssetId: string | null = null;
  if (photo) {
    const [row] = await db
      .insert(assets)
      .values({
        kind: "photo",
        playthroughId: assetPlaythroughId,
        mime: photo.mime,
        bytes: photo.data,
      })
      .returning({ id: assets.id });
    sourcePhotoAssetId = row.id;
  }

  let portraitAssetId: string | null = null;
  if (portrait) {
    const [row] = await db
      .insert(assets)
      .values({
        kind: "portrait",
        playthroughId: assetPlaythroughId,
        mime: portrait.mime,
        bytes: portrait.data,
      })
      .returning({ id: assets.id });
    portraitAssetId = row.id;
  }

  const player = await getOrCreatePlayer(deviceKey, name);

  const [character] = await db
    .insert(characters)
    .values({
      playerId: player.id,
      name,
      sheet,
      portraitAssetId,
      sourcePhotoAssetId,
    })
    .returning({ id: characters.id });

  if (assetPlaythroughId) {
    await db
      .update(participants)
      .set({ characterId: character.id })
      .where(
        and(
          eq(participants.playthroughId, assetPlaythroughId),
          eq(participants.playerId, player.id),
        ),
      );
  }

  return NextResponse.json({
    characterId: character.id,
    sheet,
    portraitAssetId,
    portraitDataUrl,
  });
}
