import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/orchestrator";
import { emptyRoom } from "@/scene/defaults";
import type { RoomDesign } from "@/scene/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    goal?: string;
    design?: RoomDesign;
  };
  const goal = String(body.goal ?? "").slice(0, 600);
  if (!goal) return NextResponse.json({ error: "goal required" }, { status: 400 });

  try {
    const result = await orchestrate(goal, body.design ?? emptyRoom());
    return NextResponse.json(result);
  } catch (e) {
    console.error("orchestrate error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "orchestration failed" },
      { status: 500 },
    );
  }
}
