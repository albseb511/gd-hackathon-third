import { NextRequest, NextResponse } from "next/server";
import { photoTo3D } from "@/lib/photoTo3d";

export const maxDuration = 60;

function parseDataUrl(dataUrl: string): { data: string; mime: string } | null {
  const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
  return m ? { mime: m[1], data: m[2] } : null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { images?: string[] };
  const images = (body.images ?? [])
    .map(parseDataUrl)
    .filter((x): x is { data: string; mime: string } => x != null)
    .slice(0, 4);
  if (!images.length) return NextResponse.json({ error: "no images" }, { status: 400 });

  try {
    const design = await photoTo3D(images);
    return NextResponse.json({ design });
  } catch (e) {
    console.error("photo-to-3d error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reconstruction failed" },
      { status: 500 },
    );
  }
}
