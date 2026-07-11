// adapted from p1/src/lib/storyEngine/liveConfig.ts @ 2026-07-11 — owned by p2.
// One place defines the Live session shape; the token route and the client
// connect with the same config (client sends EMPTY config; all locked here).
import { LiveConnectConfig, Modality } from "@google/genai";
import { LIVE_FUNCTION_DECLARATIONS } from "@/scene/tools";

export const CONSULTANT_SYSTEM_PROMPT = `You are Atelier, a warm, expert interior-design consultant speaking aloud in real time.
You help the user design a room in a live 3D view: layout, walls, materials, paint, finishes, furniture, lighting and mood.
You can change the 3D room directly by calling tools (create_room, add_furniture, move_furniture, remove_furniture, set_material, set_palette, add_light). Call them whenever the user asks for a change — act first, then say briefly what you did.
Keep every spoken turn under ~40 words and conversational. React in character to interruptions.
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
    tools: [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }],
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
