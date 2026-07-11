// Orchestrator: fan out the specialist agents in parallel over a shared snapshot,
// then apply their actions through a SINGLE serialized reducer with conflict
// logging. This is the multi-agent core (PS2) — shared mutating blackboard.
import { AGENTS, AgentOutput, buildAgentUser } from "@/lib/agents";
import { runJsonAgent } from "@/lib/agentRun";
import { actionToPatches } from "@/scene/tools";
import { applyPatches, patchScope } from "@/scene/patch";
import type { RoomDesign } from "@/scene/types";

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
}

const APPLY_ORDER = ["architect", "materials", "stylist", "furnishing"];

export async function orchestrate(
  goal: string,
  startDesign: RoomDesign,
  now: () => number = () => Date.now(),
): Promise<OrchestrationResult> {
  const t0 = now();

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
