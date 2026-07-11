// Composer agent, dev-time: pre-generates the loopable mood-music bank for
// the three prebuilt stories with Lyria. Run: npx tsx scripts/gen-music.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { STARSHIP_PALETTE, STARSHIP_MOODS } from "../src/lib/audio/contract";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string]),
);

// Lyria 3 responds best to descriptive PROSE (genre + mood + instrumentation +
// tempo + "instrumental"), NOT keyword tags — per Google's Lyria 3 prompt guide.
const STORY_SOUND: Record<string, string> = {
  noir: "brooding noir jazz with brushed drums, upright bass, and muted trumpet, with a rainy late-night mood",
  fantasy: "warm cinematic fantasy orchestra with low strings, woodwinds, and distant horns, evoking hearth and mountain",
  starship: "retro-futurist analog synth score with a slow pulse, tape warble, and a mood of deep-space dread",
};

// Each mood description now fixes an ENERGY/DENSITY level explicitly, not just a
// vibe — arousal (how intense the moment feels) must differ audibly between moods,
// and density survives the mixer's ducking better than loudness does. Ordered
// from lowest energy to highest so the contrast is deliberate.
const MOODS: Record<string, string> = {
  decision:
    "A held, suspended moment at a decision point — tense and unresolved. Extremely sparse and near-silent: a single sustained low drone beneath a slow two-note ostinato, no melody and no resolution, at a very slow tempo with minimal energy",
  item_closeup:
    "Intimate and curious, as if examining a single small object up close. Near-static and very sparse: one delicate solo instrument such as a music box or softly plucked strings, quiet and focused, very slow, with very low energy",
  calm:
    "Gentle, safe, and reflective. Very sparse and very low energy: one or two soft instruments playing slow, quiet, warmly consonant and resolved lines, unhurried and peaceful",
  tragic:
    "Grieving, heavy, and sorrowful in a minor key. Very sparse and soft, dark and low in timbre: a single mournful solo instrument playing a slow, aching line with very low energy",
  tense:
    "Suspenseful and coiled, with a quiet sense of menace. Low-to-moderate energy: a sparse ticking pulse under sustained, unresolved harmony, no clear melody, slowly building unease at a steady, restrained tempo",
  intro:
    "Establishing, mysterious, and inviting, unhurried and open. Moderate-to-low energy with a sparse-to-medium constant texture that draws the listener in without rushing",
  explore:
    "Curious, patient, and wandering, with gentle forward motion. Low-to-moderate energy and a light, steady texture at a relaxed, walking tempo",
  triumphant:
    "Swelling, victorious, and warm, resolving in a bright major key. High energy with a full, bright ensemble, bold brass, and rising, resolved harmony at a strong, uplifting tempo",
  combat:
    "Driving, urgent, and dangerous. Very high energy and very dense: a relentless, fast full-ensemble arrangement with pounding percussion and heavy low brass — powerful, loud, and intense",
};

async function genClip(prompt: string, outPath: string): Promise<number> {
  const t0 = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["AUDIO"] },
      }),
    },
  );
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data: string } }[] } }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
    ?.inlineData?.data;
  if (!b64) throw new Error("no audio");
  writeFileSync(outPath, Buffer.from(b64, "base64"));
  return Date.now() - t0;
}

async function main() {
  // optional story filter: `npx tsx scripts/gen-music.ts starship` regenerates one story
  const only = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const jobs: { story: string; mood: string; prompt: string; out: string }[] = [];
  for (const story of Object.keys(STORY_SOUND)) {
    if (only && story !== only) continue;
    // Starship draws its palette + per-mood sonic recipes from the audio contract
    // (research-tuned, energy/brightness-differentiated); other stories use the generic set.
    const isStarship = story === "starship";
    const sound = isStarship ? STARSHIP_PALETTE : STORY_SOUND[story];
    const moods: Record<string, string> = isStarship
      ? Object.fromEntries(Object.entries(STARSHIP_MOODS).map(([k, v]) => [k, v.sonic]))
      : MOODS;
    // fileURLToPath (not .pathname) so spaces in the project path aren't left %20-encoded
    const dir = fileURLToPath(new URL(`../public/music/${story}`, import.meta.url));
    mkdirSync(dir, { recursive: true });
    for (const [mood, feel] of Object.entries(moods)) {
      // two arrangements per mood — the mixer picks one per session, so
      // replays don't sound identical
      for (const variant of ["", "-2"]) {
        const out = `${dir}/${mood}${variant}.mp3`;
        if (existsSync(out)) continue; // resumable
        jobs.push({
          story,
          mood: `${mood}${variant}`,
          out,
          prompt: `Instrumental game background music in this style: ${sound}. ${feel}. No vocals or spoken word. Compose it as a seamless, continuously evolving loop with no clear beginning or end and no final cadence; keep the overall texture, dynamics, and energy constant from start to finish, with no fade-in and no fade-out.${
            variant
              ? " Use a different lead instrument and melodic theme from other arrangements, at the same energy level and in the same style."
              : ""
          }`,
        });
      }
    }
  }
  console.log(`${jobs.length} clips to generate`);
  const CONCURRENCY = 3;
  let done = 0;
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      let job;
      while ((job = queue.shift())) {
        try {
          const ms = await genClip(job.prompt, job.out);
          console.log(`✓ ${job.story}/${job.mood} ${ms}ms (${++done}/${jobs.length})`);
        } catch (e) {
          console.error(`✗ ${job.story}/${job.mood}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
