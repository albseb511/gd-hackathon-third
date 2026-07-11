// The scene-mutation tool registry — the ONE tool set, two transports (Live
// function-calling + agent actions). Each tool = Zod schema (validation) +
// Gemini FunctionDeclaration (Live) + toPatches (reducer input).
import { z } from "zod";
import { Type, type FunctionDeclaration } from "@google/genai";
import { nanoid } from "nanoid";
import type { RoomDesign } from "./types";
import type { Patch } from "./patch";
import { emptyRoom } from "./defaults";
import { catalogEntry, CATALOG_IDS } from "./catalog";
import { buildApartment } from "@/lib/apartment";

const deg2rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDef<A = any> {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  declaration: FunctionDeclaration;
  toPatches: (args: A, design: RoomDesign) => Patch[];
}

function clampToRoom(
  design: RoomDesign,
  catalogId: string,
  x: number,
  z: number,
): [number, number] {
  const e = catalogEntry(catalogId);
  const mx = e ? e.footprint[0] / 2 : 0.3;
  const mz = e ? e.footprint[1] / 2 : 0.3;
  const { w, d } = design.room.dims;
  return [clamp(x, mx, w - mx), clamp(z, mz, d - mz)];
}

function materialIdFor(design: RoomDesign, target: "floor" | "wall" | "ceiling"): string {
  if (target === "floor") return design.room.floor.materialId;
  if (target === "ceiling") return design.room.ceiling.materialId;
  return design.walls[0]?.material ?? "paint_wall";
}

