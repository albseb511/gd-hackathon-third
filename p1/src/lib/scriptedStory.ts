// Scripted-playback contract: the 3 prebuilt stories are pre-rendered to
// audio once (narration + character dialogue) and played back deterministically
// at runtime — zero live cost, instant. Custom (premise) stories stay live.

export type ScriptedSpeaker = string; // "narrator" | <character name>

export interface ScriptedLine {
  speaker: ScriptedSpeaker;
  text: string;
  audio: string; // /scripted/<story>/<beatId>-<idx>.mp3
}

export interface ScriptedChoice {
  label: string;
  next: string; // beat id or ending id
}

export interface ScriptedBeat {
  mood: string;
  isEnding?: boolean;
  endingId?: string;
  lines: ScriptedLine[];
  choices: ScriptedChoice[];
  qte?: {
    type: "mash" | "timed" | "sequence";
    difficulty: number;
    prompt: string;
    winNext: string;
    loseNext: string;
  };
}

export interface ScriptedStory {
  storyId: string;
  title: string;
  startBeat: string;
  beats: Record<string, ScriptedBeat>;
}

// The prebuilt ids that CAN get scripted playback.
export const SCRIPTED_STORY_IDS = ["noir", "fantasy", "starship"] as const;
export type ScriptedStoryId = (typeof SCRIPTED_STORY_IDS)[number];

// The prebuilt ids whose scripts are fully rendered AND enabled for scripted
// playback. Empty = every story plays LIVE (improvising narrator + live voice).
// Starship's scripted assets stay committed; add "starship" here to re-enable
// the instant/zero-cost scripted path.
export const SCRIPTED_READY_IDS = [] as const;

export function isScriptedStoryId(id: string): id is ScriptedStoryId {
  return (SCRIPTED_STORY_IDS as readonly string[]).includes(id);
}

// Ready = script + audio exist and are committed (safe to route to scripted).
export function isScriptedReady(id: string): boolean {
  return (SCRIPTED_READY_IDS as readonly string[]).includes(id);
}

// Client fetch of the static script (served from /public/scripted).
export async function loadScriptedStory(
  storyId: string,
): Promise<ScriptedStory | null> {
  if (!isScriptedStoryId(storyId)) return null;
  try {
    const res = await fetch(`/scripted/${storyId}.json`, { cache: "force-cache" });
    if (!res.ok) return null;
    return (await res.json()) as ScriptedStory;
  } catch {
    return null;
  }
}
