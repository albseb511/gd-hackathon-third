// World Forge API.
// POST { playthroughId, aspect? }  — kick off the detached forge pipeline.
// GET  ?playthroughId=             — live progress, or a synthesized completed
//                                    status if the process restarted after a
//                                    finished forge (assetLibrary in the db).

import { NextRequest, NextResponse } from "next/server";
import { loadPlaythroughContext } from "@/lib/storyEngine/loadContext";
import {
  getForgeStatus,
  startForge,
  type ForgeStatus,
} from "@/lib/storyEngine/forgeRun";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    playthroughId?: string;
    aspect?: "16:9" | "9:16";
  } | null;
  if (!body?.playthroughId) {
    return NextResponse.json(
      { error: "playthroughId is required" },
      { status: 400 },
    );
  }
  const { alreadyRunning } = startForge(body.playthroughId, body.aspect ?? "16:9");
  return NextResponse.json({ started: !alreadyRunning, alreadyRunning });
}

const KIND_BY_GROUP: Record<string, string> = {
  scenes: "scene",
  locations: "scene",
  props: "item",
  poses: "portrait",
  cards: "ui",
  npcs: "portrait",
};

export async function GET(req: NextRequest) {
  const playthroughId = req.nextUrl.searchParams.get("playthroughId");
  if (!playthroughId) {
    return NextResponse.json(
      { error: "playthroughId is required" },
      { status: 400 },
    );
  }

  const live = getForgeStatus(playthroughId);
  if (live) return NextResponse.json(live);

  // Process may have restarted since the forge ran — if the library is in the
  // db, synthesize a completed status so pollers still resolve.
  const ctx = await loadPlaythroughContext(playthroughId);
  const library = ctx?.state.assetLibrary;
  if (!library) {
    return NextResponse.json({ error: "No forge for playthrough" }, { status: 404 });
  }

  const items = Object.entries(library).flatMap(([group, entries]) =>
    Object.entries(entries ?? {}).map(([key, assetId]) => ({
      kind: KIND_BY_GROUP[group] ?? "scene",
      key,
      label: key,
      assetId,
      ms: 0,
      ok: true,
    })),
  );
  const synthesized: ForgeStatus = {
    running: false,
    total: items.length,
    done: items.length,
    startedAt: 0,
    wallMs: 0,
    items,
  };
  return NextResponse.json(synthesized);
}
