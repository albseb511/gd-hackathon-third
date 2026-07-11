// Legacy prewarm endpoint — now a thin shim over the World Forge. The
// CharacterCreator still fires this fire-and-forget after character creation;
// startForge supersedes the old "first beats + NPC portraits" logic with the
// full 50+ asset pipeline. Same response shape as POST /api/forge.

import { NextRequest, NextResponse } from "next/server";
import { startForge } from "@/lib/storyEngine/forgeRun";

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
