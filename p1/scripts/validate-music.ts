// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION FRAMEWORK for the Starship music bed.
// Measures every clip with ffmpeg and checks it against the audio contract, so we
// know what Gemini/Lyria returned is CORRECT — and which moods to regenerate.
//
//   Run: npx tsx scripts/validate-music.ts
//
// Two layers of checks:
//   A) FINISHED clip (public/music/starship/<mood><v>.mp3) — did the FINISHING PASS work?
//        • loop integrity (no fade-to-silence, seam matched)
//        • loudness on mood target (±tol)  • true-peak ceiling  • duration
//   B) RAW clip (…/_raw/<mood><v>.mp3)     — did the PROMPTS work?
//        • arousal differentiation (energy ordering matches energyTier)
//        • brightness sanity (no dark/bright inversions vs. contract)
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { STARSHIP_MOODS, Brightness } from "../src/lib/audio/contract";

const DIR = fileURLToPath(new URL("../public/music/starship", import.meta.url));
const VARIANTS = ["", "-2"];

// thresholds
const DUR_MIN = 20; // s
const LUFS_TOL = 2.0; // LU around the mood target
const TP_MAX = -1.0; // dBTP ceiling
const TAIL_SILENCE = -35; // dB — tail quieter than this = fade-to-silence loop
const SEAM_MAX = 6.0; // dB — |head-tail| RMS discontinuity at the loop point
const BRIGHT_RANK: Record<Brightness, number> = {
  dark: 0, "dark-mid": 1, mid: 2, "mid-bright": 3, bright: 4,
};

function sh(cmd: string): string {
  try {
    return execSync(cmd + " 2>&1", { encoding: "utf8", maxBuffer: 1 << 27 });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return (err.stdout || "") + (err.stderr || "");
  }
}
const num = (s: string | undefined) => (s ? parseFloat(s) : NaN);

