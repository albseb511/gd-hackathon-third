// POST /api/gen-ui — generative UI endpoint.
// { kind: 'artifact_html', context }            -> { kind, html }
// { kind: <UiSpecKind>, context, playthroughId? } -> { kind, spec }

import { NextResponse } from "next/server";
import { withTiming } from "@/lib/gemini";
import {
  generateArtifactHtml,
  generateUiSpec,
  UI_SPEC_KINDS,
  type UiSpecKind,
} from "@/lib/uiSmith";
import { loadPlaythroughContext } from "@/lib/storyEngine/loadContext";
import type { PlayState } from "@/lib/storyEngine/types";

export const maxDuration = 60;

interface GenUiBody {
  kind?: string;
  context?: string;
  playthroughId?: string;
}

function isSpecKind(kind: string): kind is UiSpecKind {
  return (UI_SPEC_KINDS as string[]).includes(kind);
}

export async function POST(req: Request) {
  let body: GenUiBody;
  try {
    body = (await req.json()) as GenUiBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind?.trim();
  const context = body.context?.trim();
  const playthroughId = body.playthroughId?.trim() || undefined;

  if (!kind || !context) {
    return NextResponse.json(
      { error: "kind and context are required" },
      { status: 400 },
    );
  }

  // ---- one-shot HTML artifacts ----
  if (kind === "artifact_html") {
    try {
      const html = await withTiming("gen-ui", { kind, playthroughId }, () =>
        generateArtifactHtml(context),
      );
      return NextResponse.json({ kind, html });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Artifact generation failed" },
        { status: 502 },
      );
    }
  }

  // ---- structured spec panels ----
  if (!isSpecKind(kind)) {
    return NextResponse.json({ error: `Unknown kind: ${kind}` }, { status: 400 });
  }

  let state: PlayState | null = null;
  if (playthroughId) {
    try {
      state = (await loadPlaythroughContext(playthroughId))?.state ?? null;
    } catch {
      // Missing/foreign playthrough must not block the panel — degrade to context-only.
      state = null;
    }
  }

  return withTiming("gen-ui", { kind, playthroughId }, async () => {
    let lastError: unknown;
    // Validation failures (zod / JSON) get exactly one retry.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const spec = await generateUiSpec(kind, context, state);
        return NextResponse.json({ kind, spec });
      } catch (err) {
        lastError = err;
        console.warn(
          `[gen-ui] ${kind} attempt ${attempt} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return NextResponse.json(
      {
        error:
          lastError instanceof Error ? lastError.message : "UI generation failed",
      },
      { status: 502 },
    );
  });
}
