// POST /api/beat — the client's persistence firehose. GameStage calls this
// after every beat with the latest scene, a state patch, and client timings.
// Must be a no-op (ok, persisted:false) without a db or for local-* ids.

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { playthroughs, scenes, telemetry } from "@/db/schema";
import type { PlayState } from "@/lib/storyEngine/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SceneUpsert {
  idx: number;
  beatId?: string;
  narration?: string;
  imagePrompt?: string;
  imageAssetId?: string;
  choices?: unknown;
  chosen?: string;
  qteResult?: unknown;
  diceResult?: unknown;
}

interface BeatBody {
  playthroughId?: string;
  scene?: SceneUpsert;
  // Either { state: <full PlayState> } (replace) or a shallow merge patch.
  statePatch?: Record<string, unknown>;
  sessionHandle?: string;
  marks?: { name: string; ms: number }[];
}

export async function POST(req: Request) {
  let body: BeatBody;
  try {
    body = (await req.json()) as BeatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { playthroughId, scene, statePatch, sessionHandle, marks } = body;
  if (!playthroughId || typeof playthroughId !== "string") {
    return NextResponse.json({ error: "playthroughId is required" }, { status: 400 });
  }

  // Local / db-less mode: acknowledge without persisting.
  if (!db || playthroughId.startsWith("local-")) {
    return NextResponse.json({ ok: true, persisted: false });
  }
  if (!UUID_RE.test(playthroughId)) {
    return NextResponse.json({ error: "Unknown playthrough" }, { status: 404 });
  }

  const [playthrough] = await db
    .select({ id: playthroughs.id, state: playthroughs.state })
    .from(playthroughs)
    .where(eq(playthroughs.id, playthroughId))
    .limit(1);
  if (!playthrough) {
    return NextResponse.json({ error: "Unknown playthrough" }, { status: 404 });
  }

  // ---- scene upsert (unique by playthroughId + idx) ----
  if (scene && typeof scene.idx === "number") {
    const fields = {
      beatId: scene.beatId,
      narration: scene.narration,
      imagePrompt: scene.imagePrompt,
      imageAssetId: scene.imageAssetId,
      choices: scene.choices,
      chosen: scene.chosen,
      qteResult: scene.qteResult,
      diceResult: scene.diceResult,
    };
    // only touch columns the client actually sent
    const provided = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );

    const [existing] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(eq(scenes.playthroughId, playthroughId), eq(scenes.idx, scene.idx)))
      .limit(1);

    if (existing) {
      if (Object.keys(provided).length) {
        await db.update(scenes).set(provided).where(eq(scenes.id, existing.id));
      }
    } else {
      await db.insert(scenes).values({
        playthroughId,
        idx: scene.idx,
        ...provided,
      });
    }
  }

  // ---- playthrough state / session / updatedAt ----
  let nextState: PlayState | Record<string, unknown> | undefined;
  let status: string | undefined;
  let endingId: string | undefined;
  if (statePatch && typeof statePatch === "object") {
    // `status` / `endingId` are playthrough columns, not PlayState fields —
    // lift them out (the client sends them on game over) before merging.
    const { status: s, endingId: e, state, ...rest } = statePatch;
    if (typeof s === "string") status = s;
    if (typeof e === "string") endingId = e;

    if (state && typeof state === "object") {
      // full replacement
      nextState = state as PlayState;
    } else if (Object.keys(rest).length) {
      // shallow merge into the stored state
      nextState = {
        ...(playthrough.state as Record<string, unknown>),
        ...rest,
      };
    }
  }

  await db
    .update(playthroughs)
    .set({
      ...(nextState !== undefined ? { state: nextState } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(endingId !== undefined ? { endingId } : {}),
      ...(sessionHandle !== undefined ? { sessionHandle } : {}),
      // sql now() (not new Date()) so it's consistent with the column's
      // defaultNow() — mixing the two skews resume-list ordering.
      updatedAt: sql`now()`,
    })
    .where(eq(playthroughs.id, playthroughId));

  // ---- client timing marks -> telemetry ----
  if (Array.isArray(marks) && marks.length) {
    const values = marks
      .filter((m) => m && typeof m.name === "string" && typeof m.ms === "number")
      .map((m) => ({
        step: `client:${m.name}`,
        ms: Math.round(m.ms),
        playthroughId,
      }));
    if (values.length) {
      await db.insert(telemetry).values(values);
    }
  }

  return NextResponse.json({ ok: true, persisted: true });
}
