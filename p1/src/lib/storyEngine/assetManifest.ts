// World Forge manifest — expands a story outline + protagonist into the full
// job list the forge runner paints: every beat scene, the world's locations
// and props, protagonist pose variants, title/ending cards, and NPC portraits.
// Scenes/poses/cards/npcs are derived deterministically (no model call);
// locations + props come from ONE fast structured 3.5-flash extraction.

import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import type { CharacterSheet, StoryOutline } from "./types";

export type JobAspect = "16:9" | "9:16" | "3:4" | "1:1";
export type JobKind = "scene" | "item" | "portrait" | "ui";

export interface Job {
  key: string;
  label: string;
  prompt: string;
  withProtagonist?: boolean;
  aspect: JobAspect;
  kind: JobKind;
}

export interface AssetManifest {
  scenes: Job[];
  locations: Job[];
  props: Job[];
  poses: Job[];
  cards: Job[];
  npcs: Job[];
}

// ---- scenes: straight from the outline beats (zero model calls) -------------

const COMPOSITIONS = [
  "wide establishing shot",
  "medium two-shot",
  "close dramatic shot",
] as const;

const PLAYER_RE = /\byou\b|\byour\b|protagonist/i;

const truncate = (s: string, max = 64) =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

function sceneJobs(outline: StoryOutline, aspect: JobAspect): Job[] {
  const beats = outline.acts.flatMap((a) => a.beats);
  return beats.map((beat, i) => ({
    key: beat.id,
    label: truncate(beat.summary),
    prompt: `${beat.sceneHint}, ${COMPOSITIONS[i % COMPOSITIONS.length]}`,
    withProtagonist: PLAYER_RE.test(beat.sceneHint),
    aspect,
    kind: "scene" as const,
  }));
}

// ---- locations + props: one structured extraction call ----------------------

const worldZ = z.object({
  locations: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1), place: z.string().min(1) }))
    .min(1),
  props: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1), item: z.string().min(1) }))
    .min(1),
});

const worldG: Schema = {
  type: Type.OBJECT,
  properties: {
    locations: {
      type: Type.ARRAY,
      description: "5-8 unique places the story visits — aim for 8.",
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING, description: "short unique slug, e.g. 'engine_room'" },
          label: { type: Type.STRING, description: "human-readable place name" },
          place: {
            type: Type.STRING,
            description:
              "image-model-ready description of the place: architecture, lighting, atmosphere. No people.",
          },
        },
        required: ["key", "label", "place"],
      },
    },
    props: {
      type: Type.ARRAY,
      description: "10-15 key story items/objects — aim for 15.",
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING, description: "short unique slug, e.g. 'ignition_key'" },
          label: { type: Type.STRING, description: "human-readable item name" },
          item: {
            type: Type.STRING,
            description: "image-model-ready description of the single object: material, wear, detail.",
          },
        },
        required: ["key", "label", "item"],
      },
    },
  },
  required: ["locations", "props"],
  propertyOrdering: ["locations", "props"],
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "asset";

function dedupeKeys(jobs: Job[]): Job[] {
  const seen = new Set<string>();
  return jobs.map((j) => {
    let key = j.key;
    let n = 2;
    while (seen.has(key)) key = `${j.key}_${n++}`;
    seen.add(key);
    return { ...j, key };
  });
}

