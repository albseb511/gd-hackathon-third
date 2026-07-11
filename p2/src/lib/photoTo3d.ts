// Photo → 3D. Gemini 3.5 Flash vision estimates room dimensions, surface colors
// and furniture from photos, then maps the result onto a RoomDesign scene-graph.
import type { Part } from "@google/genai";
import { z } from "zod";
import { genai, withTiming } from "@/lib/gemini";
import { MODELS } from "@/lib/models";
import { CATALOG } from "@/scene/catalog";
import { emptyRoom } from "@/scene/defaults";
import { actionToPatches } from "@/scene/tools";
import { applyPatches } from "@/scene/patch";
import type { RoomDesign } from "@/scene/types";

const VisionRoom = z.object({
  width: z.number().min(1).max(15),
  depth: z.number().min(1).max(15),
  height: z.number().min(2).max(5).optional(),
  philosophy: z.string().optional(),
  wallColor: z.string().optional(),
  floorColor: z.string().optional(),
  furniture: z
    .array(
      z.object({
        catalogId: z.string(),
        x: z.number(),
        z: z.number(),
        rotationDeg: z.number().optional(),
      }),
    )
    .default([]),
});

const CATALOG_LIST = CATALOG.map((c) => `${c.id} (${c.label})`).join(", ");

const PROMPT = `You are a spatial-reasoning agent. From the photo(s) of a real room, estimate:
- width, depth (meters) and height (meters, ~2.4-3),
- the dominant design philosophy (one word, e.g. scandinavian, modern, industrial),
- wallColor and floorColor as hex strings,
- the furniture present, choosing the CLOSEST id from this catalog only: ${CATALOG_LIST}.
For each furniture item give approximate floor position x in [0,width], z in [0,depth], and rotationDeg.
Return ONLY JSON: {"width":n,"depth":n,"height":n,"philosophy":s,"wallColor":"#..","floorColor":"#..","furniture":[{"catalogId":s,"x":n,"z":n,"rotationDeg":n}]}`;

function stripFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

export async function photoTo3D(
  images: { data: string; mime: string }[],
): Promise<RoomDesign> {
  return withTiming("photo-to-3d", { model: MODELS.text }, async () => {
    const parts: Part[] = images.map((im) => ({
      inlineData: { data: im.data, mimeType: im.mime },
    }));

    const call = async (extra: string) => {
      parts.push({ text: PROMPT + extra });
      const res = await genai().models.generateContent({
        model: MODELS.text,
        contents: [{ role: "user", parts }],
        config: { responseMimeType: "application/json", temperature: 0.4 },
      });
      parts.pop();
      return res.text ?? "";
    };

    let parsed = VisionRoom.safeParse(JSON.parse(stripFence(await call(""))));
    if (!parsed.success) {
      parsed = VisionRoom.safeParse(
        JSON.parse(stripFence(await call("\n\nReturn ONLY valid JSON matching the schema."))),
      );
    }
    if (!parsed.success) throw new Error(`vision output invalid: ${parsed.error.message}`);
    const v = parsed.data;

    // Build the scene-graph.
    let design = emptyRoom(v.width, v.depth, v.height ?? 2.7);
    if (v.philosophy) design.style.philosophy = v.philosophy;

    const colorPatches = [];
    if (v.wallColor) {
      const r = actionToPatches("set_material", { target: "wall", color: v.wallColor }, design);
      colorPatches.push(...r.patches);
    }
    if (v.floorColor) {
      const r = actionToPatches("set_material", { target: "floor", color: v.floorColor }, design);
      colorPatches.push(...r.patches);
    }
    design = applyPatches(design, colorPatches);

    // Furniture (clamped + catalog-validated by the tool; unknown ids drop to []).
    for (const f of v.furniture) {
      const { patches } = actionToPatches("add_furniture", f, design);
      if (patches.length) design = applyPatches(design, patches);
    }
    if (v.wallColor || v.floorColor) {
      design.style.palette = [v.wallColor, v.floorColor].filter(Boolean) as string[];
    }
    return design;
  });
}
