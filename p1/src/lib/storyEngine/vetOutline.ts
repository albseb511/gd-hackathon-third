// Editorial vetting pass for story outlines.
//
// Players see choice buttons WITHOUT any narration explaining them, so every
// option must stand alone. vetOutline runs ONE structured Gemini call that
// rewrites each beat's label / summary / choiceHints / qte.stakes for clarity,
// then merges the rewrites back code-side — ids, leadsTo and all structure are
// never touched. lintOutline is the pure structural companion check.

import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import { outlineSchemaLenient } from "./outline";
import type { OutlineBeat, StoryOutline } from "./types";

// ---- Structural lint ----------------------------------------------------------

// Pure check, no model calls. Returns human-readable issue strings:
// - every leadsTo / qte.winBeat / qte.loseBeat target must be a beat id or ending id
// - every ending id must be referenced by at least one beat
// - every beat must be reachable via BFS from the first beat (leadsTo + qte targets)
export function lintOutline(outline: StoryOutline): string[] {
  const issues: string[] = [];
  const beats = outline.acts.flatMap((a) => a.beats);
  const beatIds = new Set(beats.map((b) => b.id));
  const endingIds = new Set(outline.endings.map((e) => e.id));

  const targetsOf = (b: OutlineBeat): string[] => [
    ...b.leadsTo,
    ...(b.qte ? [b.qte.winBeat, b.qte.loseBeat] : []),
  ];

  // Dangling targets.
  for (const b of beats) {
    for (const t of b.leadsTo) {
      if (!beatIds.has(t) && !endingIds.has(t)) {
        issues.push(`beat "${b.id}": leadsTo target "${t}" is not a beat or ending id`);
      }
    }
    if (b.qte) {
      for (const [field, t] of [
        ["winBeat", b.qte.winBeat],
        ["loseBeat", b.qte.loseBeat],
      ] as const) {
        if (!beatIds.has(t) && !endingIds.has(t)) {
          issues.push(`beat "${b.id}": qte.${field} target "${t}" is not a beat or ending id`);
        }
      }
    }
  }

  // Every ending referenced by at least one beat.
  const referenced = new Set(beats.flatMap(targetsOf));
  for (const e of outline.endings) {
    if (!referenced.has(e.id)) {
      issues.push(`ending "${e.id}" is never referenced by any beat`);
    }
  }

  // Reachability: BFS from the first beat over leadsTo + qte targets.
  const byId = new Map(beats.map((b) => [b.id, b]));
  const first = beats[0];
  if (first) {
    const seen = new Set<string>([first.id]);
    const queue = [first];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const t of targetsOf(cur)) {
        const next = byId.get(t);
        if (next && !seen.has(t)) {
          seen.add(t);
          queue.push(next);
        }
      }
    }
    for (const b of beats) {
      if (!seen.has(b.id)) {
        issues.push(`beat "${b.id}" is unreachable from first beat "${first.id}"`);
      }
    }
  } else {
    issues.push("outline has no beats");
  }

  return issues;
}

// ---- Vetting call ---------------------------------------------------------------

const rewriteZ = z.object({
  beatId: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1),
  choiceHints: z.array(z.string().min(1)).min(1),
  // Structured output emits null when absent; normalize to undefined.
  qteStakes: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
});
const rewritesZ = z.array(rewriteZ);
type BeatRewrite = z.infer<typeof rewriteZ>;

const rewritesG: Schema = {
  type: Type.ARRAY,
  description: "One rewrite per beat, keyed by the existing beat id. Rewrites ONLY — never new beats.",
  items: {
    type: Type.OBJECT,
    properties: {
      beatId: { type: Type.STRING, description: "The EXISTING beat id being rewritten, unchanged." },
      label: {
        type: Type.STRING,
        description: "2-4 word evocative beat title, e.g. 'The Red Bridge'",
      },
      summary: {
        type: Type.STRING,
        description:
          "ONE clear sentence a player instantly understands — who does what, what's at stake.",
      },
      choiceHints: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Every option rewritten as a concrete self-explanatory action: verb-first, names its object, <=7 words. Same number of options as the original, same underlying intent.",
      },
      qteStakes: {
        type: Type.STRING,
        nullable: true,
        description:
          "One clear sentence of what winning/losing means. Null unless the beat has a qte.",
      },
    },
    required: ["beatId", "label", "summary", "choiceHints"],
    propertyOrdering: ["beatId", "label", "summary", "choiceHints", "qteStakes"],
  },
};

