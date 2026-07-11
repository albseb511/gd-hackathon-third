// M0 smoke test for the NB2 Lite render pipeline. Run: npm run test:render
import { mkdirSync, writeFileSync } from "node:fs";
import { renderPhotoreal } from "@/lib/render";

async function main() {
  const t0 = Date.now();
  const img = await renderPhotoreal({
    prompt:
      "A cozy Scandinavian living room, oak floor, sage-green wall, large window with soft daylight, linen sofa, minimal styling.",
    style: "photorealistic interior architectural photography, natural light, shallow depth of field",
  });
  const ms = Date.now() - t0;

  if (!img.data?.length) throw new Error("empty image buffer");

  mkdirSync("scripts/out", { recursive: true });
  const ext = (img.mime.split("/")[1] || "png").replace("jpeg", "jpg");
  const path = `scripts/out/render.${ext}`;
  writeFileSync(path, img.data);
  console.log(`OK render: ${img.data.length} bytes (${img.mime}) in ${ms}ms -> ${path}`);
}

main().catch((e) => {
  console.error("FAIL test-render:", e);
  process.exit(1);
});
