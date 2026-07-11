// vendored from p1/src/lib/gemini.ts @ 2026-07-11 — owned by p2, adapted telemetry shape.
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
  [k: string]: unknown;
};

// Uniform latency telemetry around every model/agent call.
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
    const { model, ...rest } = meta;
    db?.insert(telemetry)
      .values({
        step,
        ms,
        model,
        meta: Object.keys(rest).length ? rest : null,
      })
      .then(
        () => {},
        () => {},
      );
  }
}
