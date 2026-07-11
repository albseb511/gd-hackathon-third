// Composer agent, dev-time: pre-generates the loopable mood-music bank for
// the three prebuilt stories with Lyria. Run: npx tsx scripts/gen-music.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string]),
);

const STORY_SOUND: Record<string, string> = {
  noir: "brooding noir jazz, brushed drums, upright bass, muted trumpet, rain mood",
  fantasy: "warm cinematic fantasy orchestra, low strings, woodwinds, distant horns, hearth and mountain mood",
  starship: "retro-futurist analog synth score, slow pulse, deep space dread, tape warble",
};

const MOODS: Record<string, string> = {
  intro: "establishing, mysterious, inviting, medium-quiet",
  explore: "curious, patient, wandering, understated",
  calm: "gentle, safe, reflective, sparse",
  tense: "suspenseful, coiled, quiet menace, slowly building unease",
  combat: "driving, percussive, urgent, dangerous",
  tragic: "grieving, heavy, slow, minor key",
  triumphant: "swelling, victorious, warm resolution",
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
  const jobs: { story: string; mood: string; prompt: string; out: string }[] = [];
  for (const [story, sound] of Object.entries(STORY_SOUND)) {
    const dir = new URL(`../public/music/${story}`, import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    for (const [mood, feel] of Object.entries(MOODS)) {
      // two arrangements per mood — the mixer picks one per session, so
      // replays don't sound identical
      for (const variant of ["", "-2"]) {
        const out = `${dir}/${mood}${variant}.mp3`;
        if (existsSync(out)) continue; // resumable
        jobs.push({
          story,
          mood: `${mood}${variant}`,
          out,
          prompt: `Instrumental game background music, seamless loopable, no vocals. Style: ${sound}. Mood: ${feel}.${
            variant
              ? " An alternate arrangement: different lead instrument and melodic theme, same mood and style."
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
