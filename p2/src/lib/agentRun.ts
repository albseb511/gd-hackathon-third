// Runs a Gemini 3.5 Flash agent that must return JSON matching a Zod schema.
// One repair retry on invalid output; never returns unvalidated data.
import type { z } from "zod";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";

function stripFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

function safeParse<T>(
  schema: z.ZodType<T>,
  raw: string,
): { ok: true; data: T } | { ok: false; error: string } {
  try {
    const json = JSON.parse(stripFence(raw));
    const r = schema.safeParse(json);
    return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSON parse error" };
  }
}

export async function runJsonAgent<T>(opts: {
  label: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
}): Promise<{ ok: true; data: T } | { ok: false; error: string; raw: string }> {
  return withTiming(`agent:${opts.label}`, { model: MODELS.text }, async () => {
    const call = async (extra: string) => {
      const res = await genai().models.generateContent({
        model: MODELS.text,
        contents: [{ role: "user", parts: [{ text: opts.user + extra }] }],
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          temperature: opts.temperature ?? 0.7,
        },
      });
      return res.text ?? "";
    };

    let raw = await call("");
    let parsed = safeParse(opts.schema, raw);
    if (!parsed.ok) {
      raw = await call(
        `\n\nYour previous reply was not valid JSON for the required schema (error: ${parsed.error}). Reply with ONLY valid JSON, no prose, no code fences.`,
      );
      parsed = safeParse(opts.schema, raw);
    }
    return parsed.ok
      ? { ok: true as const, data: parsed.data }
      : { ok: false as const, error: parsed.error, raw };
  });
}
