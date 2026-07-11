// Asserts the apartment generator: valid, non-overlapping multi-room 2BHK with
// real doors. Run: npm run test:apartment
import { buildApartment } from "@/lib/apartment";
import type { Room } from "@/scene/types";

function box(r: Room) {
  return r.bounds;
}

function main() {
  const d = buildApartment({ bedrooms: 2, bathrooms: 2, balcony: true, plotW: 10, plotD: 12 });
  const rooms = d.rooms ?? [];
  const has = (t: Room["type"]) => rooms.some((r) => r.type === t);

  if (rooms.filter((r) => r.type === "bedroom").length < 2) throw new Error("expected ≥2 bedrooms");
  for (const t of ["hall", "kitchen", "bath", "balcony"] as Room["type"][])
    if (!has(t)) throw new Error(`missing ${t}`);

  // All rooms inside the plot.
  for (const r of rooms) {
    const b = box(r);
    if (b.min[0] < -1e-6 || b.max[0] > 10 + 1e-6 || b.min[1] < -1e-6 || b.max[1] > 12 + 1e-6)
      throw new Error(`room ${r.name} outside plot`);
  }
  // Non-overlapping.
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const a = box(rooms[i]), b = box(rooms[j]);
      const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
      const oz = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      if (ox > 1e-3 && oz > 1e-3) throw new Error(`overlap: ${rooms[i].name} & ${rooms[j].name}`);
    }
  // Every room has a door.
  for (const r of rooms) {
    if (!d.openings.some((o) => o.type === "door" && o.id === `op_door_${r.id}`))
      throw new Error(`room ${r.name} has no door`);
  }
  // Every opening references an existing wall; balcony has railings.
  const wallIds = new Set(d.walls.map((w) => w.id));
  for (const o of d.openings) if (!wallIds.has(o.wallId)) throw new Error(`opening ${o.id} → missing wall`);
  if (!d.walls.some((w) => w.kind === "railing")) throw new Error("balcony has no railing walls");

  const doors = d.openings.filter((o) => o.type === "door").length;
  const wins = d.openings.filter((o) => o.type === "window").length;
  console.log(
    `OK apartment: ${rooms.length} rooms [${rooms.map((r) => r.type).join(", ")}], ${d.walls.length} walls, ${doors} doors, ${wins} windows, ${d.furniture.length} furniture.`,
  );
}

main();
