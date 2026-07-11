import { NextRequest, NextResponse } from "next/server";
import { renderPhotoreal } from "@/lib/render";

export const maxDuration = 60;

function dataUrlToBytes(dataUrl: string): { mime: string; data: Buffer } | null {
  const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
  if (!m) return null;
  return { mime: m[1], data: Buffer.from(m[2], "base64") };
}

// Viewport screenshot (structural guide) + N styles → parallel NB2 reskins.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    image?: string;
    style?: string;
    styles?: string[];
    prompt?: string;
  };
  const guide = typeof body.image === "string" ? dataUrlToBytes(body.image) : null;
  const styles =
    Array.isArray(body.styles) && body.styles.length
      ? body.styles
      : [body.style ?? "warm, natural light, photorealistic interior"];
  const prompt = String(body.prompt ?? "Photorealistic architectural render of this interior.");

  const renders = await Promise.all(
    styles.slice(0, 6).map(async (style) => {
      try {
        const img = await renderPhotoreal({ prompt, style, guideImage: guide ?? undefined });
        return { style, dataUrl: `data:${img.mime};base64,${img.data.toString("base64")}` };
      } catch (e) {
        return { style, error: e instanceof Error ? e.message : "render failed" };
      }
    }),
  );

  return NextResponse.json({ renders });
}
