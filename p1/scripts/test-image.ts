// Standalone Artist agent smoke test: new shot, edit shot, 3-way parallel.
// Run: npx tsx scripts/test-image.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load GEMINI_API_KEY from p1/.env without dotenv.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not found in .env");
  process.exit(1);
}

const ART_STYLE =
  "hand-painted graphic novel realism — realistic proportions and lighting rendered in flat painterly cel-shaded panels, bold shadows, muted cinematic palette, rain-slick neon noir";

const TIMEOUT_MS = 30_000;

async function main() {
  // Import after env is loaded (genai() reads GEMINI_API_KEY lazily anyway).
  const { generateImage } = await import("../src/lib/artist");

  // (a) single new shot
  let t0 = performance.now();
  const scene = await generateImage({
    prompt: "a rain-soaked detective under a neon sign, night street",
    artStyle: ART_STYLE,
    shot: "new",
    timeoutMs: TIMEOUT_MS,
  });
  const sceneMs = Math.round(performance.now() - t0);
  writeFileSync("/tmp/p1-test-scene.jpg", scene.data);
  console.log(
    `[new]  ${sceneMs}ms  mime=${scene.mime}  bytes=${scene.data.length}  -> /tmp/p1-test-scene.jpg`,
  );

  // (b) edit shot using the scene as the previous image
  t0 = performance.now();
  const edit = await generateImage({
    prompt: "the detective has drawn a revolver, neon sign now flickering red",
    artStyle: ART_STYLE,
    shot: "edit",
    previousImage: { data: scene.data, mime: scene.mime },
    timeoutMs: TIMEOUT_MS,
  });
  const editMs = Math.round(performance.now() - t0);
  writeFileSync("/tmp/p1-test-edit.jpg", edit.data);
  console.log(
    `[edit] ${editMs}ms  mime=${edit.mime}  bytes=${edit.data.length}  -> /tmp/p1-test-edit.jpg`,
  );

  // (c) 3 parallel new shots
  const prompts = [
    "a shadowy jazz bar interior, saxophonist on stage, cigarette haze",
    "a rooftop chase across wet fire escapes, city lights below",
    "a cluttered detective office at dawn, case files pinned to the wall",
  ];
  const wall0 = performance.now();
  const results = await Promise.all(
    prompts.map(async (prompt, i) => {
      const p0 = performance.now();
      const img = await generateImage({
        prompt,
        artStyle: ART_STYLE,
        shot: "new",
        timeoutMs: TIMEOUT_MS,
      });
      const ms = Math.round(performance.now() - p0);
      writeFileSync(`/tmp/p1-test-parallel-${i + 1}.jpg`, img.data);
      return { i: i + 1, ms, bytes: img.data.length };
    }),
  );
  const wallMs = Math.round(performance.now() - wall0);
  for (const r of results) {
    console.log(`[par${r.i}] ${r.ms}ms  bytes=${r.bytes}`);
  }
  console.log(`[parallel-wall] ${wallMs}ms for 3 concurrent generations`);
}

main().catch((err) => {
  console.error("test-image failed:", err);
  process.exit(1);
});
