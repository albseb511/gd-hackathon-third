import { LiveConnectConfig, Modality } from "@google/genai";
import { narratorTools } from "./tools";

// Narrator voice matches the story's register. These are the Live-API
// prebuilt voices; deeper options carry the drama better.
export function voiceForGenre(genre: string): { voiceName: string; register: string } {
  const g = genre.toLowerCase();
  if (/noir|crime|thriller|mystery|detective/.test(g)) {
    return {
      voiceName: "Charon",
      register:
        "deep, low, unhurried — smoke and gravel; long pauses that let the rain fill the silence",
    };
  }
  if (/sci|space|star|cyber|future/.test(g)) {
    return {
      voiceName: "Fenrir",
      register:
        "deep, cold, measured — calm authority of a mission recorder; tension held under the surface",
    };
  }
  if (/horror|gothic|dark/.test(g)) {
    return {
      voiceName: "Charon",
      register: "deep, hushed, deliberate — a voice that knows what waits in the dark",
    };
  }
  return {
    voiceName: "Orus",
    register:
      "warm, low, resonant — a fireside storyteller with weight in every word",
  };
}

// One place defines what a Narrator Live session looks like; the token route
// and the client connect with the same shape.
export function buildLiveConnectConfig(opts: {
  systemInstruction: string;
  resumeHandle?: string | null;
  voiceName?: string;
}): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: opts.systemInstruction,
    tools: [{ functionDeclarations: narratorTools }],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: opts.voiceName ?? "Charon" },
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: opts.resumeHandle
      ? { handle: opts.resumeHandle }
      : {},
    realtimeInputConfig: {},
  };
}
