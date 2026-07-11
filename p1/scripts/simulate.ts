// Simulator CLI: play a prebuilt story as N synthetic players and print
// branch/choice/ending/latency analytics. Persists to simRuns + telemetry
// when DATABASE_URL is configured.
//
// Run from p1/: npx tsx scripts/simulate.ts --story noir --n 4

import fs from "node:fs";
import path from "node:path";

// Load p1/.env by hand (no dotenv dependency).
function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(["'])(.*)\1$/, "$2");
  }
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z]+)$/);
    if (m) args[m[1]] = argv[i + 1] ?? "";
  }
  return {
    story: args.story ?? "noir",
    n: Math.max(1, parseInt(args.n ?? "4", 10) || 4),
    maxTurns: parseInt(args.turns ?? "40", 10) || 40,
    verbose: "verbose" in args || argv.includes("--verbose"),
  };
}

const CONCURRENCY = 2;

async function main() {
  loadEnv();
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not found in .env");
    process.exit(1);
  }
  const opts = parseArgs(process.argv.slice(2));

  // Import src modules only after env is loaded (genai/db read env lazily,
  // but keep the ordering explicit and safe).
  const { prebuiltById } = await import("../src/lib/prebuilt");
  const { simulateRun } = await import("../src/lib/sim/simulate");
  const { aggregate } = await import("../src/lib/sim/aggregate");
  const { PERSONAS } = await import("../src/lib/sim/player");
  type SimRunResult = Awaited<ReturnType<typeof simulateRun>>;

  const storyId = opts.story as keyof typeof prebuiltById;
  const outline = prebuiltById[storyId];
  if (!outline) {
    console.error(`Unknown story "${opts.story}" — use one of: ${Object.keys(prebuiltById).join(", ")}`);
    process.exit(1);
  }

  console.log(
    `Simulating "${outline.title}" (${opts.story}) — ${opts.n} run(s), maxTurns ${opts.maxTurns}, concurrency ${CONCURRENCY}\n`,
  );

  // ---- run n sims with a small worker pool, personas round-robin -----------
  const jobs = Array.from({ length: opts.n }, (_, i) => ({
    idx: i,
    persona: PERSONAS[i % PERSONAS.length],
  }));
  const results: SimRunResult[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const t0 = performance.now();
      console.log(`[run ${job.idx + 1}/${opts.n}] ${job.persona} — starting`);
      try {
        const run = await simulateRun({
          outline,
          storyId: opts.story,
          persona: job.persona,
          maxTurns: opts.maxTurns,
          log: opts.verbose ? (s) => console.log(`[run ${job.idx + 1}]${s}`) : undefined,
        });
        results.push(run);
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        console.log(
          `[run ${job.idx + 1}/${opts.n}] ${job.persona} — ${run.turns} GM turns, ` +
            `ending: ${run.endingId ?? "(none — hit maxTurns)"}, ${run.choices.length} choices, ${secs}s`,
        );
      } catch (err) {
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        console.error(`[run ${job.idx + 1}/${opts.n}] ${job.persona} — FAILED after ${secs}s:`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  if (results.length === 0) {
    console.error("\nAll runs failed — nothing to aggregate.");
    process.exit(1);
  }

  // ---- persist -----------------------------------------------------------------
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import("../src/db");
      const { stories, simRuns, telemetry } = await import("../src/db/schema");
      const { and, eq } = await import("drizzle-orm");
      const { MODELS } = await import("../src/lib/models");
      if (db) {
        // simRuns.storyId is a FK to stories — find or create the prebuilt row.
        let [story] = await db
          .select({ id: stories.id })
          .from(stories)
          .where(and(eq(stories.title, outline.title), eq(stories.isPrebuilt, true)))
          .limit(1);
        if (!story) {
          [story] = await db
            .insert(stories)
            .values({
              title: outline.title,
              premise: outline.logline,
              outline,
              isPrebuilt: true,
              artStyle: outline.artStyle,
            })
            .returning({ id: stories.id });
        }
        for (const run of results) {
          const [row] = await db
            .insert(simRuns)
            .values({
              storyId: story.id,
              persona: run.persona,
              path: run.path,
              choices: run.choices,
              endingId: run.endingId,
              latencies: run.latencies,
            })
            .returning({ id: simRuns.id });
          if (run.latencies.length > 0) {
            await db.insert(telemetry).values(
              run.latencies.map((l) => ({
                step: `sim:${l.step}`,
                ms: l.ms,
                model: l.step.startsWith("gm") || l.step === "player_pick" ? MODELS.text : null,
                simRunId: row.id,
                meta: { persona: run.persona, story: opts.story },
              })),
            );
          }
        }
        console.log(`\nPersisted ${results.length} run(s) to sim_runs + telemetry.`);
      }
    } catch (err) {
      console.error("\nDB persistence failed (continuing):", err);
    }
  }

  // ---- aggregate report -----------------------------------------------------------
  const agg = aggregate(results, outline);

  console.log(`\n===== AGGREGATE (${results.length} runs) =====`);

  console.log("\n-- Beat visits --");
  for (const node of agg.nodes) {
    if (node.visits > 0) {
      console.log(`  [${node.actId}] ${node.beatId}  x${node.visits}  — ${node.label}`);
    }
  }

  console.log("\n-- Choice stats (per fork) --");
  if (agg.choiceStats.length === 0) console.log("  (no present_choices forks recorded)");
  for (const stat of agg.choiceStats) {
    console.log(`  @ ${stat.beatId}`);
    for (const o of stat.options) {
      console.log(`    ${String(o.pct).padStart(5)}%  (${o.count})  ${o.option}`);
    }
  }

  console.log("\n-- Endings --");
  for (const e of agg.endings) {
    console.log(`  ${String(e.pct).padStart(5)}%  (${e.count})  ${e.endingId}`);
  }

  console.log("\n-- Unreached beats --");
  console.log(agg.unreachedBeats.length ? `  ${agg.unreachedBeats.join(", ")}` : "  (all outline beats reached)");

  console.log("\n-- Top edges --");
  for (const e of agg.edges.slice(0, 12)) {
    console.log(`  ${e.from} → ${e.to}  x${e.count}`);
  }

  console.log("\n-- Latency --");
  for (const l of agg.latency) {
    console.log(`  ${l.step.padEnd(12)} p50 ${l.p50}ms  p95 ${l.p95}ms  (n=${l.n})`);
  }

  process.exit(0); // release the postgres pool
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
