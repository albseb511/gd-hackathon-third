import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { playthroughs, simRuns, stories, telemetry } from "@/db/schema";
import { aggregate } from "@/lib/sim/aggregate";
import type { SimRunResult } from "@/lib/sim/simulate";
import { percentile } from "@/lib/sim/aggregate";
import { prebuiltById, PrebuiltStoryId } from "@/lib/prebuilt";
import { StoryOutline, PlayState } from "@/lib/storyEngine/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/analytics/[storyId]?playthroughId=...
// storyId may be a stories.id uuid OR a prebuilt id (noir|fantasy|starship).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const playthroughId = req.nextUrl.searchParams.get("playthroughId");

  // resolve outline + the set of story row ids this refers to
  let outline: StoryOutline | null = null;
  let storyRowIds: string[] = [];
  let title = "";

  if (UUID_RE.test(storyId)) {
    if (!db) return NextResponse.json({ error: "no database" }, { status: 503 });
    const [row] = await db.select().from(stories).where(eq(stories.id, storyId));
    if (!row) return NextResponse.json({ error: "story not found" }, { status: 404 });
    outline = row.outline as StoryOutline;
    title = row.title;
    storyRowIds = [row.id];
  } else {
    const pre = prebuiltById[storyId as PrebuiltStoryId];
    if (!pre) return NextResponse.json({ error: "story not found" }, { status: 404 });
    outline = pre;
    title = pre.title;
    if (db) {
      const rows = await db
        .select({ id: stories.id })
        .from(stories)
        .where(and(eq(stories.isPrebuilt, true), eq(stories.title, pre.title)));
      storyRowIds = rows.map((r) => r.id);
    }
  }

  // sim runs → aggregate
  let runs: SimRunResult[] = [];
  if (db && storyRowIds.length) {
    const rows = await db
      .select()
      .from(simRuns)
      .where(inArray(simRuns.storyId, storyRowIds));
    runs = rows.map((r) => ({
      persona: r.persona as SimRunResult["persona"],
      path: r.path as string[],
      choices: r.choices as SimRunResult["choices"],
      endingId: r.endingId,
      latencies: (r.latencies as { step: string; ms: number }[]) ?? [],
      turns: 0,
    }));
  }
  const agg = aggregate(runs, outline);

  // live-play latency (client marks + server pipeline steps)
  let liveLatency: { step: string; p50: number; p95: number; n: number }[] = [];
  if (db) {
    const rows = await db
      .select({ step: telemetry.step, ms: telemetry.ms })
      .from(telemetry)
      .where(like(telemetry.step, "%"));
    const byStep = new Map<string, number[]>();
    for (const r of rows) {
      if (r.step.startsWith("sim:")) continue;
      const arr = byStep.get(r.step) ?? [];
      arr.push(r.ms);
      byStep.set(r.step, arr);
    }
    liveLatency = [...byStep.entries()].map(([step, arr]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return {
        step,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        n: sorted.length,
      };
    });
  }

  // the player's own route through the story
  let playerPath: string[] | null = null;
  if (db && playthroughId && UUID_RE.test(playthroughId)) {
    const [pt] = await db
      .select({ state: playthroughs.state })
      .from(playthroughs)
      .where(eq(playthroughs.id, playthroughId));
    playerPath = (pt?.state as PlayState | undefined)?.path ?? null;
  }

  return NextResponse.json({
    title,
    simCount: runs.length,
    aggregate: agg,
    liveLatency,
    playerPath,
  });
}
