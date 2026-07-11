// GET /api/playthroughs/[id] — everything the play page needs to boot:
// playthrough state, story outline, the last few scenes for recap, and the
// party's character sheets. Handles `local-*` pseudo ids without a database.

import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { characters, participants, playthroughs, scenes, stories } from "@/db/schema";
import { prebuiltById } from "@/lib/prebuilt";
import {
  initialPlayState,
  type CharacterSheet,
  type StoryOutline,
} from "@/lib/storyEngine/types";
import { DEFAULT_CHARACTER } from "@/lib/player";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // ---- local pseudo-playthroughs (no db, no persistence) ----
  if (id.startsWith("local-")) {
    const key = id.slice("local-".length);
    const outline = (prebuiltById as Record<string, StoryOutline | undefined>)[key];
    if (!outline) {
      return NextResponse.json({ error: "Unknown story" }, { status: 404 });
    }
    const firstBeatId = outline.acts[0].beats[0].id;
    return NextResponse.json({
      playthrough: { id, state: initialPlayState(firstBeatId), summary: null },
      outline,
      scenes: [],
      characters: [DEFAULT_CHARACTER],
    });
  }

  if (!db || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "Playthrough not found" }, { status: 404 });
  }

  const [playthrough] = await db
    .select({
      id: playthroughs.id,
      storyId: playthroughs.storyId,
      state: playthroughs.state,
      summary: playthroughs.summary,
    })
    .from(playthroughs)
    .where(eq(playthroughs.id, id))
    .limit(1);
  if (!playthrough) {
    return NextResponse.json({ error: "Playthrough not found" }, { status: 404 });
  }

  const [story] = await db
    .select({ outline: stories.outline })
    .from(stories)
    .where(eq(stories.id, playthrough.storyId))
    .limit(1);

  // last 3 scenes, returned oldest-first for natural recap order
  const recentScenes = await db
    .select({
      idx: scenes.idx,
      narration: scenes.narration,
      imageAssetId: scenes.imageAssetId,
    })
    .from(scenes)
    .where(eq(scenes.playthroughId, id))
    .orderBy(desc(scenes.idx))
    .limit(3);
  recentScenes.reverse();

  // participants' character sheets; sheet jsonb holds everything but the name
  const charRows = await db
    .select({ name: characters.name, sheet: characters.sheet })
    .from(participants)
    .innerJoin(characters, eq(characters.id, participants.characterId))
    .where(eq(participants.playthroughId, id));

  const sheets: CharacterSheet[] = charRows.map((row) => {
    const sheet = (row.sheet ?? {}) as Partial<CharacterSheet>;
    return {
      name: row.name,
      visualTokens: sheet.visualTokens ?? DEFAULT_CHARACTER.visualTokens,
      personalityHints: sheet.personalityHints ?? DEFAULT_CHARACTER.personalityHints,
      stats: sheet.stats ?? DEFAULT_CHARACTER.stats,
    };
  });

  return NextResponse.json({
    playthrough: {
      id: playthrough.id,
      state: playthrough.state,
      summary: playthrough.summary,
    },
    outline: story?.outline ?? null,
    scenes: recentScenes,
    characters: sheets.length ? sheets : [DEFAULT_CHARACTER],
  });
}
