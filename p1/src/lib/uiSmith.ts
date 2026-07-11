// UI-Smith — generative UI for the game layer. Two products:
//  1. generateUiSpec: structured JSON specs (stat block, inventory, map…)
//     rendered natively by <UIRenderer/>. Fast path: thinking off, tight
//     per-kind response schema.
//  2. generateArtifactHtml: a one-shot, self-contained diegetic HTML artifact
//     (wanted poster, letter, terminal…) rendered in a sandboxed iframe.

import { Type, type Schema } from "@google/genai";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import type { PlayState } from "@/lib/storyEngine/types";

export {
  uiSpecSchema,
  UI_SPEC_KINDS,
  type UiSpec,
  type UiSpecKind,
} from "./uiSpec";
import { uiSpecSchema, type UiSpec, type UiSpecKind } from "./uiSpec";

// ---- Google structured-output schemas (one tight schema per kind) -----------
// The `kind` discriminator is injected server-side after parsing, so the
// model only fills in the payload fields.

const pipValue: Schema = {
  type: Type.INTEGER,
  description: "0-5 (rendered as five pips).",
};

const GOOGLE_SCHEMAS: Record<UiSpecKind, Schema> = {
  stat_block: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Short diegetic panel title." },
      stats: {
        type: Type.ARRAY,
        description: "3-6 stats.",
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING, description: "1-2 words." },
            value: pipValue,
          },
          required: ["label", "value"],
        },
      },
      traits: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "2-5 short character traits.",
      },
      reputation: {
        type: Type.STRING,
        nullable: true,
        description: "One evocative reputation line, or null.",
      },
    },
    required: ["title", "stats", "traits"],
    propertyOrdering: ["title", "stats", "traits", "reputation"],
  },
  inventory_grid: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            note: {
              type: Type.STRING,
              nullable: true,
              description: "One short evocative sentence, or null.",
            },
            iconHint: {
              type: Type.STRING,
              description: "1-3 words describing the item visually.",
            },
          },
          required: ["name", "iconHint"],
        },
      },
    },
    required: ["title", "items"],
    propertyOrdering: ["title", "items"],
  },
  dialogue_card: {
    type: Type.OBJECT,
    properties: {
      speaker: { type: Type.STRING },
      portraitHint: {
        type: Type.STRING,
        nullable: true,
        description: "Short visual description of the speaker, or null.",
      },
      lines: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "1-4 lines of dialogue, in the speaker's voice.",
      },
    },
    required: ["speaker", "lines"],
    propertyOrdering: ["speaker", "portraitHint", "lines"],
  },
  journal: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      entries: {
        type: Type.ARRAY,
        description: "1-5 entries, most recent last.",
        items: {
          type: Type.OBJECT,
          properties: {
            heading: { type: Type.STRING },
            body: { type: Type.STRING, description: "1-3 sentences." },
          },
          required: ["heading", "body"],
        },
      },
    },
    required: ["title", "entries"],
    propertyOrdering: ["title", "entries"],
  },
  map: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      places: {
        type: Type.ARRAY,
        description:
          "Ordered waypoints of the journey so far and ahead (a stylized route, not geography).",
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            note: { type: Type.STRING, nullable: true },
            visited: { type: Type.BOOLEAN },
            current: {
              type: Type.BOOLEAN,
              description: "True for exactly one place.",
            },
          },
          required: ["name", "visited", "current"],
        },
      },
    },
    required: ["title", "places"],
    propertyOrdering: ["title", "places"],
  },
  shop: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      currency: { type: Type.STRING, description: "e.g. 'crowns', 'credits'." },
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            price: { type: Type.NUMBER },
            note: { type: Type.STRING, nullable: true },
          },
          required: ["name", "price"],
        },
      },
    },
    required: ["title", "currency", "items"],
    propertyOrdering: ["title", "currency", "items"],
  },
};

// ---- spec generation ---------------------------------------------------------

