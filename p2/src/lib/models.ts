// vendored from p1/src/lib/models.ts @ 2026-07-11 — owned by p2, do not re-sync.
// Central model registry — hackathon-approved Gemini models.
export const MODELS = {
  text: "gemini-3.5-flash",
  live: process.env.LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
  image: "gemini-3.1-flash-lite-image", // Nano Banana 2 Lite (NB2)
  omni: "gemini-omni-flash-preview",
  tts: "gemini-3.1-flash-tts-preview",
} as const;
