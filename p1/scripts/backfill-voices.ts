// One-time: assign a distinct performable voiceStyle AND a distinct prebuilt
// TTS voiceName to every character in the prebuilt outlines.
// Run: npx tsx scripts/backfill-voices.ts   (idempotent-ish: skips what's done)
import { readFileSync, writeFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string]),
);

// Mirror of CHARACTER_VOICE_POOL in src/lib/storyEngine/types.ts (kept inline
// so the script stays dependency-free). Narrator voices excluded.
const VOICE_POOL = [
  "Puck", // upbeat male
  "Kore", // firm female
  "Aoede", // breezy female
  "Leda", // youthful precise female
  "Zephyr", // bright female
  "Enceladus", // breathy gravel male
  "Iapetus", // clear male
  "Umbriel", // easy-going male
  "Algieba", // smooth male
  "Despina", // smooth female
  "Erinome", // clear female
  "Gacrux", // mature female
  "Alnilam", // firm male
  "Schedar", // even male
  "Achird", // friendly male
  "Sulafat", // warm female
];

interface Char {
  name: string;
  role: string;
  visualDescription: string;
  voiceStyle?: string;
  voiceName?: string;
}

async function generate(prompt: string, responseSchema: unknown): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema },
      }),
    },
  );
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.find(
    (p: { text?: string }) => p.text,
  )?.text;
  if (!text) throw new Error(`empty model response: ${JSON.stringify(data).slice(0, 300)}`);
  return text;
}

async function backfillVoiceStyles(
  outline: { title: string; genre: string },
  chars: Char[],
  story: string,
): Promise<boolean> {
  if (chars.every((c) => c.voiceStyle)) {
    console.log(`${story}: voiceStyles already present`);
    return false;
  }
  const text = await generate(
    `Story: "${outline.title}" (${outline.genre}). For each character below, write ONE voiceStyle line performable by a voice actor: pitch, pace, texture, accent flavor, one verbal tic. Every voice must be unmistakably distinct from the others.\n\n${chars
      .map((c) => `- ${c.name} (${c.role}): ${c.visualDescription}`)
      .join("\n")}`,
    {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          voiceStyle: { type: "STRING" },
        },
        required: ["name", "voiceStyle"],
      },
    },
  );
  const voices: { name: string; voiceStyle: string }[] = JSON.parse(text);
  for (const c of chars) {
    const v = voices.find((x) => x.name === c.name);
    if (v) c.voiceStyle = v.voiceStyle;
  }
  console.log(`${story}: voiceStyles ${chars.filter((c) => c.voiceStyle).length}/${chars.length}`);
  return true;
}

async function requestVoiceNames(
  outline: { title: string; genre: string },
  chars: Char[],
): Promise<Map<string, string>> {
  const text = await generate(
    `Story: "${outline.title}" (${outline.genre}). Assign each character below a prebuilt TTS voice from this pool (voice: character it suits):
- Puck: upbeat male · Kore: firm female · Aoede: breezy female · Leda: youthful precise female · Zephyr: bright female · Enceladus: breathy gravel male · Iapetus: clear male · Umbriel: easy-going male · Algieba: smooth male · Despina: smooth female · Erinome: clear female · Gacrux: mature female · Alnilam: firm male · Schedar: even male · Achird: friendly male · Sulafat: warm female

Pick the voice that best matches each character's voiceStyle (gender, age, texture). EVERY character must get a DIFFERENT voice — no duplicates.

${chars.map((c) => `- ${c.name} (${c.role}): ${c.voiceStyle}`).join("\n")}`,
    {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          voiceName: { type: "STRING", enum: VOICE_POOL },
        },
        required: ["name", "voiceName"],
      },
    },
  );
  const picks: { name: string; voiceName: string }[] = JSON.parse(text);
  return new Map(picks.map((p) => [p.name, p.voiceName]));
}

async function backfillVoiceNames(
  outline: { title: string; genre: string },
  chars: Char[],
  story: string,
): Promise<boolean> {
  if (chars.every((c) => c.voiceName && VOICE_POOL.includes(c.voiceName))) {
    console.log(`${story}: voiceNames already assigned`);
    return false;
  }

  let assignments: Map<string, string> | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const picks = await requestVoiceNames(outline, chars);
    const values = chars
      .map((c) => picks.get(c.name))
      .filter((v): v is string => !!v && VOICE_POOL.includes(v));
    const complete = values.length === chars.length;
    const unique = new Set(values).size === values.length;
    if (complete && unique) {
      assignments = picks;
      break;
    }
    console.warn(
      `${story}: voiceName attempt ${attempt} ${complete ? "had duplicates" : "was incomplete"}, ${attempt < 2 ? "retrying" : "falling back to round-robin"}`,
    );
  }

  if (assignments) {
    for (const c of chars) c.voiceName = assignments.get(c.name);
  } else {
    chars.forEach((c, i) => {
      c.voiceName = VOICE_POOL[i % VOICE_POOL.length];
    });
  }
  console.log(
    `${story}: voiceNames ${chars.map((c) => `${c.name}=${c.voiceName}`).join(", ")}`,
  );
  return true;
}

async function main() {
  for (const story of ["noir", "fantasy", "starship"]) {
    const path = new URL(`../src/lib/prebuilt/${story}.json`, import.meta.url).pathname;
    const outline = JSON.parse(readFileSync(path, "utf8"));
    const chars: Char[] = outline.characters;

    const styled = await backfillVoiceStyles(outline, chars, story);
    const named = await backfillVoiceNames(outline, chars, story);

    if (styled || named) {
      writeFileSync(path, JSON.stringify(outline, null, 2) + "\n");
      console.log(`${story}: written`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
