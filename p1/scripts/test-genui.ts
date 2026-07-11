// UI-Smith smoke test: one structured spec + one HTML artifact.
// Run: npx tsx scripts/test-genui.ts

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

async function main() {
  // Import after env is loaded (genai() reads GEMINI_API_KEY lazily anyway).
  const { generateUiSpec, generateArtifactHtml } = await import("../src/lib/uiSmith");

  // (a) structured spec
  let t0 = performance.now();
  const spec = await generateUiSpec(
    "stat_block",
    "Player: The Stranger, might 3 wit 4 charm 2, traits: blunt, kind to strangers; reputation: trouble",
    null,
  );
  const specMs = Math.round(performance.now() - t0);
  console.log(`[ui-spec stat_block] ${specMs}ms`);
  console.log(JSON.stringify(spec, null, 2));

  // (b) HTML artifact
  t0 = performance.now();
  const html = await generateArtifactHtml(
    "A wanted poster for THE STRANGER, accused of arson at the Meridian docks, reward 5000 credits, distressed paper, official Hegemony seal",
  );
  const htmlMs = Math.round(performance.now() - t0);
  writeFileSync("/tmp/artifact.html", html);
  console.log(`[artifact-html] ${htmlMs}ms  chars=${html.length}  -> /tmp/artifact.html`);
  console.log(
    `[artifact-html] sanity: startsWithHtml=${/^<!doctype html|^<html/i.test(html.trim())} hasStyle=${html.includes("<style")} hasScript=${/<script/i.test(html)}`,
  );
}

main().catch((err) => {
  console.error("test-genui failed:", err);
  process.exit(1);
});
