// Generates the three prebuilt story outlines into src/lib/prebuilt/*.json.
// Run from p1/ with: npx tsx scripts/gen-outlines.ts

import fs from "node:fs";
import path from "node:path";
import {
  generateOutline,
  outlineSchema,
} from "../src/lib/storyEngine/outline";
import type { StoryOutline } from "../src/lib/storyEngine/types";

// Load p1/.env by hand (no dotenv dependency).
function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(["'])(.*)\1$/, "$2");
  }
}

interface Spec {
  id: "noir" | "fantasy" | "starship";
  file: string;
  premise: string;
}

const SPECS: Spec[] = [
  {
    id: "noir",
    file: "noir.json",
    premise:
      'A rain-soaked neo-noir missing-person thriller in a coastal city. A private investigator takes one last case: someone the city wants forgotten has vanished, and every lead is owned by somebody dangerous. Corrupt cops, a waterfront syndicate, and a client who is lying. Palette accent to append to the art style: "rain-slick neon noir palette".',
  },
  {
    id: "fantasy",
    file: "fantasy.json",
    premise:
      'A warm high-fantasy adventure: a cursed harvest festival in a mountain hold. The first snow is falling, the granaries are blighted overnight, and something old under the mountain is awake. Hearth-fires, stubborn clanfolk, and a curse that must be broken before the festival\'s final night. Palette accent to append to the art style: "warm oil-paint fantasy palette".',
  },
  {
    id: "starship",
    file: "starship.json",
    premise:
      'The story title MUST be exactly "Starship". A crippled colony ship drifting between stars with 6 hours of life support left. The drive is dead, the captain is missing, and the damage pattern says sabotage — someone aboard wanted this. Claustrophobic corridors, a distrustful skeleton crew, and a countdown nobody can pause. Palette accent to append to the art style: "retro-futurist NASA-punk palette".',
  },
];

async function generateOne(spec: Spec): Promise<{ outline: StoryOutline; strict: boolean }> {
  try {
    return { outline: await generateOutline(spec.premise), strict: true };
  } catch (err) {
    console.warn(
      `[gen-outlines] ${spec.id}: strict generation failed twice, retrying with relaxed schema…`,
      err instanceof Error ? err.message : err,
    );
    return { outline: await generateOutline(spec.premise, { lenient: true }), strict: false };
  }
}

async function main() {
  loadEnv();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing (expected in p1/.env)");
  }

  const outDir = path.resolve(__dirname, "../src/lib/prebuilt");
  fs.mkdirSync(outDir, { recursive: true });

  for (const spec of SPECS) {
    console.log(`[gen-outlines] generating ${spec.id}…`);
    const { outline, strict } = await generateOne(spec);

    const outPath = path.join(outDir, spec.file);
    fs.writeFileSync(outPath, JSON.stringify(outline, null, 2) + "\n");

    const beats = outline.acts.reduce((n, a) => n + a.beats.length, 0);
    const qtes = outline.acts.flatMap((a) => a.beats).filter((b) => b.qte).length;
    const strictOk = outlineSchema.safeParse(outline).success;
    console.log(
      `[gen-outlines] ${spec.id}: "${outline.title}" — ${outline.acts.length} acts, ${beats} beats, ` +
        `${qtes} QTEs, ${outline.endings.length} endings, ${outline.characters.length} NPCs ` +
        `(schema: ${strict ? "strict" : "lenient"}, strict-valid: ${strictOk}) -> ${outPath}`,
    );
  }
  console.log("[gen-outlines] done.");
}

main().catch((err) => {
  console.error("[gen-outlines] FAILED:", err);
  process.exit(1);
});
