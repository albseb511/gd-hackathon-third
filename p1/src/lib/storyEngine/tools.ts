import { Behavior, FunctionDeclaration, Type } from "@google/genai";

// Function declarations for the Narrator (Live session). The client executes
// these and reports back; NON_BLOCKING lets narration continue while we render.

export const TOOL_NAMES = {
  renderScene: "render_scene",
  presentChoices: "present_choices",
  startQte: "start_qte",
  skillCheck: "skill_check",
  showUi: "show_ui",
  updateState: "update_state",
  endStory: "end_story",
} as const;

export const narratorTools: FunctionDeclaration[] = [
  {
    name: TOOL_NAMES.renderScene,
    behavior: Behavior.NON_BLOCKING,
    description:
      "Render the visual for the scene you are about to narrate. MUST be called before narrating any new scene or any significant visual change.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        image_prompt: {
          type: Type.STRING,
          description:
            "Vivid visual description of the scene: location, characters present, action, lighting. No style words — style is applied by the pipeline.",
        },
        scene_summary: {
          type: Type.STRING,
          description: "One-sentence summary of what happens in this scene.",
        },
        mood: {
          type: Type.STRING,
          enum: ["intro", "explore", "calm", "tense", "combat", "tragic", "triumphant", "item_closeup"],
        },
        shot: {
          type: Type.STRING,
          enum: ["new", "edit"],
          description:
            "'edit' when the moment continues in the SAME location as the previous image (a door opens, someone reacts) — describe only what changed. 'new' for a new location or time jump.",
        },
        beat_id: { type: Type.STRING, description: "Outline beat id this scene belongs to." },
      },
      required: ["image_prompt", "scene_summary", "mood", "shot"],
    },
  },
  {
    name: TOOL_NAMES.presentChoices,
    behavior: Behavior.NON_BLOCKING,
    description:
      "Show 2-4 tappable choices at a decision point. MUST be called at every decision point. The player may instead answer freely by voice — treat spoken answers as valid even if off-menu.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        options: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "2-4 options, each under 8 words, each a genuine dilemma option.",
        },
        beat_id: { type: Type.STRING },
      },
      required: ["options", "beat_id"],
    },
  },
  {
    name: TOOL_NAMES.startQte,
    behavior: Behavior.NON_BLOCKING,
    description:
      "Start a physical quick-time-event fight/action the player must win by tapping. Use for fights and physical peril. You will receive the result (win/lose) — narrate the matching branch. Losing is a valid story branch.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: ["mash", "timed", "sequence"] },
        difficulty: { type: Type.NUMBER, description: "1 (easy) to 5 (brutal)" },
        prompt: { type: Type.STRING, description: "Short imperative shown to the player, e.g. 'Hold the door!'" },
        win_summary: { type: Type.STRING },
        lose_summary: { type: Type.STRING },
      },
      required: ["type", "difficulty", "prompt", "win_summary", "lose_summary"],
    },
  },
  {
    name: TOOL_NAMES.skillCheck,
    behavior: Behavior.NON_BLOCKING,
    description:
      "Roll a d20 skill check for a risky non-combat action. Grant advantage=true when the player commits to the attempt persuasively or in-character (judge from their actual speech and tone).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        stat: { type: Type.STRING, enum: ["might", "wit", "charm"] },
        difficulty: { type: Type.NUMBER, description: "DC 5 (trivial) to 20 (near-impossible)" },
        advantage: { type: Type.BOOLEAN },
        success_summary: { type: Type.STRING },
        fail_summary: { type: Type.STRING },
      },
      required: ["stat", "difficulty", "advantage", "success_summary", "fail_summary"],
    },
  },
  {
    name: TOOL_NAMES.showUi,
    behavior: Behavior.NON_BLOCKING,
    description:
      "Show a generated interface panel. Use when the player asks about their inventory, stats, journal, a map, or when they find a diegetic artifact (poster, letter, terminal).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        kind: {
          type: Type.STRING,
          enum: ["inventory_grid", "stat_block", "map", "dialogue_card", "journal", "shop", "artifact_html"],
        },
        context: {
          type: Type.STRING,
          description: "Everything the UI generator needs: items/facts to show, artifact text, tone.",
        },
      },
      required: ["kind", "context"],
    },
  },
  {
    name: TOOL_NAMES.updateState,
    behavior: Behavior.NON_BLOCKING,
    description:
      "Record every consequential change: flags, hp, inventory, relationship deltas (score -5..5 with feeling + cause), aura traits, and beat transitions. Every choice or meaningful player behavior MUST write at least one change. State is the single source of truth — never contradict it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        beat_id: { type: Type.STRING, description: "Current outline beat id after this change." },
        patch: {
          type: Type.STRING,
          description:
            'JSON object string with any of: {"flags":{...},"hp":n,"inventoryAdd":[...],"inventoryRemove":[...],"relationships":{"npc":{"score":n,"feeling":"...","lastCause":"..."}},"auraTraitsAdd":[...],"reputation":"..."}',
        },
      },
      required: ["patch"],
    },
  },
  {
    name: TOOL_NAMES.endStory,
    description:
      "End the story. Call only when an outline ending condition is genuinely met.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ending_id: { type: Type.STRING },
        epilogue: { type: Type.STRING, description: "2-4 sentence epilogue, second person." },
      },
      required: ["ending_id", "epilogue"],
    },
  },
];