function compactState(state: PlayState): string {
  // Only the parts the UI-smith can meaningfully surface.
  return JSON.stringify({
    hp: state.hp,
    inventory: state.inventory.map((i) => ({ name: i.name, note: i.note })),
    relationships: state.relationships,
    aura: state.aura,
    flags: state.flags,
    visited: state.path,
  });
}

function buildSpecPrompt(
  kind: UiSpecKind,
  context: string,
  state: PlayState | null,
): string {
  return `You are the UI-smith for VOICEBOUND, a dark cinematic voice-driven visual novel. The narrator has requested a "${kind}" panel to show the player right now.

CONTEXT (what the panel is about): ${context}

CURRENT GAME STATE: ${state ? compactState(state) : "(not available — rely on the context alone)"}

Rules:
- Stay diegetic and in-world. Titles and labels are 1-3 words; notes are one short, evocative sentence.
- Ground every fact in the context and game state. Invent flavor, never facts that contradict them.
- Stat/pip values are integers 0-5.
- Return JSON only, matching the response schema exactly.`;
}

/**
 * Generate a structured UI spec for one panel kind. Throws on empty/invalid
 * model output — callers own the retry policy.
 */
export async function generateUiSpec(
  kind: UiSpecKind,
  context: string,
  state: PlayState | null,
): Promise<UiSpec> {
  const responseSchema = GOOGLE_SCHEMAS[kind];
  if (!responseSchema) throw new Error(`uiSmith: unknown kind "${kind}"`);

  const res = await withTiming("ui-spec", { model: MODELS.text, kind }, () =>
    genai().models.generateContent({
      model: MODELS.text,
      contents: buildSpecPrompt(kind, context, state),
      config: {
        responseMimeType: "application/json",
        responseSchema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  );

  const text = res.text;
  if (!text) throw new Error("uiSmith: empty model response");
  return uiSpecSchema.parse({ ...JSON.parse(text), kind });
}

// ---- diegetic HTML artifacts ---------------------------------------------------

function buildArtifactPrompt(context: string): string {
  return `You are a master prop designer for a dark cinematic visual novel. Produce ONE complete, self-contained HTML document for a diegetic story artifact (e.g. a wanted poster, a handwritten letter, a ship terminal screen, a newspaper front page) described here:

ARTIFACT: ${context}

Hard requirements:
- A single <html> document. ALL styling inline in one <style> block in <head>. NO <script> tags, NO external resources (no fonts, no images, no imports) — the document renders in a sandboxed iframe with scripts disabled.
- Use only CSS (gradients, borders, box-shadows, transforms, blend modes, unicode glyphs) to build texture: aged parchment, ink bleed, scanline phosphor, letterpress — whatever fits the artifact.
- Palette: dark, moody, cinematic. Parchment tones (#f2e8d5, #d9b36c) on near-black, or green/amber phosphor on black for terminals. It must look startlingly good — museum-prop quality, not a wireframe.
- Typography: serif stacks (Georgia, 'Times New Roman') for paper, monospace for terminals. Dramatic scale contrast between headline and body.
- The artifact must read as an in-world object: seals, stamps, smudges, torn edges, reference numbers — sell the fiction.
- Body sized to fit a portrait card roughly 640px wide; center it; background outside the artifact transparent or near-black.

Return ONLY the raw HTML document. No markdown fences, no commentary.`;
}

/**
 * Generate a self-contained diegetic HTML artifact. Thinking stays at the
 * model default — visual quality beats latency here.
 */
export async function generateArtifactHtml(context: string): Promise<string> {
  const res = await withTiming("artifact-html", { model: MODELS.text }, () =>
    genai().models.generateContent({
      model: MODELS.text,
      contents: buildArtifactPrompt(context),
    }),
  );

  let html = (res.text ?? "").trim();
  // Strip markdown fences if the model wrapped the document anyway.
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  if (!html || !html.includes("<")) {
    throw new Error("uiSmith: artifact response contained no HTML");
  }
  return html;
}
