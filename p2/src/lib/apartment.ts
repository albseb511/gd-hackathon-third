// Deterministic apartment generator. Slices the plot into rooms (recursive
// weighted binary split → always a valid, non-overlapping tiling), records a
// partition wall at every cut, then adds REAL doors/windows and balcony railings.
// The Draftsman agent only picks the config; this guarantees sound geometry.
import type {
  RoomDesign,
  Room,
  Wall,
  Opening,
  Furniture,
  MaterialDef,
  Vec2,
} from "@/scene/types";

export interface ApartmentConfig {
  bedrooms: number;
  bathrooms: number;
  balcony: boolean;
  plotW: number; // meters (overall footprint)
  plotD: number;
  height?: number;
  level?: number;
  philosophy?: string;
}

export const DEFAULT_APARTMENT: ApartmentConfig = {
  bedrooms: 2,
  bathrooms: 2,
  balcony: true,
  plotW: 10,
  plotD: 12,
  height: 2.9,
  level: 1,
  philosophy: "modern",
};

export function normalizeConfig(c: Partial<ApartmentConfig>): ApartmentConfig {
  return {
    bedrooms: clampInt(c.bedrooms ?? DEFAULT_APARTMENT.bedrooms, 1, 5),
    bathrooms: clampInt(c.bathrooms ?? DEFAULT_APARTMENT.bathrooms, 1, 4),
    balcony: c.balcony ?? DEFAULT_APARTMENT.balcony,
    plotW: clampNum(c.plotW ?? DEFAULT_APARTMENT.plotW, 5, 30),
    plotD: clampNum(c.plotD ?? DEFAULT_APARTMENT.plotD, 5, 30),
    height: clampNum(c.height ?? DEFAULT_APARTMENT.height!, 2.4, 4),
    level: c.level ?? 1,
    philosophy: c.philosophy ?? DEFAULT_APARTMENT.philosophy,
  };
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Rect = { min: Vec2; max: Vec2 };
type Item = { type: Room["type"]; name: string; weight: number };
type Cut = { axis: "x" | "z"; at: number; from: number; to: number };

const DOOR_W = 0.9;
const DOOR_H = 2.1;
const WIN_W = 1.4;
const WIN_H = 1.3;
const SILL = 0.9;
const EXT_THK = 0.18;
const PART_THK = 0.1;
const RAIL_H = 1.0;
const EPS = 1e-3;

const FLOOR_BY_TYPE: Record<Room["type"], { id: string; color: string; rough: number }> = {
  bedroom: { id: "floor_bedroom", color: "#b98a58", rough: 0.7 },
  hall: { id: "floor_hall", color: "#c2a878", rough: 0.65 },
  kitchen: { id: "floor_kitchen", color: "#d8d5cf", rough: 0.4 },
  bath: { id: "floor_bath", color: "#cdd7d7", rough: 0.35 },
  balcony: { id: "floor_balcony", color: "#9a9a92", rough: 0.9 },
  other: { id: "floor_other", color: "#c2a878", rough: 0.7 },
};

function itemsFor(cfg: ApartmentConfig): Item[] {
  const items: Item[] = [{ type: "hall", name: "Living / Hall", weight: 3.4 }];
  for (let i = 0; i < cfg.bedrooms; i++)
    items.push({ type: "bedroom", name: `Bedroom ${i + 1}`, weight: 2.3 });
  items.push({ type: "kitchen", name: "Kitchen", weight: 1.7 });
  for (let i = 0; i < cfg.bathrooms; i++)
    items.push({ type: "bath", name: `Bath ${i + 1}`, weight: 0.9 });
  if (cfg.balcony) items.push({ type: "balcony", name: "Balcony", weight: 1.2 });
  return items;
}

const sum = (a: Item[]) => a.reduce((s, i) => s + i.weight, 0);

// Recursive weighted slice: always cut the longer side; record the cut as a partition.
function slice(rect: Rect, items: Item[], rooms: (Item & { bounds: Rect })[], cuts: Cut[]) {
  if (items.length === 1) {
    rooms.push({ ...items[0], bounds: rect });
    return;
  }
  const total = sum(items);
  let acc = 0;
  let i = 0;
  while (i < items.length - 1 && acc + items[i].weight < total / 2) {
    acc += items[i].weight;
    i++;
  }
  const A = items.slice(0, Math.max(1, i));
  const B = items.slice(Math.max(1, i));
  const wA = sum(A);
  const frac = wA / (wA + sum(B));
  const rw = rect.max[0] - rect.min[0];
  const rd = rect.max[1] - rect.min[1];
  if (rw >= rd) {
    const cx = rect.min[0] + rw * frac;
    cuts.push({ axis: "x", at: cx, from: rect.min[1], to: rect.max[1] });
    slice({ min: [rect.min[0], rect.min[1]], max: [cx, rect.max[1]] }, A, rooms, cuts);
    slice({ min: [cx, rect.min[1]], max: [rect.max[0], rect.max[1]] }, B, rooms, cuts);
  } else {
    const cz = rect.min[1] + rd * frac;
    cuts.push({ axis: "z", at: cz, from: rect.min[0], to: rect.max[0] });
    slice({ min: [rect.min[0], rect.min[1]], max: [rect.max[0], cz] }, A, rooms, cuts);
    slice({ min: [rect.min[0], cz], max: [rect.max[0], rect.max[1]] }, B, rooms, cuts);
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

export function buildApartment(input: Partial<ApartmentConfig>): RoomDesign {
  const cfg = normalizeConfig(input);
  const W = cfg.plotW;
  const D = cfg.plotD;
  const H = cfg.height!;

  const laid: (Item & { bounds: Rect })[] = [];
  const cuts: Cut[] = [];
  slice({ min: [0, 0], max: [W, D] }, itemsFor(cfg), laid, cuts);

  const rooms: Room[] = laid.map((r, idx) => ({
    id: `room_${idx}`,
    name: r.name,
    type: r.type,
    bounds: r.bounds,
    floorMaterial: FLOOR_BY_TYPE[r.type].id,
  }));
  const roomOf = (idx: number) => laid[idx];

  const walls: Wall[] = [];
  const openings: Opening[] = [];

  // Partition walls from cuts.
  const cutWalls: { wall: Wall; cut: Cut }[] = [];
  cuts.forEach((c, i) => {
    const wall: Wall =
      c.axis === "x"
        ? { id: `pw_${i}`, from: [c.at, c.from], to: [c.at, c.to], height: H, thickness: PART_THK, material: "wall_partition", kind: "partition" }
        : { id: `pw_${i}`, from: [c.from, c.at], to: [c.to, c.at], height: H, thickness: PART_THK, material: "wall_partition", kind: "partition" };
    walls.push(wall);
    cutWalls.push({ wall, cut: c });
  });

  // Boundary walls per room edge (splits the perimeter; balcony edges → railing).
  let bwN = 0;
  rooms.forEach((room, idx) => {
    const { min, max } = room.bounds;
    const isBalcony = room.type === "balcony";
    const edges: { a: Vec2; b: Vec2; on: boolean }[] = [
      { a: [min[0], min[1]], b: [max[0], min[1]], on: near(min[1], 0) }, // south (z=0)
      { a: [min[0], max[1]], b: [max[0], max[1]], on: near(max[1], D) }, // north (z=D)
      { a: [min[0], min[1]], b: [min[0], max[1]], on: near(min[0], 0) }, // west (x=0)
      { a: [max[0], min[1]], b: [max[0], max[1]], on: near(max[0], W) }, // east (x=W)
    ];
    for (const e of edges) {
      if (!e.on) continue;
      const wall: Wall = {
        id: `bw_${bwN++}`,
        from: e.a,
        to: e.b,
        height: isBalcony ? RAIL_H : H,
        thickness: EXT_THK,
        material: isBalcony ? "wall_railing" : "wall_exterior",
        kind: isBalcony ? "railing" : "exterior",
      };
      walls.push(wall);
      // Window on long exterior walls (not railings), centered.
      const len = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
      if (!isBalcony && len >= WIN_W + 0.8 && room.type !== "bath") {
        openings.push({
          id: `op_win_${wall.id}`,
          type: "window",
          wallId: wall.id,
          offset: len / 2 - WIN_W / 2,
          size: [WIN_W, WIN_H],
          sill: SILL,
        });
      }
    }
    void idx;
  });

  // A door per room: prefer the widest adjacent partition; else an exterior wall.
  rooms.forEach((room, idx) => {
    const b = roomOf(idx).bounds;
    let best: { wall: Wall; alongStart: number; ov: number; center: number } | null = null;
    for (const { wall, cut } of cutWalls) {
      if (cut.axis === "x") {
        if (!(near(cut.at, b.min[0]) || near(cut.at, b.max[0]))) continue;
        const ov = overlap(cut.from, cut.to, b.min[1], b.max[1]);
        const center = Math.max(cut.from, b.min[1]) + ov / 2;
        if (ov > 0 && (!best || ov > best.ov)) best = { wall, alongStart: cut.from, ov, center };
      } else {
        if (!(near(cut.at, b.min[1]) || near(cut.at, b.max[1]))) continue;
        const ov = overlap(cut.from, cut.to, b.min[0], b.max[0]);
        const center = Math.max(cut.from, b.min[0]) + ov / 2;
        if (ov > 0 && (!best || ov > best.ov)) best = { wall, alongStart: cut.from, ov, center };
      }
    }
    if (best && best.ov >= 0.7) {
      const dw = Math.max(0.6, Math.min(DOOR_W, best.ov - 0.1));
      openings.push({ id: `op_door_${room.id}`, type: "door", wallId: best.wall.id, offset: best.center - best.alongStart - dw / 2, size: [dw, DOOR_H] });
      return;
    }
    // Fallback: an entrance on the room's longest exterior wall.
    const extWalls = walls.filter((w) => w.kind === "exterior" && onRoomEdge(w, b));
    const longest = extWalls.sort((p, q) => wallLen(q) - wallLen(p))[0];
    if (longest) {
      const len = wallLen(longest);
      const dw = Math.max(0.6, Math.min(DOOR_W, len - 0.2));
      openings.push({ id: `op_door_${room.id}`, type: "door", wallId: longest.id, offset: len / 2 - dw / 2, size: [dw, DOOR_H] });
    }
  });

  // Per-room + surface materials.
  const materials: MaterialDef[] = [
    { id: "wall_exterior", color: "#e7e3db", roughness: 0.95 },
    { id: "wall_partition", color: "#efece6", roughness: 0.95 },
    { id: "wall_railing", color: "#c9c2b6", roughness: 0.8 },
    { id: "ceiling_white", color: "#f5f5f2", roughness: 1 },
  ];
  for (const t of Object.keys(FLOOR_BY_TYPE) as Room["type"][]) {
    const f = FLOOR_BY_TYPE[t];
    materials.push({ id: f.id, color: f.color, roughness: f.rough });
  }

  // Seed a few signature pieces so the flat reads as furnished.
  const furniture: Furniture[] = [];
  let fN = 0;
  for (const room of rooms) {
    const cx = (room.bounds.min[0] + room.bounds.max[0]) / 2;
    const cz = (room.bounds.min[1] + room.bounds.max[1]) / 2;
    if (room.type === "bedroom") {
      furniture.push({ id: `f_${fN++}`, catalogId: "bed_double", pos: [cx, 0, cz], rot: [0, 0, 0], scale: [1, 1, 1] });
    } else if (room.type === "hall") {
      furniture.push({ id: `f_${fN++}`, catalogId: "sofa_3seat", pos: [cx, 0, cz], rot: [0, 0, 0], scale: [1, 1, 1] });
      furniture.push({ id: `f_${fN++}`, catalogId: "coffee_table", pos: [cx, 0, cz + 0.9], rot: [0, 0, 0], scale: [1, 1, 1] });
    } else if (room.type === "kitchen") {
      furniture.push({ id: `f_${fN++}`, catalogId: "dining_table", pos: [cx, 0, cz], rot: [0, 0, 0], scale: [1, 1, 1] });
    }
  }

  return {
    room: { dims: { w: W, d: D, h: H }, floor: { materialId: "floor_hall" }, ceiling: { materialId: "ceiling_white" } },
    walls,
    openings,
    furniture,
    materials,
    lights: [],
    cameras: [],
    style: { philosophy: cfg.philosophy!, palette: ["#e7e3db", "#c2a878", "#7a8b7a"], mood: "bright" },
    rooms,
    plot: { w: W, d: D },
    level: cfg.level,
  };
}

function wallLen(w: Wall): number {
  return Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
}
function onRoomEdge(w: Wall, b: Rect): boolean {
  const onX = near(w.from[0], w.to[0]) && (near(w.from[0], b.min[0]) || near(w.from[0], b.max[0]));
  const onZ = near(w.from[1], w.to[1]) && (near(w.from[1], b.min[1]) || near(w.from[1], b.max[1]));
  if (onX) return overlap(w.from[1], w.to[1], b.min[1], b.max[1]) > EPS;
  if (onZ) return overlap(w.from[0], w.to[0], b.min[0], b.max[0]) > EPS;
  return false;
}