function buildVetPrompt(outline: StoryOutline): string {
  const beats = outline.acts.flatMap((a) =>
    a.beats.map((b) => ({
      beatId: b.id,
      act: a.id,
      summary: b.summary,
      choiceHints: b.choiceHints,
      ...(b.qte ? { qteType: b.qte.type, qteStakes: b.qte.stakes } : {}),
    })),
  );

  return `You are the line editor for a live voice-driven interactive fiction game. Players see choice buttons WITHOUT any narration explaining them, so every option must stand ALONE.

STORY: "${outline.title}" (${outline.genre}) — ${outline.logline}

BEATS (rewrite every one):
${JSON.stringify(beats, null, 2)}

Return a JSON array with EXACTLY one rewrite per beat above, keyed by its existing beatId. Editorial contract:

- label: a 2-4 word evocative title for the beat ("The Red Bridge", "Kane's Ultimatum").
- summary: ONE clear sentence a player instantly understands — who does what, what's at stake.
- choiceHints: rewrite EVERY option as a concrete self-explanatory action: VERB-FIRST, names its object, at most 7 words, no metaphors, no ambiguity. Test: a stranger reading ONLY this option must know exactly what they're choosing. Keep the same NUMBER of options and the same underlying intent/branching meaning as the original — never add, drop, merge, or reorder options.
- qteStakes: one clear sentence of what winning and losing means — ONLY for beats that have a qte (qteType present); null otherwise.

Do NOT invent new beats, ids, or branches. No markdown, no commentary — JSON only.`;
}

// Merge rewrites into a deep copy of the outline. Only label / summary /
// choiceHints / qte.stakes are overwritten, and only on beats whose id matches.
// Ids, leadsTo, qte routing and act structure are never touched.
function mergeRewrites(outline: StoryOutline, rewrites: BeatRewrite[]): StoryOutline {
  const byId = new Map(rewrites.map((r) => [r.beatId, r]));
  const merged: StoryOutline = JSON.parse(JSON.stringify(outline));
  for (const act of merged.acts) {
    for (const beat of act.beats) {
      const r = byId.get(beat.id);
      if (!r) continue;
      beat.label = r.label;
      beat.summary = r.summary;
      if (r.choiceHints.length === beat.choiceHints.length) {
        beat.choiceHints = r.choiceHints;
      } else {
        console.warn(
          `[vetOutline] beat "${beat.id}": rewrite has ${r.choiceHints.length} choiceHints, original has ${beat.choiceHints.length} — keeping originals`,
        );
      }
      if (beat.qte && r.qteStakes) beat.qte.stakes = r.qteStakes;
    }
  }
  return merged;
}

// ONE structured Gemini call (thinking stays at the model default — quality
// matters and this is off the critical path). Never throws structure away:
// any failure returns the original outline untouched.
export async function vetOutline(outline: StoryOutline): Promise<StoryOutline> {
  const lintBefore = lintOutline(outline);
  console.log(
    `[vetOutline] lint before: ${lintBefore.length ? lintBefore.join("; ") : "clean"}`,
  );

  try {
    const res = await withTiming("outline_vet", { model: MODELS.text }, () =>
      genai().models.generateContent({
        model: MODELS.text,
        contents: buildVetPrompt(outline),
        config: {
          responseMimeType: "application/json",
          responseSchema: rewritesG,
          // thinking stays at the model default (enabled) — editorial quality > latency.
        },
      }),
    );
    const text = res.text;
    if (!text) throw new Error("vetOutline: empty model response");

    const rewrites = rewritesZ.parse(JSON.parse(text));
    const merged = mergeRewrites(outline, rewrites);

    const lintAfter = lintOutline(merged);
    console.log(
      `[vetOutline] lint after: ${lintAfter.length ? lintAfter.join("; ") : "clean"}`,
    );

    outlineSchemaLenient.parse(merged);
    return merged;
  } catch (err) {
    console.warn(
      "[vetOutline] vet pass failed, returning original outline:",
      err instanceof Error ? err.message : err,
    );
    return outline;
  }
}
