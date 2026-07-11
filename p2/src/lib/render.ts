// Render core — NB2 Lite (Nano Banana 2 Lite) photoreal reskin.
// Generalized from p1/src/lib/artist.ts @ 2026-07-11 — owned by p2.
//
// Pipeline: an optional viewport screenshot as STRUCTURAL guide (preserves the
// exact room layout/perspective) + optional real-product reference images +
// styled text prompt -> one photoreal image out. On timeout/refusal, retry once
// without the reference images (refs are the top cause of slowness + refusals).

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

export interface ImageBytes {
  data: Buffer;
  mime: string;
}

export interface RenderOptions {
  prompt: string;
  style?: string; // interior style preset text, e.g. "warm scandinavian, oak + linen"
  guideImage?: ImageBytes; // viewport screenshot -> structural guide
  referenceImages?: ImageBytes[]; // real product / material reference photos
  aspectRatio?: "16:9" | "4:3" | "1:1";
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;

function buildParts(opts: RenderOptions, includeReferences: boolean): Part[] {
  const parts: Part[] = [];

  if (opts.guideImage) {
    parts.push({
      inlineData: {
        data: opts.guideImage.data.toString("base64"),
        mimeType: opts.guideImage.mime,
      },
    });
  }

  const refs = includeReferences ? (opts.referenceImages ?? []) : [];
  for (const ref of refs) {
    parts.push({
      inlineData: { data: ref.data.toString("base64"), mimeType: ref.mime },
    });
  }

  const style = opts.style ? `${opts.style}. ` : "";
  let text = opts.guideImage
    ? `Re-render this exact interior photorealistically. Keep the room geometry, camera angle, wall positions and proportions identical to the source image — change only surface realism, materials, lighting and finish. ${style}${opts.prompt}`
    : `Photorealistic interior architectural photograph. ${style}${opts.prompt}`;

  if (refs.length > 0) {
    text +=
      " Match the materials and products shown in the reference images as closely as possible.";
  }

  parts.push({ text });
  return parts;
}

function extractImage(parts: Part[] | undefined): ImageBytes | null {
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
  opts: RenderOptions,
  includeReferences: boolean,
  timeoutMs: number,
): Promise<ImageBytes> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await genai().models.generateContent({
      model: MODELS.image,
      contents: [{ role: "user", parts: buildParts(opts, includeReferences) }],
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: opts.aspectRatio ?? "16:9", imageSize: "1K" },
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

export async function renderPhotoreal(opts: RenderOptions): Promise<ImageBytes> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return withTiming("render", { model: MODELS.image }, async () => {
    try {
      return await attempt(opts, true, timeoutMs);
    } catch (err) {
      const retriable = isAbort(err) || err instanceof ImageGenError;
      if (!retriable) {
        throw new ImageGenError(
          "unknown",
          err instanceof Error ? err.message : String(err),
        );
      }
      // Retry once without reference images (keep the structural guide).
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
