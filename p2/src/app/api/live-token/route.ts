// adapted from p1/src/app/api/live-token/route.ts @ 2026-07-11 — owned by p2.
// Mints a single-use ephemeral token so the browser opens the Live WebSocket
// directly to Google (no audio proxying, no key exposure). liveConnectConstraints
// must carry the FULL session config; the client connects with an EMPTY config.
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { MODELS } from "@/lib/models";
import {
  buildLiveConnectConfig,
  CONSULTANT_SYSTEM_PROMPT,
} from "@/lib/live/liveConfig";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    model?: string;
    resumeHandle?: string;
    voiceName?: string;
    systemInstruction?: string;
  };
  const model = body.model ?? MODELS.live;

  const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { apiVersion: "v1alpha" },
  });

  try {
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model,
          config: buildLiveConnectConfig({
            systemInstruction: body.systemInstruction ?? CONSULTANT_SYSTEM_PROMPT,
            resumeHandle: body.resumeHandle,
            voiceName: body.voiceName,
          }),
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    return NextResponse.json({ token: token.name, model });
  } catch (e) {
    console.error("live-token error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "token mint failed" },
      { status: 500 },
    );
  }
}
