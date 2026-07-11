import { Type } from "@google/genai";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import { CharacterSheet, PlayState, StoryOutline } from "./types";
import { NarratorPatch } from "./applyPatch";

// Director agent: one cheap structured call per completed narrator turn.
// Three jobs at once (piggybacked so the player path pays zero latency):
//  1. continuity guard  — narration vs story bible + state (reactive)
//  2. missed-tool fill  — a scene turn with no render_scene / choices
//  3. social read       — relationship & aura deltas from what the player said
export interface DirectorInput {
  turnText: string;
  playerText?: string;
  state: PlayState;
  outline: StoryOutline;
  characters: CharacterSheet[];
  hadRenderScene: boolean;
  hadChoices: boolean;
  hadSpeakAs?: boolean;
}

export interface DirectorVerdict {
  continuityIssue: string | null; // instruction for the narrator, or null
  missedScene: { imagePrompt: string; mood: string } | null;
  missedChoices: string[] | null;
  socialPatch: NarratorPatch | null;
  spokeSuggestions: boolean; // narrator voiced the player's options aloud
  trueMood: string | null; // emotional beat of the turn, drives the score
  missedDialogue: string | null; // NPCs present but silent — their names, or null
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    continuityIssue: {
      type: Type.STRING,
      description:
        "ONLY if the narration clearly contradicts established state/bible (dead NPC speaking, item never owned, wrong location, invented major lore): a one-line correction instruction for the narrator. Otherwise empty string.",
    },
    sceneMissing: { type: Type.BOOLEAN },
    imagePrompt: {
      type: Type.STRING,
      description:
        "If sceneMissing: a vivid visual description of the scene that was narrated (location, characters, action, lighting). Else empty.",
    },
    mood: {
      type: Type.STRING,
      enum: ["intro", "explore", "calm", "tense", "combat", "tragic", "triumphant"],
    },
    choicesMissing: { type: Type.BOOLEAN },
    choices: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "If choicesMissing and the turn clearly ended on a decision point: 2-4 options under 8 words. Else empty.",
    },
    relationshipDeltas: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          npc: { type: Type.STRING },
          score: { type: Type.NUMBER, description: "new score -5..5" },
          feeling: { type: Type.STRING },
          lastCause: { type: Type.STRING },
        },
        required: ["npc", "score", "feeling", "lastCause"],
      },
      description:
        "Only when the player's words/manner would genuinely shift how an NPC present in the scene feels. Usually empty.",
    },
    auraTraitsAdd: { type: Type.ARRAY, items: { type: Type.STRING } },
    spokeSuggestions: {
      type: Type.BOOLEAN,
      description:
        "true if the narrator voiced the player's possible actions aloud (listed options, 'you could X or Y', 'do you A or B?'). Ending on tension without naming actions is fine.",
    },
    trueMood: {
      type: Type.STRING,
      enum: ["intro", "explore", "calm", "tense", "combat", "tragic", "triumphant"],
      description: "The dominant emotional beat of this turn.",
    },
    silentCharacters: {
      type: Type.STRING,
      description:
        "If named characters were clearly PRESENT in the scene but not one spoken dialogue line was delivered this turn: their names, comma-separated. Else empty string.",
    },
  },
  required: ["continuityIssue", "sceneMissing", "choicesMissing", "spokeSuggestions", "trueMood", "silentCharacters"],
} as const;

export async function runDirector(input: DirectorInput): Promise<DirectorVerdict> {
  const { turnText, playerText, state, outline, characters, hadRenderScene, hadChoices } =
    input;

  const prompt = `You supervise a live voice narrator running an interactive story. Review ONE completed narrator turn.

STORY BIBLE (outline): ${JSON.stringify({
    title: outline.title,
    characters: outline.characters,
    currentActGoals: outline.acts.map((a) => ({ id: a.id, goal: a.goal })),
    endings: outline.endings.map((e) => e.id),
  })}
PLAYER CHARACTERS: ${JSON.stringify(characters.map((c) => ({ name: c.name, personality: c.personalityHints })))}
CURRENT STATE (single source of truth — narration must never contradict it): ${JSON.stringify(
    {
      beatId: state.beatId,
      hp: state.hp,
      flags: state.flags,
      inventory: state.inventory.map((i) => i.name),
      relationships: state.relationships,
      aura: state.aura,
    },
  )}

${playerText ? `WHAT THE PLAYER JUST SAID: "${playerText}"` : ""}
NARRATOR'S TURN (transcript): "${turnText}"

Tool usage this turn: render_scene called: ${hadRenderScene}; present_choices called: ${hadChoices}.

Judge:
1. continuityIssue — be conservative; flag ONLY clear contradictions with state/bible, not stylistic drift or plausible improvisation.
2. sceneMissing — true only if the turn narrated a visually NEW scene/location/major action AND render_scene was not called.
3. choicesMissing — true only if the turn clearly ended by offering the player distinct options AND present_choices was not called.
4. relationshipDeltas / auraTraitsAdd — from the PLAYER's words and manner toward NPCs in the scene, when clearly warranted. Rude or warm behavior shifts scores by 1, betrayals/heroics by 2. Usually empty.
5. spokeSuggestions — true if the narrator named actions the player could take ("do you X or Y", "you could...", listed options aloud). The on-screen buttons carry options; the narrator must never voice them.
6. trueMood — the dominant emotional beat of the turn (drives the musical score).
7. silentCharacters — dialogue was ${input.hadSpeakAs ? "" : "NOT "}delivered via the dialogue system this turn. If named characters were present in the scene but stayed silent, list their names — every scene should breathe through dialogue.`;

  const res = await withTiming("director", { model: MODELS.text }, () =>
    genai().models.generateContent({
      model: MODELS.text,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  );

  let parsed: {
    continuityIssue?: string;
    sceneMissing?: boolean;
    imagePrompt?: string;
    mood?: string;
    choicesMissing?: boolean;
    choices?: string[];
    relationshipDeltas?: { npc: string; score: number; feeling: string; lastCause: string }[];
    auraTraitsAdd?: string[];
    spokeSuggestions?: boolean;
    trueMood?: string;
    silentCharacters?: string;
  };
  try {
    parsed = JSON.parse(res.text ?? "{}");
  } catch {
    parsed = {};
  }

  const relationships: NarratorPatch["relationships"] = {};
  for (const d of parsed.relationshipDeltas ?? []) {
    relationships[d.npc] = {
      score: d.score,
      feeling: d.feeling,
      lastCause: d.lastCause,
    };
  }
  const hasSocial =
    Object.keys(relationships).length > 0 || (parsed.auraTraitsAdd?.length ?? 0) > 0;

  return {
    continuityIssue: parsed.continuityIssue?.trim() || null,
    missedScene:
      parsed.sceneMissing && parsed.imagePrompt
        ? { imagePrompt: parsed.imagePrompt, mood: parsed.mood ?? "explore" }
        : null,
    missedChoices:
      parsed.choicesMissing && parsed.choices?.length ? parsed.choices : null,
    socialPatch: hasSocial
      ? { relationships, auraTraitsAdd: parsed.auraTraitsAdd }
      : null,
    spokeSuggestions: Boolean(parsed.spokeSuggestions),
    trueMood: parsed.trueMood ?? null,
    missedDialogue:
      !input.hadSpeakAs && parsed.silentCharacters?.trim()
        ? parsed.silentCharacters.trim()
        : null,
  };
}
