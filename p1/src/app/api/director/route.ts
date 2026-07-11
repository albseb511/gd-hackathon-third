import { NextRequest, NextResponse } from "next/server";
import { runDirector } from "@/lib/storyEngine/director";
import { loadPlaythroughContext } from "@/lib/storyEngine/loadContext";
import { PlayState } from "@/lib/storyEngine/types";

// Runs the Director on a completed narrator turn. The client fires this
// after turnComplete (off the critical path) and applies the verdict:
// continuity steering, missed scene/choices fills, social deltas.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    playthroughId?: string;
    turnText?: string;
    playerText?: string;
    state?: PlayState; // client-authoritative current state
    hadRenderScene?: boolean;
    hadChoices?: boolean;
    hadSpeakAs?: boolean;
  } | null;

  if (!body?.playthroughId || !body.turnText) {
    return NextResponse.json({ error: "playthroughId and turnText required" }, { status: 400 });
  }
  const ctx = await loadPlaythroughContext(body.playthroughId);
  if (!ctx) {
    return NextResponse.json({ error: "playthrough not found" }, { status: 404 });
  }

  try {
    const verdict = await runDirector({
      turnText: body.turnText,
      playerText: body.playerText,
      state: body.state ?? ctx.state,
      outline: ctx.outline,
      characters: ctx.charactersSheets,
      hadRenderScene: body.hadRenderScene ?? false,
      hadChoices: body.hadChoices ?? false,
      hadSpeakAs: body.hadSpeakAs ?? false,
    });
    return NextResponse.json(verdict);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "director failed" },
      { status: 502 },
    );
  }
}
