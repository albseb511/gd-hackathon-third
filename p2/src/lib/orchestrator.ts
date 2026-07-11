// Orchestrator: fan out the specialist agents in parallel over a shared snapshot,
// then apply their actions through a SINGLE serialized reducer with conflict
// logging. This is the multi-agent core (PS2) — shared mutating blackboard.
import { AGENTS, AgentOutput, buildAgentUser } from "@/lib/agents";
import { runJsonAgent } from "@/lib/agentRun";
import { actionToPatches } from "@/scene/tools";
import { applyPatches, patchScope } from "@/scene/patch";
import { buildApartment, normalizeConfig, DEFAULT_APARTMENT, type ApartmentConfig } from "@/lib/apartment";
import type { RoomDesign } from "@/scene/types";

// Detect an apartment/whole-home brief and pull any explicit numbers out of it.
export function detectApartment(goal: string): Partial<ApartmentConfig> | null {
  const g = goal.toLowerCase();
  const bhk = g.match(/(\d+)\s*bhk/) || g.match(/(\d+)\s*(?:bed|bedroom)/);
  const isApt = /\bbhk\b|apartment|\bflat\b|bedroom|\bhouse\b|\bhome\b|floor plan|floorplan/.test(g) || !!bhk;
  if (!isApt) return null;
  const cfg: Partial<ApartmentConfig> = {};
  if (bhk) cfg.bedrooms = parseInt(bhk[1], 10);
  const bath = g.match(/(\d+)\s*(?:bath|bathroom|toilet)/);
  if (bath) cfg.bathrooms = parseInt(bath[1], 10);
  const plot = g.match(/(\d+(?:\.\d+)?)\s*(?:x|by|\*|×)\s*(\d+(?:\.\d+)?)/);
  if (plot) {
    cfg.plotW = parseFloat(plot[1]);
    cfg.plotD = parseFloat(plot[2]);
  }
  if (/balcon/.test(g)) cfg.balcony = true;
  if (/no balcon/.test(g)) cfg.balcony = false;
  return cfg;
}

export interface AgentTask {
  agent: string;
  status: "ok" | "failed";
  startOffsetMs: number; // when this agent started, relative to orchestration start
  ms: number;
  applied: number;
  dropped: number;
  reasoning: string;
  error?: string;
}
export interface OrchestrationResult {
  design: RoomDesign;
  tasks: AgentTask[];
  conflicts: { scope: string; winner: string; loser: string }[];
  totalMs: number;
  apartmentConfig?: ApartmentConfig; // set when a whole-home brief was built
}

const APPLY_ORDER = ["architect", "materials", "stylist", "furnishing"];

export async function orchestrate(
  goal: string,
  startDesign: RoomDesign,
  now: () => number = () => Date.now(),
): Promise<OrchestrationResult> {
  const t0 = now();

  // Whole-home brief ("2 BHK", "apartment"…): the Draftsman builds a valid
  // multi-room apartment deterministically with smart defaults, then the
  // materials/stylist agents run in parallel to color it.
  const apt = detectApartment(goal);
  if (apt) {
    const config = normalizeConfig({ ...DEFAULT_APARTMENT, ...apt });
    let design = buildApartment(config);
    const tasks: AgentTask[] = [
      {
        agent: "draftsman",
        status: "ok",
        startOffsetMs: 0,
        ms: now() - t0,
        applied: 1,
        dropped: 0,
        reasoning: `Built a ${config.bedrooms} BHK (${config.plotW}×${config.plotD} m, ${config.bathrooms} bath${config.bathrooms > 1 ? "s" : ""}${config.balcony ? " + balcony" : ""}) — ${design.rooms?.length ?? 0} rooms with real doors & windows.`,
      },
    ];
    const styleAgents = AGENTS.filter((a) => a.name === "materials" || a.name === "stylist");
    const styled = await Promise.all(
      styleAgents.map(async (a) => {
        const start = now();
        const r = await runJsonAgent({ label: a.name, system: a.system, user: buildAgentUser(goal, design), schema: AgentOutput });
        return { agent: a.name, startOffsetMs: start - t0, ms: now() - start, r };
      }),
    );
    for (const res of styled) {
      const task: AgentTask = {
        agent: res.agent, status: res.r.ok ? "ok" : "failed", startOffsetMs: res.startOffsetMs,
        ms: res.ms, applied: 0, dropped: 0, reasoning: res.r.ok ? res.r.data.reasoning : "",
        error: res.r.ok ? undefined : res.r.error,
      };
      if (res.r.ok) {
        for (const action of res.r.data.actions.slice(0, 24)) {
          const { patches } = actionToPatches(action.tool, action.args, design);
          if (!patches.length) { task.dropped++; continue; }
          design = applyPatches(design, patches);
          task.applied++;
        }
      }
      tasks.push(task);
    }
    return { design, tasks, conflicts: [], totalMs: now() - t0, apartmentConfig: config };
  }

  // Fan out — every agent sees the same snapshot, runs concurrently.
  const raw = await Promise.all(
    AGENTS.map(async (a) => {
      const start = now();
      const r = await runJsonAgent({
        label: a.name,
        system: a.system,
        user: buildAgentUser(goal, startDesign),
        schema: AgentOutput,
      });
      return { agent: a.name, startOffsetMs: start - t0, ms: now() - start, r };
    }),
  );

  // Serialized reducer in a fixed order (architect first so a create_room reset
  // precedes materials/furniture).
  const sorted = [...raw].sort(
    (a, b) => APPLY_ORDER.indexOf(a.agent) - APPLY_ORDER.indexOf(b.agent),
  );

  let design = startDesign;
  const scopeOwner = new Map<string, string>();
  const conflicts: OrchestrationResult["conflicts"] = [];
  const tasks: AgentTask[] = [];

  for (const res of sorted) {
    const task: AgentTask = {
      agent: res.agent,
      status: res.r.ok ? "ok" : "failed",
      startOffsetMs: res.startOffsetMs,
      ms: res.ms,
      applied: 0,
      dropped: 0,
      reasoning: res.r.ok ? res.r.data.reasoning : "",
      error: res.r.ok ? undefined : res.r.error,
    };
    if (res.r.ok) {
      for (const action of res.r.data.actions.slice(0, 24)) {
        const { patches } = actionToPatches(action.tool, action.args, design);
        if (!patches.length) {
          task.dropped++;
          continue;
        }
        for (const p of patches) {
          const scope = patchScope(p);
          const owner = scopeOwner.get(scope);
          if (owner && owner !== res.agent) {
            conflicts.push({ scope, winner: res.agent, loser: owner });
          }
          scopeOwner.set(scope, res.agent);
        }
        design = applyPatches(design, patches);
        task.applied++;
      }
    }
    tasks.push(task);
  }

  return { design, tasks, conflicts, totalMs: now() - t0 };
}
