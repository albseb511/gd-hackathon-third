// Outline generation: premise -> StoryOutline via Gemini structured output,
// validated with zod. Used by the prebuilt-story script and the create-story flow.

import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import type { StoryOutline } from "./types";

// Locked base art style. Every generated outline's artStyle must start with
// this exact string; the generator may append a short per-story palette phrase.
export const BASE_ART_STYLE =
  "hand-painted graphic novel realism — realistic proportions and lighting rendered in flat painterly cel-shaded panels, bold shadows, muted cinematic palette";

// ---- zod schema (mirrors StoryOutline in types.ts exactly) -------------------

const qteZ = z.object({
  type: z.enum(["mash", "timed", "sequence"]),
  stakes: z.string().min(1),
  winBeat: z.string().min(1),
  loseBeat: z.string().min(1),
});

interface SchemaKnobs {
  minBeats: number;
  maxBeats: number;
  minChars: number;
  maxChars: number;
  minChoiceHints: number;
  minQteBeats: number;
  minBranchingBeats: number; // beats whose leadsTo has >= 2 targets
}

const STRICT: SchemaKnobs = {
  minBeats: 4,
  maxBeats: 6,
  minChars: 3,
  maxChars: 5,
  minChoiceHints: 2,
  minQteBeats: 2,
  minBranchingBeats: 2,
};

const LENIENT: SchemaKnobs = {
  minBeats: 3,
  maxBeats: 8,
  minChars: 2,
  maxChars: 6,
  minChoiceHints: 1,
  minQteBeats: 1,
  minBranchingBeats: 0,
};

function makeOutlineSchema(k: SchemaKnobs) {
  const beatZ = z.object({
    id: z.string().min(1),
    summary: z.string().min(1),
    sceneHint: z.string().min(1),
    choiceHints: z.array(z.string().min(1)).min(k.minChoiceHints),
    // Gemini structured output emits `qte: null` on non-QTE beats; normalize to undefined.
    qte: qteZ
      .nullish()
      .transform((v) => v ?? undefined),
    leadsTo: z.array(z.string().min(1)).min(1),
  });

  const actZ = z.object({
    id: z.string().min(1),
    goal: z.string().min(1),
    beats: z.array(beatZ).min(k.minBeats).max(k.maxBeats),
  });

  const endingZ = z.object({
    id: z.string().min(1),
    tone: z.enum(["triumphant", "tragic", "bittersweet"]),
    condition: z.string().min(1),
  });

  return z
    .object({
      title: z.string().min(1),
      genre: z.string().min(1),
      artStyle: z.string().min(1),
      logline: z.string().min(1),
      characters: z
        .array(
          z.object({
            name: z.string().min(1),
            role: z.string().min(1),
            visualDescription: z.string().min(1),
          }),
        )
        .min(k.minChars)
        .max(k.maxChars),
      acts: z.array(actZ).length(3),
      endings: z.array(endingZ).length(3),
    })
    .superRefine((o, ctx) => {
      const beats = o.acts.flatMap((a) => a.beats);
      const qteCount = beats.filter((b) => b.qte).length;
      if (qteCount < k.minQteBeats) {
        ctx.addIssue({
          code: "custom",
          message: `expected >= ${k.minQteBeats} qte beats, got ${qteCount}`,
        });
      }
      const branching = beats.filter((b) => b.leadsTo.length >= 2).length;
      if (branching < k.minBranchingBeats) {
        ctx.addIssue({
          code: "custom",
          message: `expected >= ${k.minBranchingBeats} branching beats, got ${branching}`,
        });
      }
    });
}

export const outlineSchema = makeOutlineSchema(STRICT);
export const outlineSchemaLenient = makeOutlineSchema(LENIENT);

// ---- Google structured-output schema (hand-converted from the zod shape) -----

const qteG: Schema = {
  type: Type.OBJECT,
  nullable: true,
  description:
    "Quick-time event for this beat (fights, chases, physical peril). Null when the beat has none.",
  properties: {
    type: { type: Type.STRING, enum: ["mash", "timed", "sequence"] },
    stakes: { type: Type.STRING, description: "What winning/losing means, one sentence." },
    winBeat: { type: Type.STRING, description: "Beat or ending id reached on a win." },
    loseBeat: { type: Type.STRING, description: "Beat or ending id reached on a loss." },
  },
  required: ["type", "stakes", "winBeat", "loseBeat"],
};

const beatG: Schema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING, description: "Short unique slug, e.g. 'a1_docks'." },
    summary: { type: Type.STRING, description: "What happens in this beat, 1-2 sentences." },
    sceneHint: {
      type: Type.STRING,
      description: "Visual staging for the image model: location, who's present, lighting, action.",
    },
    choiceHints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "2-3 genuine dilemmas — two reasonable players would pick differently.",
    },
    qte: qteG,
    leadsTo: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "1-3 beat ids (or ending ids from a final-act beat) this beat can flow into.",
    },
  },
  required: ["id", "summary", "sceneHint", "choiceHints", "leadsTo"],
  propertyOrdering: ["id", "summary", "sceneHint", "choiceHints", "qte", "leadsTo"],
};

