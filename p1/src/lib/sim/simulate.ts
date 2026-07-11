// Simulator core loop: one synthetic playthrough of a story outline.
// GM (text mode) narrates and calls tools; a persona player answers; QTE and
// skill-check outcomes are sampled locally by difficulty. Produces the path,
// per-fork choices, ending, and per-turn latencies for aggregation.

import type { CharacterSheet, PlayState, StoryOutline } from "../storyEngine/types";
import { initialPlayState } from "../storyEngine/types";
import { applyNarratorPatch, parseNarratorPatch } from "../storyEngine/applyPatch";
import { TOOL_NAMES } from "../storyEngine/tools";
import { GmTextSession, type GmStepResult, type GmToolCall } from "./gmTextMode";
import { pickAction, type Persona } from "./player";

export interface SimRunResult {
  persona: Persona;
  path: string[];
  choices: { beatId: string; options: string[]; picked: string }[];
  endingId: string | null;
  latencies: { step: string; ms: number }[];
  turns: number;
}

export interface SimulateRunOpts {
  outline: StoryOutline;
  storyId: string;
  persona: Persona;
  maxTurns?: number;
  log?: (s: string) => void;
}

// Persona-flavored luck on QTEs.
const QTE_PERSONA_MOD: Partial<Record<Persona, number>> = {
  heroic: 0.1,
  cautious: 0.05,
  chaotic: -0.05,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const d20 = () => 1 + Math.floor(Math.random() * 20);

function simCharacter(persona: Persona): CharacterSheet {
  return {
    name: "Alex",
    visualTokens: "average build, dark jacket, watchful eyes",
    personalityHints: `synthetic playtester with a ${persona} temperament`,
    stats: { might: 3, wit: 3, charm: 3 },
  };
}

function sampleQte(args: Record<string, unknown>, persona: Persona) {
  const difficulty = typeof args.difficulty === "number" ? args.difficulty : 3;
  const winProb = clamp(0.85 - 0.12 * difficulty + (QTE_PERSONA_MOD[persona] ?? 0), 0.05, 0.95);
  const win = Math.random() < winProb;
  return { outcome: { ok: true, result: win ? "win" : "lose" }, win };
}

function sampleSkillCheck(args: Record<string, unknown>, sheet: CharacterSheet) {
  const difficulty = typeof args.difficulty === "number" ? args.difficulty : 10;
  const stat = (typeof args.stat === "string" ? args.stat : "wit") as keyof CharacterSheet["stats"];
  const statValue = sheet.stats[stat] ?? 3;
  const advantage = args.advantage === true;
  const roll = advantage ? Math.max(d20(), d20()) : d20();
  const total = roll + statValue;
  const success = total >= difficulty;
  return {
    outcome: { ok: true, result: success ? "success" : "fail", roll, total, difficulty },
    success,
  };
}

export async function simulateRun(opts: SimulateRunOpts): Promise<SimRunResult> {
  const { outline, storyId, persona, maxTurns = 40 } = opts;
  const log = opts.log ?? (() => {});

  const sheet = simCharacter(persona);
  const firstBeatId = outline.acts[0]?.beats[0]?.id ?? "start";
  let state: PlayState = initialPlayState(firstBeatId);

  const gm = new GmTextSession({ outline, characters: [sheet], state });

  const latencies: { step: string; ms: number }[] = [];
  const choices: SimRunResult["choices"] = [];
  let endingId: string | null = null;
  let turns = 0;
  // Latest unanswered present_choices of the current GM burst.
  let openChoice: { beatId: string; options: string[] } | null = null;

  const timedGm = async (step: string, fn: () => Promise<GmStepResult>) => {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      latencies.push({ step, ms: Math.round(performance.now() - t0) });
      turns++;
    }
  };

  const processToolCalls = (calls: GmToolCall[]) => {
    for (const call of calls) {
      switch (call.name) {
        case TOOL_NAMES.updateState: {
          const patch = parseNarratorPatch(call.args.patch);
          const beatId = typeof call.args.beat_id === "string" ? call.args.beat_id : undefined;
          state = applyNarratorPatch(state, patch, beatId);
          break;
        }
        case TOOL_NAMES.renderScene: {
          const beatId = typeof call.args.beat_id === "string" ? call.args.beat_id : undefined;
          if (beatId && beatId !== state.beatId) {
            state = applyNarratorPatch(state, {}, beatId);
          }
          break;
        }
        case TOOL_NAMES.presentChoices: {
          const options = Array.isArray(call.args.options)
            ? (call.args.options as unknown[]).map(String)
            : [];
          const beatId = typeof call.args.beat_id === "string" ? call.args.beat_id : state.beatId;
          openChoice = { beatId, options };
          break;
        }
        case TOOL_NAMES.endStory: {
          endingId = typeof call.args.ending_id === "string" ? call.args.ending_id : "unknown";
          break;
        }
        default:
          break; // show_ui, skill_check, start_qte handled elsewhere
      }
    }
  };

  let result = await timedGm("gm_turn", () =>
    gm.step("(The player has joined and is listening. Open the story from the first beat.)"),
  );

  let processed = false;
  while (turns < maxTurns) {
    processToolCalls(result.toolCalls);
    processed = true;
    if (result.narration) log(`  [gm] ${result.narration.slice(0, 110).replace(/\n/g, " ")}`);

    if (result.ended || endingId) break;

    if (result.pending.length > 0) {
      // Resolve every pending interactive; the last resolve continues the GM.
      let next: GmStepResult = result;
      for (const p of [...result.pending]) {
        if (p.name === TOOL_NAMES.startQte) {
          const { outcome, win } = sampleQte(p.args, persona);
          log(`  [qte] difficulty ${String(p.args.difficulty)} → ${win ? "win" : "lose"}`);
          next = await timedGm("gm_resolve", () => gm.resolveInteractive(p.name, p.id, outcome));
        } else {
          const { outcome, success } = sampleSkillCheck(p.args, sheet);
          log(
            `  [skill] ${String(p.args.stat)} DC ${String(p.args.difficulty)} → ${success ? "success" : "fail"} (${outcome.total})`,
          );
          next = await timedGm("gm_resolve", () => gm.resolveInteractive(p.name, p.id, outcome));
        }
      }
      result = next;
      continue;
    }

    // Player's move: answer the open choice menu, or speak freeform.
    const tp = performance.now();
    const action = await pickAction({
      persona,
      narration: result.narration,
      options: openChoice?.options,
    });
    latencies.push({ step: "player_pick", ms: Math.round(performance.now() - tp) });

    if (openChoice) {
      choices.push({ beatId: openChoice.beatId, options: openChoice.options, picked: action });
      openChoice = null;
    }
    log(`  [${persona}] ${action}`);

    result = await timedGm("gm_turn", () => gm.step(action));
    processed = false;
  }

  // Flush tool calls from the final burst if the loop exited on maxTurns
  // before processing (e.g. end_story arriving on the very last turn).
  if (!processed) {
    processToolCalls(result.toolCalls);
    if (result.narration) log(`  [gm] ${result.narration.slice(0, 110).replace(/\n/g, " ")}`);
  }

  void storyId; // part of the public signature; used by callers for persistence

  return { persona, path: state.path, choices, endingId, latencies, turns };
}
