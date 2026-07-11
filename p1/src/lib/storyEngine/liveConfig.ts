import { LiveConnectConfig, Modality } from "@google/genai";
import { narratorTools } from "./tools";

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
