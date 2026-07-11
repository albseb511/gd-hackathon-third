import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { playthroughs, scenes } from "@/db/schema";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import { PlayState } from "./types";

// Archivist: compresses history so cold resumes rebuild the narrator's
// memory from (summary + last scenes + state) instead of a full transcript.
export async function refreshSummary(playthroughId: string): Promise<void> {
  if (!db) return;
  const [pt] = await db
    .select()
    .from(playthroughs)
    .where(eq(playthroughs.id, playthroughId));
  if (!pt) return;

  const recent = await db
    .select({ narration: scenes.narration, chosen: scenes.chosen, idx: scenes.idx })
    .from(scenes)
    .where(eq(scenes.playthroughId, playthroughId))
    .orderBy(desc(scenes.idx))
    .limit(4);

  const material = recent
    .reverse()
    .filter((s) => s.narration)
    .map((s) => `Scene ${s.idx}: ${s.narration}${s.chosen ? ` (player chose: ${s.chosen})` : ""}`)
    .join("\n");
  if (!material) return;

  const state = pt.state as PlayState;
  const prompt = `You maintain the running memory of an interactive story.
Previous summary (may be empty):
${pt.summary ?? "(none)"}

New scenes since then:
${material}

Current state: ${JSON.stringify({ hp: state?.hp, flags: state?.flags, relationships: state?.relationships, inventory: state?.inventory?.map((i) => i.name) })}

Write the NEW summary: ~150 words, second person ("you..."), chronological, keep every open thread, promise, injury, relationship shift and unresolved mystery. Facts only, no style flourishes.`;

  const res = await withTiming(
    "summarize",
    { model: MODELS.text, playthroughId },
    () =>
      genai().models.generateContent({
        model: MODELS.text,
        contents: prompt,
        config: { thinkingConfig: { thinkingBudget: 0 } },
      }),
  );
  const summary = res.text?.trim();
  if (summary) {
    await db
      .update(playthroughs)
      .set({ summary })
      .where(eq(playthroughs.id, playthroughId));
  }
}
