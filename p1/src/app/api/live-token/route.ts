import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { MODELS } from "@/lib/models";
import { buildLiveConnectConfig } from "@/lib/storyEngine/liveConfig";

const TEST_PROMPT = `You are the narrator of a live interactive noir story, speaking aloud.
Open with two atmospheric sentences putting the listener in a rainy city at night, then ask what they do.
Keep every turn under 60 spoken words. React in character to interruptions.
Adapt your mood to the player's vocal tone. When the player faces a decision, call present_choices.
When a new scene begins, call render_scene first.`;

// Mints a single-use ephemeral token so the browser can open the Live
// WebSocket directly to Google (no audio proxying, no key exposure).
// IMPORTANT: liveConnectConstraints must carry the FULL session config —
// constraints with model-only crash the session with "Internal error".
// The client therefore connects with an EMPTY config; everything is locked here.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    model?: string;
    systemInstruction?: string;
    resumeHandle?: string;
    voiceName?: string;
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
            systemInstruction: body.systemInstruction ?? TEST_PROMPT,
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
