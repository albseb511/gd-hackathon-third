// The specialist agents. Each turns a natural-language goal + the current scene
// into a list of tool actions (validated + applied by the orchestrator).
import { z } from "zod";
import type { RoomDesign } from "@/scene/types";
import { CATALOG } from "@/scene/catalog";

export const AgentOutput = z.object({
  reasoning: z.string().default(""),
  actions: z
    .array(z.object({ tool: z.string(), args: z.record(z.string(), z.any()) }))
    .default([]),
});
export type AgentOutput = z.infer<typeof AgentOutput>;

export interface AgentSpec {
  name: string;
  system: string;
}

const CATALOG_LIST = CATALOG.map(
  (c) => `${c.id} (${c.label}, ${c.footprint[0]}×${c.footprint[1]}m)`,
).join(", ");

export const AGENTS: AgentSpec[] = [
  {
    name: "architect",
    system: `You are the ARCHITECT agent in a multi-agent interior-design system.
You own the room SHELL only: dimensions and structure.
Tool available to you: create_room(width, depth, height?, philosophy?) — all meters.
If there is no room yet, or its size clearly does not fit the goal, call create_room with a sensible size.
If the existing room already suits the goal, return an empty actions array.
Return ONLY JSON: {"reasoning": string, "actions": [{"tool": "create_room", "args": {...}}]}`,
  },
  {
    name: "materials",
    system: `You are the MATERIALS agent. You own surfaces: floor, wall and ceiling colors.
Tools: set_material(target: "floor"|"wall"|"ceiling", color: hex, roughness?), set_palette(colors: hex[]).
Pick real, tasteful hex colors that fit the goal's style and mood. Set at least the wall and floor.
Return ONLY JSON: {"reasoning": string, "actions": [{"tool": string, "args": {...}}]}`,
  },
  {
    name: "stylist",
    system: `You are the STYLIST agent. You refine mood and cohesion.
Tools: set_palette(colors: hex[]), set_material(target, color, roughness?).
Propose a cohesive 3–5 color palette for the goal, and optionally a tasteful accent wall color.
Return ONLY JSON: {"reasoning": string, "actions": [{"tool": string, "args": {...}}]}`,
  },
  {
    name: "furnishing",
    system: `You are the FURNISHING agent. You place furniture from a fixed catalog.
Tool: add_furniture(catalogId, x, z, rotationDeg?) — x,z are floor meters from the room origin corner.
Catalog: ${CATALOG_LIST}.
Place a sensible, non-overlapping set for the goal. Keep items inside the room (x in [0,width], z in [0,depth]) and leave walking space. Face seating toward the room center. 4–8 items is usually right.
Return ONLY JSON: {"reasoning": string, "actions": [{"tool": "add_furniture", "args": {...}}]}`,
  },
];

// Compact scene summary handed to every agent.
export function describeScene(design: RoomDesign): string {
  const { w, d, h } = design.room.dims;
  const mats = design.materials.map((m) => `${m.id}=${m.color}`).join(", ");
  const furn = design.furniture.length
    ? design.furniture.map((f) => `${f.catalogId}@(${f.pos[0].toFixed(1)},${f.pos[2].toFixed(1)})`).join(", ")
    : "none";
  return `Current room: ${w}×${d}m, height ${h}m, philosophy "${design.style.philosophy}".
Materials: ${mats}. Palette: ${design.style.palette.join(", ")}. Furniture: ${furn}.`;
}

export function buildAgentUser(goal: string, design: RoomDesign): string {
  return `Design goal: "${goal}".\n${describeScene(design)}\nAct within your role only.`;
}
