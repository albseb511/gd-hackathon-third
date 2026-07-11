// Asserts the multi-agent orchestrator: agents run in parallel, actions merge,
// furniture lands, final scene is valid. Run: npm run test:orchestrator
import { orchestrate } from "@/lib/orchestrator";
import { emptyRoom } from "@/scene/defaults";

async function main() {
  const { design, tasks, conflicts, totalMs } = await orchestrate(
    "cozy scandinavian living room, about 4x5 meters, with a reading nook",
    emptyRoom(4, 5, 2.7),
  );

  const sumMs = tasks.reduce((a, t) => a + t.ms, 0);
  console.log(
    `tasks: ${tasks.map((t) => `${t.agent}[${t.status},${t.applied}applied,${t.ms}ms@+${t.startOffsetMs}]`).join(" ")}`,
  );
  console.log(`total ${totalMs}ms vs sum ${sumMs}ms; conflicts: ${conflicts.length}; furniture: ${design.furniture.length}`);

  // Parallelism: wall-clock must be well under the sum of agent times.
  if (!(totalMs < sumMs)) throw new Error(`not parallel: total ${totalMs} >= sum ${sumMs}`);
  // All agents started near t0 (concurrent fan-out).
  const maxStart = Math.max(...tasks.map((t) => t.startOffsetMs));
  if (maxStart > 500) throw new Error(`agents did not fan out concurrently (maxStart ${maxStart}ms)`);
  // The system produced a furnished, valid room.
  if (design.room.dims.w < 1) throw new Error("invalid room dims");
  if (design.furniture.length < 1) throw new Error("no furniture placed");
  if (tasks.filter((t) => t.status === "ok").length < 3) throw new Error("fewer than 3 agents succeeded");
  // Every placed furniture item is inside the room.
  for (const f of design.furniture) {
    if (f.pos[0] < 0 || f.pos[0] > design.room.dims.w || f.pos[2] < 0 || f.pos[2] > design.room.dims.d) {
      throw new Error(`furniture ${f.id} out of bounds`);
    }
  }

  console.log("OK orchestrator: parallel fan-out, merged patches, furnished valid room.");
}

main().catch((e) => {
  console.error("FAIL test-orchestrator:", e);
  process.exit(1);
});
