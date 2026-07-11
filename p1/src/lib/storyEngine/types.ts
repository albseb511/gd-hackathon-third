// Shared vocabulary for the whole game: outline schema, state, game events.
// Server (routes, sim) and client (GameStage, LiveSessionProvider) both import from here.

export type QteType = "mash" | "timed" | "sequence";

// TTS prebuilt voices reserved for CHARACTERS (distinct-sounding, never the
// narrator). Each cast member gets one; dialogue lines are synthesized with it.
export const CHARACTER_VOICE_POOL = [
  "Puck", // upbeat male
  "Kore", // firm female
  "Aoede", // breezy female
  "Leda", // youthful precise female
  "Zephyr", // bright female
  "Enceladus", // breathy gravel male
  "Iapetus", // clear male
  "Umbriel", // easy-going male
  "Algieba", // smooth male
  "Despina", // smooth female
  "Erinome", // clear female
  "Gacrux", // mature female
  "Alnilam", // firm male
  "Schedar", // even male
  "Achird", // friendly male
  "Sulafat", // warm female
] as const;
export type CharacterVoiceName = (typeof CHARACTER_VOICE_POOL)[number];

// Live-API narrator voices (see liveConfig.voiceForGenre) — excluded from the
// character pool so no NPC ever sounds like the narrator.
export const NARRATOR_VOICES = ["Charon", "Fenrir", "Orus"] as const;
export type Stat = "might" | "wit" | "charm";
export type Mood =
  | "intro"
  | "explore"
  | "calm"
  | "tense"
  | "combat"
  | "tragic"
  | "triumphant"
  | "item_closeup";

export interface OutlineBeat {
  id: string;
  summary: string;
  sceneHint: string;
  choiceHints: string[];
  qte?: { type: QteType; stakes: string; winBeat: string; loseBeat: string };
  leadsTo: string[];
}

export interface OutlineAct {
  id: string;
  goal: string;
  beats: OutlineBeat[];
}

export interface OutlineCharacter {
  name: string;
  role: string;
  visualDescription: string;
  // how this character SOUNDS — the narrator performs them with this voice,
  // consistently, every time they speak
  voiceStyle?: string;
  // TTS prebuilt voice (from CHARACTER_VOICE_POOL) used to synthesize this
  // character's dialogue lines via speak_as
  voiceName?: string;
}

export interface StoryOutline {
  title: string;
  genre: string;
  artStyle: string;
  logline: string;
  characters: OutlineCharacter[];
  acts: OutlineAct[];
  endings: { id: string; tone: string; condition: string }[];
}

export interface Relationship {
  score: number; // -5..5
  feeling: string;
  lastCause: string;
}

export interface CharacterSheet {
  name: string;
  visualTokens: string;
  personalityHints: string;
  voiceStyle?: string; // how the player character sounds when quoted
  voiceName?: string; // TTS prebuilt voice (CHARACTER_VOICE_POOL) for quoted lines
  stats: { might: number; wit: number; charm: number }; // 1..5
}

export interface PlayState {
  beatId: string;
  path: string[]; // ordered beat ids visited
  flags: Record<string, boolean | string | number>;
  hp: number; // 0..10
  inventory: { name: string; note?: string; assetId?: string }[];
  relationships: Record<string, Relationship>;
  aura: { traits: string[]; reputation: string };
  // beatId → pre-generated scene asset (prewarmed at character creation)
  sceneCache?: Record<string, string>;
}

export const initialPlayState = (firstBeatId: string): PlayState => ({
  beatId: firstBeatId,
  path: [firstBeatId],
  flags: {},
  hp: 10,
  inventory: [],
  relationships: {},
  aura: { traits: [], reputation: "unknown" },
});

// ---- Game events: everything the orchestrator emits, serializable so it can
// be persisted per beat and later fanned out over SSE for multiplayer.

export type GameEvent =
  | { type: "scene"; imagePrompt: string; summary: string; mood: Mood; shot: "new" | "edit" }
  | { type: "choices"; options: string[]; beatId: string }
  | { type: "qte"; qteType: QteType; difficulty: number; prompt: string; winSummary: string; loseSummary: string }
  | { type: "dice"; stat: Stat; difficulty: number; advantage: boolean; successSummary: string; failSummary: string }
  | { type: "ui"; kind: string; context: string }
  | { type: "state"; patch: Partial<PlayState> & Record<string, unknown> }
  | { type: "ending"; endingId: string; epilogue: string }
  | { type: "narration"; text: string };

export interface DecisionVote {
  playerId: string;
  option: string; // one of the presented options, or free text
}
