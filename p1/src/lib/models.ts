// Central model registry — hackathon-approved models, verified accessible.
export const MODELS = {
  text: "gemini-3.5-flash",
  live: process.env.LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
  image: "gemini-3.1-flash-lite-image", // Nano Banana 2 Lite
  tts: "gemini-3.1-flash-tts-preview",
  music: "lyria-3-clip-preview",
} as const;
