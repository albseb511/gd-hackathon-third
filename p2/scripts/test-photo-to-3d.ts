// Asserts photo→3D: a room image → a valid RoomDesign. Run: npm run test:photo
// Uses the NB2 render from test:render as a stand-in room photo if present.
import { existsSync, readFileSync } from "node:fs";
import { photoTo3D } from "@/lib/photoTo3d";

async function main() {
  const path = "scripts/out/render.jpg";
  if (!existsSync(path)) {
    console.log(`SKIP photo-to-3d: no sample at ${path} (run "npm run test:render" first).`);
    return;
  }
  const data = readFileSync(path).toString("base64");
  const design = await photoTo3D([{ data, mime: "image/jpeg" }]);

  const { w, d, h } = design.room.dims;
  if (w < 1 || w > 12 || d < 1 || d > 12) throw new Error(`implausible dims ${w}×${d}`);
  if (design.walls.length < 1) throw new Error("no walls produced");
  for (const f of design.furniture) {
    if (f.pos[0] < 0 || f.pos[0] > w || f.pos[2] < 0 || f.pos[2] > d) {
      throw new Error(`furniture ${f.id} out of bounds`);
    }
  }
  console.log(
    `OK photo-to-3d: ${w}×${d}×${h}m, ${design.walls.length} walls, ${design.furniture.length} furniture, "${design.style.philosophy}".`,
  );
}

main().catch((e) => {
  console.error("FAIL test-photo-to-3d:", e);
  process.exit(1);
});
