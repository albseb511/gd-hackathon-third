// Editorial vetting backfill for the prebuilt story outlines.
// For each of noir/fantasy/starship: lint structure (report only, never fix),
// run the vetOutline editorial pass (labels + self-explanatory choiceHints),
// and write the result back pretty-printed.
//
// Idempotent: stories where every beat already has a label are skipped
// unless --force is passed.
// Run from p1/ with: npx tsx scripts/backfill-vetting.ts [--force]

import fs from "node:fs";
import path from "node:path";
import { lintOutline, vetOutline } from "../src/lib/storyEngine/vetOutline";
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

const STORIES = ["noir", "fantasy", "starship"] as const;

function printLint(story: string, issues: string[]) {
  if (issues.length === 0) {
    console.log(`[lint] ${story}: clean`);
  } else {
    console.log(`[lint] ${story}: ${issues.length} issue(s)`);
    for (const i of issues) console.log(`  - ${i}`);
  }
}

function sampleBeats(outline: StoryOutline, count: number) {
  return outline.acts
    .flatMap((a) => a.beats)
    .slice(0, count)
    .map((b) => ({ id: b.id, label: b.label, choiceHints: b.choiceHints }));
}

async function main() {
  loadEnv();
  const force = process.argv.includes("--force");

  for (const story of STORIES) {
    const file = path.resolve(__dirname, `../src/lib/prebuilt/${story}.json`);
    const outline: StoryOutline = JSON.parse(fs.readFileSync(file, "utf8"));

    printLint(story, lintOutline(outline));

    const beats = outline.acts.flatMap((a) => a.beats);
    if (!force && beats.every((b) => b.label)) {
      console.log(`[vet] ${story}: every beat already has a label — skipping (use --force to re-vet)`);
      continue;
    }

    const before = story === "starship" ? sampleBeats(outline, 3) : null;

    const vetted = await vetOutline(outline);
    if (vetted === outline) {
      console.log(`[vet] ${story}: vet pass returned original outline — not writing`);
      continue;
    }

    fs.writeFileSync(file, JSON.stringify(vetted, null, 2) + "\n");
    console.log(`[vet] ${story}: written`);

    if (before) {
      console.log(`\n[sample] starship — 3 beats before/after:`);
      const after = sampleBeats(vetted, 3);
      for (let i = 0; i < before.length; i++) {
        console.log(`  beat ${before[i].id}`);
        console.log(`    before: label=${JSON.stringify(before[i].label)}`);
        console.log(`            choiceHints=${JSON.stringify(before[i].choiceHints)}`);
        console.log(`    after:  label=${JSON.stringify(after[i].label)}`);
        console.log(`            choiceHints=${JSON.stringify(after[i].choiceHints)}`);
      }
      console.log();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
