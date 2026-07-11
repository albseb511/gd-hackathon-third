import { GoogleGenAI } from "@google/genai";
import { db } from "@/db";
import { telemetry } from "@/db/schema";

declare global {
  var __genai: GoogleGenAI | undefined;
}

export function genai() {
  return (globalThis.__genai ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  }));
}

type TimingMeta = {
  model?: string;
  playthroughId?: string;
  simRunId?: string;
  [k: string]: unknown;
};

// Uniform latency telemetry around every agent/model call.
// Persistence is fire-and-forget; timing must never fail the wrapped call.
export async function withTiming<T>(
  step: string,
  meta: TimingMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - t0);
    console.log(`[timing] ${step} ${ms}ms`);
    const { model, playthroughId, simRunId, ...rest } = meta;
    db?.insert(telemetry)
      .values({
        step,
        ms,
        model,
        playthroughId,
        simRunId,
        meta: Object.keys(rest).length ? rest : null,
      })
      .then(
        () => {},
        () => {},
      );
  }
}
