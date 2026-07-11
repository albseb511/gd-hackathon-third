// adapted from p1/src/lib/storyEngine/liveConfig.ts @ 2026-07-11 — owned by p2.
// One place defines the Live session shape; the token route and the client
// connect with the same config (client sends EMPTY config; all locked here).
import { LiveConnectConfig, Modality } from "@google/genai";

export const CONSULTANT_SYSTEM_PROMPT = `You are Atelier, a warm, expert interior-design consultant speaking aloud in real time.
You help the user design a room: layout, walls, materials, paint, finishes, furniture, lighting and mood.
Keep every spoken turn under ~50 words and conversational. React in character to interruptions.
Adapt your tone to the user's vocal energy. When the user shows you their room via camera, note what you see.
Think in real materials and rough costs. Ask one focused question when you need a decision.`;

export function buildLiveConnectConfig(opts: {
  systemInstruction?: string;
  resumeHandle?: string | null;
  voiceName?: string;
}): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: opts.systemInstruction ?? CONSULTANT_SYSTEM_PROMPT,
    // M1 will attach interior scene-mutation function declarations here.
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: opts.voiceName ?? "Charon" },
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: opts.resumeHandle ? { handle: opts.resumeHandle } : {},
    realtimeInputConfig: {},
  };
}