async function extractWorld(
  outline: StoryOutline,
): Promise<{ locations: Job[]; props: Job[] }> {
  const beats = outline.acts.flatMap((a) => a.beats);
  const prompt = `You are the world-builder for a visual novel. Extract the world's LOCATIONS and PROPS from this story outline so an asset pipeline can pre-paint them.

STORY: ${outline.title} (${outline.genre}) — ${outline.logline}

BEATS:
${beats.map((b) => `- [${b.id}] ${b.summary} | scene: ${b.sceneHint}`).join("\n")}

Requirements:
- locations: 5-8 UNIQUE places across the whole outline (aim for 8). No duplicates, no people in the descriptions.
- props: 10-15 key items/objects that matter to the plot (aim for 15) — weapons, tools, documents, keepsakes, machines.
- keys: short lowercase slugs, all unique.
Return JSON only, matching the response schema.`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await withTiming("forge-manifest", { model: MODELS.text, attempt }, () =>
        genai().models.generateContent({
          model: MODELS.text,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: worldG,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      );
      const text = res.text;
      if (!text) throw new Error("forge-manifest: empty model response");
      const world = worldZ.parse(JSON.parse(text));

      const locations = dedupeKeys(
        world.locations.slice(0, 8).map((l) => ({
          key: slug(l.key),
          label: l.label,
          prompt: `establishing shot of ${l.place}, NO people, cinematic`,
          aspect: "16:9" as const,
          kind: "scene" as const,
        })),
      );
      const props = dedupeKeys(
        world.props.slice(0, 15).map((p) => ({
          key: slug(p.key),
          label: p.label,
          prompt: `dramatic close-up of ${p.item} on dark surface, single object`,
          aspect: "1:1" as const,
          kind: "item" as const,
        })),
      );
      return { locations, props };
    } catch (err) {
      lastErr = err;
      console.warn(`[forge-manifest] attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
    }
  }
  // degrade rather than sink the whole forge: the other groups still paint
  console.warn("[forge-manifest] giving up on locations/props:", lastErr);
  return { locations: [], props: [] };
}

// ---- poses: protagonist variants from the character sheet -------------------

function poseJobs(character: CharacterSheet): Job[] {
  const who = `${character.name}: ${character.visualTokens}`;
  const defs: [string, string][] = [
    [
      "pose_fullbody",
      `full-body character sheet shot of ${who}, standing relaxed, head to toe visible, plain dark background`,
    ],
    [
      "pose_action",
      `dynamic action pose of ${who}, mid-motion, lunging into danger, dramatic rim lighting, plain dark background`,
    ],
    [
      "pose_injured",
      `${who}, wounded and battered, torn clothing, clutching their side, exhausted stance, plain dark background`,
    ],
    [
      "pose_triumphant",
      `${who}, triumphant victory pose, head high, dramatic hero lighting from below, plain dark background`,
    ],
  ];
  return defs.map(([key, prompt]) => ({
    key,
    label: `${character.name} — ${key.replace("pose_", "")}`,
    prompt,
    withProtagonist: true,
    aspect: "3:4" as const,
    kind: "portrait" as const,
  }));
}

// ---- cards: title card + one per ending -------------------------------------

function cardJobs(outline: StoryOutline): Job[] {
  const title: Job = {
    key: "title",
    label: `Title card — ${outline.title}`,
    prompt: `ornate title card: the exact text "${outline.title}" painted large and legible, high-fidelity typography, atmospheric backdrop`,
    aspect: "16:9",
    kind: "ui",
  };
  const endings: Job[] = outline.endings.map((ending) => ({
    key: ending.id,
    label: `Ending card — ${ending.tone}`,
    prompt: `${ending.tone} ending card for the story "${outline.title}": the exact text "${outline.title}" painted small and legible, ${ending.tone} atmosphere filling the frame, evocative ${outline.genre} imagery; NO other text`,
    aspect: "16:9",
    kind: "ui",
  }));
  return [title, ...endings];
}

// ---- npcs: one portrait per cast member --------------------------------------

function npcJobs(outline: StoryOutline): Job[] {
  return outline.characters.map((npc) => ({
    key: npc.name,
    label: `${npc.name} — ${npc.role}`,
    prompt: `Character portrait of ${npc.name}: ${npc.visualDescription}. Waist-up, dramatic lighting, plain dark background.`,
    aspect: "3:4" as const,
    kind: "portrait" as const,
  }));
}

// ---- entry point --------------------------------------------------------------

export async function generateAssetManifest(
  outline: StoryOutline,
  character: CharacterSheet,
  sceneAspect: "16:9" | "9:16" = "16:9",
): Promise<AssetManifest> {
  const { locations, props } = await extractWorld(outline);
  return {
    scenes: sceneJobs(outline, sceneAspect),
    locations,
    props,
    poses: poseJobs(character),
    cards: cardJobs(outline),
    npcs: npcJobs(outline),
  };
}
