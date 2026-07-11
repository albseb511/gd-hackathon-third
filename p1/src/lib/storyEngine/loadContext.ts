import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { playthroughs, stories, scenes, participants, characters } from "@/db/schema";
import { prebuiltById, PrebuiltStoryId } from "@/lib/prebuilt";
import {
  CharacterSheet,
  PlayState,
  StoryOutline,
  initialPlayState,
} from "./types";

export const FALLBACK_CHARACTER: CharacterSheet = {
  name: "The Stranger",
  visualTokens:
    "a determined traveler in a long weathered coat, short dark hair, sharp eyes",
  personalityHints: "curious, guarded, dry wit",
  stats: { might: 3, wit: 3, charm: 3 },
};

export interface PlaythroughContext {
  outline: StoryOutline;
  state: PlayState;
  charactersSheets: (CharacterSheet & { portraitAssetId?: string | null })[];
  summary: string | null;
  recentScenes: { narration: string }[];
  sceneCount: number;
  persisted: boolean;
}

// Loads everything the narrator prompt / play page needs for a playthrough.
// Dual-mode: `local-<prebuiltId>` ids work with no database (no persistence).
export async function loadPlaythroughContext(
  playthroughId: string,
): Promise<PlaythroughContext | null> {
  if (playthroughId.startsWith("local-")) {
    const storyId = playthroughId.slice("local-".length) as PrebuiltStoryId;
    const outline = prebuiltById[storyId];
    if (!outline) return null;
    return {
      outline,
      state: initialPlayState(outline.acts[0].beats[0].id),
      charactersSheets: [FALLBACK_CHARACTER],
      summary: null,
      recentScenes: [],
      sceneCount: 0,
      persisted: false,
    };
  }

  if (!db) return null;
  const [pt] = await db
    .select()
    .from(playthroughs)
    .where(eq(playthroughs.id, playthroughId));
  if (!pt) return null;
  const [story] = await db.select().from(stories).where(eq(stories.id, pt.storyId));
  if (!story) return null;

  const recent = await db
    .select({ narration: scenes.narration, idx: scenes.idx })
    .from(scenes)
    .where(eq(scenes.playthroughId, playthroughId))
    .orderBy(desc(scenes.idx))
    .limit(3);

  const parts = await db
    .select({
      sheet: characters.sheet,
      name: characters.name,
      portraitAssetId: characters.portraitAssetId,
    })
    .from(participants)
    .innerJoin(characters, eq(participants.characterId, characters.id))
    .where(eq(participants.playthroughId, playthroughId));

  const outline = story.outline as StoryOutline;
  const state =
    pt.state && Object.keys(pt.state as object).length
      ? (pt.state as PlayState)
      : initialPlayState(outline.acts[0].beats[0].id);

  return {
    outline,
    state,
    charactersSheets: parts.length
      ? parts.map((p) => ({
          ...(p.sheet as CharacterSheet),
          name: p.name,
          portraitAssetId: p.portraitAssetId,
        }))
      : [FALLBACK_CHARACTER],
    summary: pt.summary,
    recentScenes: recent
      .reverse()
      .filter((s) => s.narration)
      .map((s) => ({ narration: s.narration! })),
    sceneCount: recent.length ? Math.max(...recent.map((s) => s.idx)) + 1 : 0,
    persisted: true,
  };
}
