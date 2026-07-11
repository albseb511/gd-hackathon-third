// POST /api/tts — synthesize ONE character dialogue line in a prebuilt voice.
// The Live narrator calls speak_as(character, line, delivery); the client
// resolves the character's voiceName and posts here for the actual audio.
//
// { text: string, voiceName: string, style?: string }
//   -> { pcmBase64: string, mime: string }   (mime is audio/l16;rate=24000)

import { NextResponse } from "next/server";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import { CHARACTER_VOICE_POOL, NARRATOR_VOICES } from "@/lib/storyEngine/types";

export const maxDuration = 30;

const VALID_VOICES = new Set<string>([...CHARACTER_VOICE_POOL, ...NARRATOR_VOICES]);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const { text, voiceName, style } = (body ?? {}) as {
    text?: unknown;
    voiceName?: unknown;
    style?: unknown;
  };

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (typeof voiceName !== "string" || !VALID_VOICES.has(voiceName)) {
    return NextResponse.json(
      { error: `voiceName must be one of: ${[...VALID_VOICES].join(", ")}` },
      { status: 400 },
    );
  }
  if (style !== undefined && typeof style !== "string") {
    return NextResponse.json({ error: "style must be a string" }, { status: 400 });
  }

  const delivery = style?.trim() || "naturally, in character";

  try {
    const res = await withTiming("tts", { model: MODELS.tts }, () =>
      genai().models.generateContent({
        model: MODELS.tts,
        contents: `Say ${delivery}: ${text}`,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      }),
    );

    const inline = res.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data,
    )?.inlineData;

    if (!inline?.data) {
      return NextResponse.json({ error: "TTS returned no audio" }, { status: 502 });
    }

    return NextResponse.json({
      pcmBase64: inline.data,
      mime: inline.mimeType ?? "audio/l16;rate=24000",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS failed" },
      { status: 502 },
    );
  }
}