export const TOOLS: ToolDef[] = [
  {
    name: "create_room",
    description:
      "Create or reset the room shell to a rectangular room of the given size in meters. Resets walls/floor/ceiling. Use when starting a new design or changing room dimensions.",
    schema: z.object({
      width: z.number().min(1).max(20),
      depth: z.number().min(1).max(20),
      height: z.number().min(2).max(6).optional(),
      philosophy: z.string().optional(),
    }),
    declaration: {
      name: "create_room",
      description: "Create/reset a rectangular room (meters).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          width: { type: Type.NUMBER, description: "room width in meters" },
          depth: { type: Type.NUMBER, description: "room depth in meters" },
          height: { type: Type.NUMBER, description: "ceiling height, default 2.7" },
          philosophy: { type: Type.STRING, description: "design philosophy, e.g. scandinavian" },
        },
        required: ["width", "depth"],
      },
    },
    toPatches: (a, _d) => {
      const r = emptyRoom(a.width, a.depth, a.height ?? 2.7);
      if (a.philosophy) r.style.philosophy = a.philosophy;
      return [{ op: "replace", path: "", value: r }];
    },
  },
  {
    name: "add_furniture",
    description: `Add a furniture item from the catalog at floor position (x,z) meters. Catalog ids: ${CATALOG_IDS.join(", ")}.`,
    schema: z.object({
      catalogId: z.string(),
      x: z.number(),
      z: z.number(),
      rotationDeg: z.number().optional(),
      id: z.string().optional(),
    }),
    declaration: {
      name: "add_furniture",
      description: "Add a catalog furniture item at (x,z) meters.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          catalogId: { type: Type.STRING, enum: CATALOG_IDS },
          x: { type: Type.NUMBER },
          z: { type: Type.NUMBER },
          rotationDeg: { type: Type.NUMBER, description: "yaw in degrees" },
        },
        required: ["catalogId", "x", "z"],
      },
    },
    toPatches: (a, d) => {
      if (!catalogEntry(a.catalogId)) return [];
      const [cx, cz] = clampToRoom(d, a.catalogId, a.x, a.z);
      return [
        {
          op: "add",
          path: "/furniture/-",
          value: {
            id: a.id ?? `furn_${nanoid(6)}`,
            catalogId: a.catalogId,
            pos: [cx, 0, cz],
            rot: [0, deg2rad(a.rotationDeg ?? 0), 0],
            scale: [1, 1, 1],
          },
        },
      ];
    },
  },
  {
    name: "move_furniture",
    description: "Move/rotate an existing furniture item by id.",
    schema: z.object({
      id: z.string(),
      x: z.number().optional(),
      z: z.number().optional(),
      rotationDeg: z.number().optional(),
    }),
    declaration: {
      name: "move_furniture",
      description: "Move/rotate furniture by id.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          x: { type: Type.NUMBER },
          z: { type: Type.NUMBER },
          rotationDeg: { type: Type.NUMBER },
        },
        required: ["id"],
      },
    },
    toPatches: (a, d) => {
      const idx = d.furniture.findIndex((f) => f.id === a.id);
      if (idx < 0) return [];
      const item = d.furniture[idx];
      const patches: Patch[] = [];
      if (a.x != null || a.z != null) {
        const [cx, cz] = clampToRoom(d, item.catalogId ?? "", a.x ?? item.pos[0], a.z ?? item.pos[2]);
        patches.push({ op: "replace", path: `/furniture/${idx}/pos`, value: [cx, item.pos[1], cz] });
      }
      if (a.rotationDeg != null) {
        patches.push({ op: "replace", path: `/furniture/${idx}/rot`, value: [0, deg2rad(a.rotationDeg), 0] });
      }
      return patches;
    },
  },
  {
    name: "remove_furniture",
    description: "Remove a furniture item by id.",
    schema: z.object({ id: z.string() }),
    declaration: {
      name: "remove_furniture",
      description: "Remove furniture by id.",
      parameters: {
        type: Type.OBJECT,
        properties: { id: { type: Type.STRING } },
        required: ["id"],
      },
    },
    toPatches: (a, d) => {
      const idx = d.furniture.findIndex((f) => f.id === a.id);
      return idx < 0 ? [] : [{ op: "remove", path: `/furniture/${idx}` }];
    },
  },
  {
    name: "set_material",
    description: "Set the color (and optional roughness) of the floor, walls, or ceiling. Color is a hex string.",
    schema: z.object({
      target: z.enum(["floor", "wall", "ceiling"]),
      color: z.string(),
      roughness: z.number().min(0).max(1).optional(),
    }),
    declaration: {
      name: "set_material",
      description: "Set floor/wall/ceiling color.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          target: { type: Type.STRING, enum: ["floor", "wall", "ceiling"] },
          color: { type: Type.STRING, description: "hex color, e.g. #7a8b7a" },
          roughness: { type: Type.NUMBER },
        },
        required: ["target", "color"],
      },
    },
    toPatches: (a, d) => {
      const matId = materialIdFor(d, a.target);
      const idx = d.materials.findIndex((m) => m.id === matId);
      if (idx < 0) {
        return [{ op: "add", path: "/materials/-", value: { id: matId, color: a.color, roughness: a.roughness ?? 0.9 } }];
      }
      const patches: Patch[] = [{ op: "replace", path: `/materials/${idx}/color`, value: a.color }];
      if (a.roughness != null) patches.push({ op: "replace", path: `/materials/${idx}/roughness`, value: a.roughness });
      return patches;
    },
  },
  {
    name: "set_palette",
    description: "Set the design color palette (array of hex colors).",
    schema: z.object({ colors: z.array(z.string()).min(1) }),
    declaration: {
      name: "set_palette",
      description: "Set the palette hex colors.",
      parameters: {
        type: Type.OBJECT,
        properties: { colors: { type: Type.ARRAY, items: { type: Type.STRING } } },
        required: ["colors"],
      },
    },
    toPatches: (a) => [{ op: "replace", path: "/style/palette", value: a.colors }],
  },
  {
    name: "add_light",
    description: "Add a point light at floor position (x,z) meters, near the ceiling.",
    schema: z.object({
      x: z.number(),
      z: z.number(),
      intensity: z.number().optional(),
      color: z.string().optional(),
    }),
    declaration: {
      name: "add_light",
      description: "Add a ceiling point light at (x,z).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          x: { type: Type.NUMBER },
          z: { type: Type.NUMBER },
          intensity: { type: Type.NUMBER },
          color: { type: Type.STRING },
        },
        required: ["x", "z"],
      },
    },
    toPatches: (a, d) => [
      {
        op: "add",
        path: "/lights/-",
        value: {
          id: `light_${nanoid(6)}`,
          type: "point",
          pos: [a.x, d.room.dims.h - 0.3, a.z],
          intensity: a.intensity ?? 0.6,
          color: a.color,
        },
      },
    ],
  },
  {
    name: "create_apartment",
    description:
      "Create a full multi-room apartment (e.g. a 2 BHK) with rooms, partition walls, real doors, windows and an optional balcony. Resets the whole design.",
    schema: z.object({
      bedrooms: z.number().min(1).max(5).optional(),
      bathrooms: z.number().min(1).max(4).optional(),
      balcony: z.boolean().optional(),
      plotW: z.number().min(5).max(30).optional(),
      plotD: z.number().min(5).max(30).optional(),
      height: z.number().min(2.4).max(4).optional(),
      philosophy: z.string().optional(),
    }),
    declaration: {
      name: "create_apartment",
      description: "Generate a multi-room apartment (BHK).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          bedrooms: { type: Type.NUMBER, description: "number of bedrooms (BHK)" },
          bathrooms: { type: Type.NUMBER },
          balcony: { type: Type.BOOLEAN },
          plotW: { type: Type.NUMBER, description: "plot width in meters" },
          plotD: { type: Type.NUMBER, description: "plot depth in meters" },
          height: { type: Type.NUMBER },
          philosophy: { type: Type.STRING },
        },
      },
    },
    toPatches: (a) => [{ op: "replace", path: "", value: buildApartment(a) }],
  },
  {
    name: "add_wall",
    description: "Add a wall segment between two floor points (meters).",
    schema: z.object({
      fromX: z.number(),
      fromZ: z.number(),
      toX: z.number(),
      toZ: z.number(),
      height: z.number().optional(),
      thickness: z.number().optional(),
    }),
    declaration: {
      name: "add_wall",
      description: "Add a wall from (fromX,fromZ) to (toX,toZ).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          fromX: { type: Type.NUMBER }, fromZ: { type: Type.NUMBER },
          toX: { type: Type.NUMBER }, toZ: { type: Type.NUMBER },
          height: { type: Type.NUMBER }, thickness: { type: Type.NUMBER },
        },
        required: ["fromX", "fromZ", "toX", "toZ"],
      },
    },
    toPatches: (a, d) => [
      {
        op: "add",
        path: "/walls/-",
        value: {
          id: `wall_${nanoid(6)}`,
          from: [a.fromX, a.fromZ],
          to: [a.toX, a.toZ],
          height: a.height ?? d.room.dims.h,
          thickness: a.thickness ?? 0.1,
          kind: "partition",
          material: "wall_partition",
        },
      },
    ],
  },
  {
    name: "edit_wall",
    description: "Move or resize an existing wall by id.",
    schema: z.object({
      id: z.string(),
      fromX: z.number().optional(), fromZ: z.number().optional(),
      toX: z.number().optional(), toZ: z.number().optional(),
      thickness: z.number().optional(), height: z.number().optional(),
    }),
    declaration: {
      name: "edit_wall",
      description: "Edit wall geometry by id.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          fromX: { type: Type.NUMBER }, fromZ: { type: Type.NUMBER },
          toX: { type: Type.NUMBER }, toZ: { type: Type.NUMBER },
          thickness: { type: Type.NUMBER }, height: { type: Type.NUMBER },
        },
        required: ["id"],
      },
    },
    toPatches: (a, d) => {
      const idx = d.walls.findIndex((w) => w.id === a.id);
      if (idx < 0) return [];
      const w = d.walls[idx];
      const patches: Patch[] = [];
      const from: [number, number] = [a.fromX ?? w.from[0], a.fromZ ?? w.from[1]];
      const to: [number, number] = [a.toX ?? w.to[0], a.toZ ?? w.to[1]];
      if (a.fromX != null || a.fromZ != null) patches.push({ op: "replace", path: `/walls/${idx}/from`, value: from });
      if (a.toX != null || a.toZ != null) patches.push({ op: "replace", path: `/walls/${idx}/to`, value: to });
      if (a.thickness != null) patches.push({ op: "replace", path: `/walls/${idx}/thickness`, value: a.thickness });
      if (a.height != null) patches.push({ op: "replace", path: `/walls/${idx}/height`, value: a.height });
      return patches;
    },
  },
  {
    name: "remove_wall",
    description: "Remove a wall by id.",
    schema: z.object({ id: z.string() }),
    declaration: {
      name: "remove_wall",
      description: "Remove a wall by id.",
      parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ["id"] },
    },
    toPatches: (a, d) => {
      const idx = d.walls.findIndex((w) => w.id === a.id);
      return idx < 0 ? [] : [{ op: "remove", path: `/walls/${idx}` }];
    },
  },
  {
    name: "add_opening",
    description: "Add a door or window on a wall. offset = meters along the wall from its start.",
    schema: z.object({
      wallId: z.string(),
      type: z.enum(["door", "window"]),
      offset: z.number(),
      width: z.number(),
      height: z.number(),
      sill: z.number().optional(),
    }),
    declaration: {
      name: "add_opening",
      description: "Add a door/window on a wall.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          wallId: { type: Type.STRING },
          type: { type: Type.STRING, enum: ["door", "window"] },
          offset: { type: Type.NUMBER }, width: { type: Type.NUMBER },
          height: { type: Type.NUMBER }, sill: { type: Type.NUMBER },
        },
        required: ["wallId", "type", "offset", "width", "height"],
      },
    },
    toPatches: (a, d) => {
      if (!d.walls.some((w) => w.id === a.wallId)) return [];
      return [
        {
          op: "add",
          path: "/openings/-",
          value: {
            id: `op_${nanoid(6)}`,
            type: a.type,
            wallId: a.wallId,
            offset: a.offset,
            size: [a.width, a.height],
            sill: a.type === "window" ? (a.sill ?? 0.9) : undefined,
          },
        },
      ];
    },
  },
  {
    name: "remove_opening",
    description: "Remove a door/window by id.",
    schema: z.object({ id: z.string() }),
    declaration: {
      name: "remove_opening",
      description: "Remove an opening by id.",
      parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ["id"] },
    },
    toPatches: (a, d) => {
      const idx = d.openings.findIndex((o) => o.id === a.id);
      return idx < 0 ? [] : [{ op: "remove", path: `/openings/${idx}` }];
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const LIVE_FUNCTION_DECLARATIONS = TOOLS.map((t) => t.declaration);

// Validate + convert one agent/Live action into patches. Returns [] on invalid.
export function actionToPatches(
  name: string,
  rawArgs: unknown,
  design: RoomDesign,
): { patches: Patch[]; error?: string } {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { patches: [], error: `unknown tool: ${name}` };
  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) return { patches: [], error: `${name}: ${parsed.error.message}` };
  return { patches: tool.toPatches(parsed.data, design) };
}