const outlineG: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    genre: { type: Type.STRING },
    artStyle: { type: Type.STRING },
    logline: { type: Type.STRING, description: "1-2 punchy sentences." },
    characters: {
      type: Type.ARRAY,
      description: "3-5 NPCs (never the player).",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING },
          visualDescription: {
            type: Type.STRING,
            description:
              "Vivid, image-model-ready: face, build, wardrobe, one unforgettable detail.",
          },
        },
        required: ["name", "role", "visualDescription"],
      },
    },
    acts: {
      type: Type.ARRAY,
      description: "Exactly 3 acts, each with 4-6 beats.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "e.g. 'act1'" },
          goal: { type: Type.STRING },
          beats: { type: Type.ARRAY, items: beatG },
        },
        required: ["id", "goal", "beats"],
      },
    },
    endings: {
      type: Type.ARRAY,
      description: "Exactly 3 endings: one triumphant, one tragic, one bittersweet.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          tone: { type: Type.STRING, enum: ["triumphant", "tragic", "bittersweet"] },
          condition: {
            type: Type.STRING,
            description:
              'Concrete condition on flags and/or relationships, e.g. \'flags.told_truth = true AND relationships.Serrano.score >= 2\'.',
          },
        },
        required: ["id", "tone", "condition"],
      },
    },
  },
  required: ["title", "genre", "artStyle", "logline", "characters", "acts", "endings"],
  propertyOrdering: ["title", "genre", "artStyle", "logline", "characters", "acts", "endings"],
};

// ---- Prompt -------------------------------------------------------------------

function buildOutlinePrompt(premise: string): string {
  return `You are the story architect for a live voice-driven interactive fiction game (Bandersnatch / As Dusk Falls style). Design a branching story outline for this premise:

PREMISE: ${premise}

Return JSON matching the response schema. Requirements:

- title, genre, and a 1-2 sentence logline with a hook.
- artStyle: MUST begin with EXACTLY this string: "${BASE_ART_STYLE}". You may append a comma and a short palette phrase drawn from the premise (e.g. ", rain-slick neon noir palette"). Nothing else.
- characters: 3-5 vivid NPCs (never the player). visualDescription must be usable directly by an image model: face, build, wardrobe, one unforgettable detail.
- acts: exactly 3 (setup / escalation / climax), each with a goal and 4-6 beats.
- Beat ids: short unique slugs like "a1_docks". Every leadsTo, winBeat, and loseBeat MUST reference an existing beat id (or an ending id, only from act-3 beats).
- BRANCHING: at least 4 beats must lead to 2-3 DIFFERENT places (leadsTo with 2-3 ids). The story must feel like a web, not a corridor.
- choiceHints: 2-3 per beat, each a genuine dilemma — two reasonable players would pick differently. Phrase as tempting, costly options (never good-choice vs dumb-choice).
- QTE: at least 2 beats (fights, chases, physical peril) must carry a qte {type: mash|timed|sequence, stakes, winBeat, loseBeat}. The loseBeat must be an INTERESTING darker branch, never a dead end.
- SKILL-CHECK DILEMMAS: at least 3 beats must center on a risky non-combat gamble (persuasion, deception, stealth, a desperate climb) suited to a d20 check against might/wit/charm — make the risk explicit in the summary.
- endings: exactly 3 — one triumphant, one tragic, one bittersweet. Each condition must reference concrete flags (e.g. "flags.saved_witness = true") and/or relationship thresholds (e.g. "relationships.Serrano.score >= 2") that the beats can plausibly set along the way.
- Keep prose tight, sensory, evocative. No markdown, no commentary — JSON only.`;
}

// ---- Generation -----------------------------------------------------------------

function requestConfig() {
  return {
    responseMimeType: "application/json",
    responseSchema: outlineG,
    // thinking stays at the model default (enabled) — outline quality > latency here.
  };
}

export async function generateOutline(
  premise: string,
  opts?: { lenient?: boolean },
): Promise<StoryOutline> {
  const schema = opts?.lenient ? outlineSchemaLenient : outlineSchema;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await withTiming("outline", { model: MODELS.text, attempt }, () =>
        genai().models.generateContent({
          model: MODELS.text,
          contents: buildOutlinePrompt(premise),
          config: requestConfig(),
        }),
      );
      const text = res.text;
      if (!text) throw new Error("outline: empty model response");

      const outline: StoryOutline = schema.parse(JSON.parse(text));

      // artStyle is locked: keep the base, tolerate an appended palette phrase.
      if (!outline.artStyle.startsWith(BASE_ART_STYLE)) {
        outline.artStyle = `${BASE_ART_STYLE}, ${outline.artStyle}`;
      }
      return outline;
    } catch (err) {
      lastError = err;
      console.warn(`[outline] attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`outline: generation failed twice: ${String(lastError)}`);
}

// Raw text-chunk stream for the SSE create-story route. The caller is
// responsible for accumulating, parsing, and validating the final JSON.
export async function* generateOutlineStream(
  premise: string,
): AsyncGenerator<string, void, unknown> {
  const stream = await withTiming("outline_stream_start", { model: MODELS.text }, () =>
    genai().models.generateContentStream({
      model: MODELS.text,
      contents: buildOutlinePrompt(premise),
      config: requestConfig(),
    }),
  );
  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}