function duration(f: string): number {
  return num(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).trim());
}
function loudness(f: string): { i: number; tp: number; lra: number } {
  const o = sh(`ffmpeg -hide_banner -nostats -i "${f}" -af loudnorm=print_format=json -f null -`);
  const g = (k: string) => num(o.match(new RegExp(`"${k}"\\s*:\\s*"?(-?[0-9.]+)`))?.[1]);
  return { i: g("input_i"), tp: g("input_tp"), lra: g("input_lra") };
}
function rms(f: string, ss: number, t: number): number {
  const o = sh(`ffmpeg -hide_banner -nostats -ss ${ss} -t ${t} -i "${f}" -af astats=metadata=1 -f null -`);
  const all = [...o.matchAll(/RMS level dB:\s*(-?[0-9.]+|inf)/g)].map((m) => m[1]);
  const last = all[all.length - 1];
  return last === "inf" || last === "-inf" ? -99 : num(last);
}
function centroid(f: string): number {
  const o = sh(`ffmpeg -hide_banner -nostats -i "${f}" -af aspectralstats=measure=centroid,ametadata=print:key=lavfi.aspectralstats.1.centroid -f null -`);
  const vals = [...o.matchAll(/centroid=(-?[0-9.]+)/g)].map((m) => parseFloat(m[1]));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

interface ClipResult {
  mood: string; variant: string; missing: boolean;
  dur: number; i: number; tp: number; head: number; tail: number; // finished
  rawI: number; rawCentroid: number;                              // raw
  fails: string[];
}

function checkClip(mood: string, variant: string): ClipResult {
  const spec = STARSHIP_MOODS[mood];
  const fin = `${DIR}/${mood}${variant}.mp3`;
  const raw = `${DIR}/_raw/${mood}${variant}.mp3`;
  const r: ClipResult = { mood, variant, missing: false, dur: NaN, i: NaN, tp: NaN, head: NaN, tail: NaN, rawI: NaN, rawCentroid: NaN, fails: [] };
  if (!existsSync(fin)) { r.missing = true; r.fails.push("MISSING finished clip"); return r; }

  r.dur = duration(fin);
  const l = loudness(fin); r.i = l.i; r.tp = l.tp;
  const W = 1.2; // wider window → reliable RMS on sparse/quiet beds
  r.head = rms(fin, 0, W);
  r.tail = rms(fin, Math.max(0, r.dur - W), W);

  if (r.dur < DUR_MIN) r.fails.push(`duration ${r.dur.toFixed(1)}s < ${DUR_MIN}s`);
  if (Math.abs(r.i - spec.loudnessLUFS) > LUFS_TOL) r.fails.push(`loudness ${r.i.toFixed(1)} vs target ${spec.loudnessLUFS} (±${LUFS_TOL})`);
  if (r.tp > TP_MAX) r.fails.push(`true-peak ${r.tp.toFixed(2)} > ${TP_MAX} dBTP (clipping)`);
  // a real fade = a loud head dropping to a silent tail; two matched-quiet edges loop fine
  const bothQuiet = r.head < -25 && r.tail < -25;
  if (r.tail < TAIL_SILENCE && r.head > r.tail + 8) r.fails.push(`loop fade-to-silence (tail ${r.tail.toFixed(0)}dB under head ${r.head.toFixed(0)}dB)`);
  else if (!bothQuiet && Math.abs(r.head - r.tail) > SEAM_MAX) r.fails.push(`loop seam Δ${Math.abs(r.head - r.tail).toFixed(1)}dB > ${SEAM_MAX}`);

  if (existsSync(raw)) { r.rawI = loudness(raw).i; r.rawCentroid = centroid(raw); }
  return r;
}

function main() {
  console.log(`\nVALIDATING Starship bed against the audio contract\n${"=".repeat(72)}`);
  const results: ClipResult[] = [];
  for (const mood of Object.keys(STARSHIP_MOODS))
    for (const v of VARIANTS) results.push(checkClip(mood, v));

  // ---- A) per-clip report -------------------------------------------------
  console.log(`\nA) PER-CLIP CHECKS (finished)`);
  console.log(`${"mood".padEnd(14)}${"dur".padStart(6)}${"LUFS".padStart(8)}${"tgt".padStart(6)}${"TP".padStart(7)}${"head".padStart(8)}${"tail".padStart(8)}  result`);
  for (const r of results) {
    const tag = `${r.mood}${r.variant}`;
    if (r.missing) { console.log(`${tag.padEnd(14)}${"—".padStart(6)}   MISSING`); continue; }
    const tgt = STARSHIP_MOODS[r.mood].loudnessLUFS;
    const ok = r.fails.length === 0;
    console.log(
      `${tag.padEnd(14)}${r.dur.toFixed(1).padStart(6)}${r.i.toFixed(1).padStart(8)}${String(tgt).padStart(6)}${r.tp.toFixed(2).padStart(7)}${r.head.toFixed(0).padStart(8)}${r.tail.toFixed(0).padStart(8)}  ${ok ? "PASS" : "FAIL: " + r.fails.join("; ")}`,
    );
  }

  // ---- B) cross-mood: arousal + brightness (raw) --------------------------
  const byMood: Record<string, { rawI: number; cent: number }> = {};
  for (const mood of Object.keys(STARSHIP_MOODS)) {
    const rs = results.filter((r) => r.mood === mood && !isNaN(r.rawI));
    if (rs.length) byMood[mood] = {
      rawI: rs.reduce((a, r) => a + r.rawI, 0) / rs.length,
      cent: rs.reduce((a, r) => a + r.rawCentroid, 0) / rs.length,
    };
  }
  const warns: string[] = [];
  console.log(`\nB) CROSS-MOOD SIGNATURE (raw clips)`);
  console.log(`${"mood".padEnd(14)}${"tier".padStart(5)}${"rawLUFS".padStart(9)}${"centroidHz".padStart(12)}  expected brightness`);
  for (const mood of Object.keys(STARSHIP_MOODS)) {
    const s = STARSHIP_MOODS[mood]; const m = byMood[mood];
    console.log(`${mood.padEnd(14)}${String(s.energyRank).padStart(5)}${(m ? m.rawI.toFixed(1) : "—").padStart(9)}${(m ? m.cent.toFixed(0) : "—").padStart(12)}  ${s.brightness}`);
  }
  // arousal inversions: a much-higher-rank mood should not be quieter than a much-lower one
  const moods = Object.keys(byMood);
  for (const a of moods) for (const b of moods) {
    const ta = STARSHIP_MOODS[a].energyRank, tb = STARSHIP_MOODS[b].energyRank;
    if (ta - tb >= 3 && byMood[a].rawI < byMood[b].rawI - 1)
      warns.push(`arousal inversion: ${a}(rank ${ta}) is quieter than ${b}(rank ${tb}) in raw output`);
  }
  // brightness inversions: a 'dark' mood should not be brighter than a 'bright' one
  for (const a of moods) for (const b of moods) {
    const ra = BRIGHT_RANK[STARSHIP_MOODS[a].brightness], rb = BRIGHT_RANK[STARSHIP_MOODS[b].brightness];
    if (ra - rb <= -2 && byMood[a].cent > byMood[b].cent + 150)
      warns.push(`brightness inversion: ${a}(${STARSHIP_MOODS[a].brightness}) is brighter than ${b}(${STARSHIP_MOODS[b].brightness})`);
  }
  if (warns.length) { console.log(`\n⚠ SIGNATURE WARNINGS`); warns.forEach((w) => console.log(`  • ${w}`)); }
  else console.log(`\n✓ arousal ordering and brightness are consistent with the contract`);

  // ---- verdict + regenerate list ------------------------------------------
  const failedMoods = [...new Set(results.filter((r) => r.fails.length).map((r) => r.mood))];
  console.log(`\n${"=".repeat(72)}`);
  const hardFails = results.filter((r) => r.fails.length).length;
  console.log(`VERDICT: ${results.length - hardFails}/${results.length} clips pass hard checks; ${warns.length} signature warnings`);
  if (failedMoods.length) console.log(`REGENERATE (mood level): ${failedMoods.join(", ")}`);
  else console.log(`No regeneration needed on hard checks.`);

  writeFileSync(
    fileURLToPath(new URL("../music-validation-starship.json", import.meta.url)),
    JSON.stringify({ results, warns, failedMoods }, null, 2),
  );
  console.log(`\nreport → music-validation-starship.json`);
}

main();
