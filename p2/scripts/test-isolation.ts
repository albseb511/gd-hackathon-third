// Enforces the p2 isolation guardrails (PLAN.md). Run: npm run test:isolation
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let failed = false;
function fail(msg: string) {
  console.error("ISOLATION FAIL:", msg);
  failed = true;
}

// 1. DATABASE_URL, if set, must not point at p1's database.
const url = process.env.DATABASE_URL ?? "";
if (url.includes("p1_story")) fail("DATABASE_URL points at p1_story");

// 2. No source file may reference a sibling project (p1 / cake-studio).
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk("src").filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));

// Extract only real module specifiers (quoted paths in import/require/from),
// so provenance comments mentioning donor projects don't trip the check.
function moduleSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

for (const f of files) {
  for (const spec of moduleSpecifiers(readFileSync(f, "utf8"))) {
    if (/\/p1\//.test(spec) || /cake-studio/.test(spec)) {
      fail(`${f} imports from a sibling project: "${spec}"`);
    }
    if (/^(\.\.\/){3,}/.test(spec)) {
      fail(`${f} has a relative import escaping p2: "${spec}"`);
    }
  }
}

// 3. Dev server must run on port 3001 (side-by-side with p1 on 3000).
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (!/\b3001\b/.test(pkg.scripts?.dev ?? "")) fail("dev script is not on port 3001");

if (failed) process.exit(1);
console.log(`OK isolation: ${files.length} source files scanned, all clean.`);
