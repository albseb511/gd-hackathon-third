// Artist agent — turns scene prompts into images via Nano Banana 2 Lite.
// Core pipeline: reference images (protagonist consistency) + optional
// previous frame (edit shots) + styled text prompt -> single image out.

import type { Part } from "@google/genai";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";

export class ImageGenError extends Error {
  readonly code: "timeout" | "refusal" | "no-image" | "unknown";

  constructor(code: ImageGenError["code"], message: string) {
    super(message);
    this.name = "ImageGenError";
    this.code = code;
  }
}

export interface GenerateImageOptions {
  prompt: string;
  artStyle: string;
  mood?: string;
  referenceImages?: { data: Buffer; mime: string }[];
  previousImage?: { data: Buffer; mime: string };
  shot?: "new" | "edit";
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function buildParts(
  opts: GenerateImageOptions,
  includeReferences: boolean,
): Part[] {
  const { prompt, artStyle, mood, referenceImages, previousImage, shot } = opts;

  const parts: Part[] = [];

  const refs = includeReferences ? (referenceImages ?? []) : [];
  for (const ref of refs) {
    parts.push({
      inlineData: { data: ref.data.toString("base64"), mimeType: ref.mime },
    });
  }

  if (shot === "edit" && previousImage) {
    parts.push({
      inlineData: {
        data: previousImage.data.toString("base64"),
        mimeType: previousImage.mime,
      },
    });
  }

  let text =
    shot === "edit"
      ? `Edit this image: ${prompt}. Keep everything else — characters, faces, lighting, background — exactly consistent.`
      : `${artStyle}. ${prompt}`;

  if (mood) text += ` Mood: ${mood}.`;

  if (refs.length > 0) {
    text +=
      " The protagonist is the person in the first reference image — keep face, hair and outfit consistent.";
  }

  parts.push({ text });
  return parts;
}

function extractImage(parts: Part[] | undefined): {
  data: Buffer;
  mime: string;
} | null {
  for (const part of parts ?? []) {
    if (part.inlineData?.data) {
      return {
        data: Buffer.from(part.inlineData.data, "base64"),
        mime: part.inlineData.mimeType ?? "image/png",
      };
    }
  }
  return null;
}

async function attempt(
  opts: GenerateImageOptions,
  includeReferences: boolean,
  timeoutMs: number,
): Promise<{ data: Buffer; mime: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await genai().models.generateContent({
      model: MODELS.image,
      contents: [{ role: "user", parts: buildParts(opts, includeReferences) }],
      config: {
        responseModalities: ["IMAGE"],
        abortSignal: controller.signal,
      },
    });

    const image = extractImage(response.candidates?.[0]?.content?.parts);
    if (!image) {
      const why =
        response.promptFeedback?.blockReason ??
        response.candidates?.[0]?.finishReason ??
        "no inlineData part in response";
      throw new ImageGenError("refusal", `Model returned no image (${why})`);
    }
    return image;
  } finally {
    clearTimeout(timer);
  }
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && /abort/i.test(err.message))
  );
}

export async function generateImage(
  opts: GenerateImageOptions,
): Promise<{ data: Buffer; mime: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return withTiming("scene-image", { model: MODELS.image }, async () => {
    try {
      return await attempt(opts, true, timeoutMs);
    } catch (err) {
      // Timeout or refusal: retry once without reference images — refs are
      // the most common trigger for both slowness and safety refusals.
      const retriable = isAbort(err) || err instanceof ImageGenError;
      if (!retriable) {
        throw new ImageGenError(
          "unknown",
          err instanceof Error ? err.message : String(err),
        );
      }
      try {
        return await attempt(opts, false, timeoutMs);
      } catch (retryErr) {
        if (retryErr instanceof ImageGenError) throw retryErr;
        throw new ImageGenError(
          isAbort(retryErr) ? "timeout" : "unknown",
          retryErr instanceof Error ? retryErr.message : String(retryErr),
        );
      }
    }
  });
}
