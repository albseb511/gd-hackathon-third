// Build-time: pre-render the 3 prebuilt stories into a scripted audio drama.
// For each beat -> generate an ordered line list (narrator + character
// dialogue) with 3.5-flash, TTS each line to mp3 (narrator voice / character
// voices), and emit public/scripted/<story>.json + the mp3s. Run once:
//   npx tsx scripts/gen-scripted.ts            (all three)
//   npx tsx scripts/gen-scripted.ts starship   (one)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string]),
);
const KEY = env.GEMINI_API_KEY;
const TEXT_MODEL = "gemini-3.5-flash";
const TTS_MODEL = "gemini-3.1-flash-tts-preview";

// narrator voice per story genre (mirrors liveConfig.voiceForGenre)
function narratorVoice(genre: string): string {
  const g = genre.toLowerCase();
  if (/noir|crime|thriller|mystery|detective/.test(g)) return "Charon";
  if (/sci|space|star|cyber|future/.test(g)) return "Fenrir";
  if (/horror|gothic|dark/.test(g)) return "Charon";
  return "Orus";
}

interface Char {
  name: string;
  role: string;
  visualDescription: string;
  voiceStyle?: string;
  voiceName?: string;
}
interface Beat {
  id: string;
  label?: string;
  summary: string;
  sceneHint: string;
  choiceHints: string[];
  leadsTo: string[];
  qte?: { type: string; stakes: string; winBeat: string; loseBeat: string };
}
interface Outline {
  title: string;
  genre: string;
  characters: Char[];
  acts: { beats: Beat[] }[];
  endings: { id: string; tone: string; condition: string }[];
}

let textCalls = 0;
let ttsCalls = 0;

async function genLines(
  outline: Outline,
  beat: Beat,
  isEnding: boolean,
): Promise<{ speaker: string; text: string; delivery: string }[]> {
  textCalls++;
  const cast = outline.characters
    .map((c) => `- ${c.name} (${c.role}): ${c.voiceStyle ?? c.visualDescription}`)
    .join("\n");
  const prompt = `You are scripting one beat of an interactive audio drama: "${outline.title}" (${outline.genre}).

CAST (their voices):
${cast}

THIS BEAT: ${beat.label ? `"${beat.label}" — ` : ""}${beat.summary}
Staging: ${beat.sceneHint}
${isEnding ? "This is an ENDING beat — deliver a short, resonant finale." : `It ends on a choice between: ${beat.choiceHints.join(" / ")}`}

Write the spoken script for this beat as an ordered list of lines. Rules:
- The narrator is second person, cinematic, and PLAYER-AGNOSTIC: address the listener as "you", NEVER a specific name, gender, or appearance (one recording must fit every player).
- Whenever a named cast member is present, give them at least one line of real dialogue — prefer dialogue over description.
- Keep the whole beat tight: 4-7 lines total, each line one or two sentences.
- Narrator lines carry scene, mood, and consequence; character lines are in their voice.
${isEnding ? "- End with a final narrator line that lands the ending." : "- The final narrator line leaves the tension hanging at the decision point. NEVER read the choices aloud."}
- Use speaker "narrator" for narration, or the EXACT cast name for dialogue.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                speaker: { type: "STRING" },
                text: { type: "STRING" },
                delivery: { type: "STRING", description: "how to perform it" },
              },
              required: ["speaker", "text", "delivery"],
            },
          },
        },
      }),
    },
  );
  const data = await res.json();
  const txt = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
  if (!txt) throw new Error(`script gen failed for ${beat.id}: ${JSON.stringify(data).slice(0, 200)}`);
  return JSON.parse(txt);
}

// Returns true on success. Retries transient failures; returns false if the
// line can't be synthesized after retries (caller drops it gracefully).
async function tts(
  text: string,
  voiceName: string,
  delivery: string,
  outPath: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    ttsCalls++;
    let rateLimited = false;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Say ${delivery}: ${text}` }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            },
          }),
        },
      );
      rateLimited = res.status === 429;
      const data = await res.json();
      const inline = data.candidates?.[0]?.content?.parts?.find(
        (p: { inlineData?: { data: string } }) => p.inlineData,
      )?.inlineData;
      if (inline?.data) {
        const pcm = `${outPath}.pcm`;
        writeFileSync(pcm, Buffer.from(inline.data, "base64"));
        execSync(
          `ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${pcm}" -codec:a libmp3lame -qscale:a 4 "${outPath}"`,
          { stdio: "ignore" },
        );
        execSync(`rm -f "${pcm}"`);
        return true;
      }
      rateLimited = rateLimited || /RESOURCE_EXHAUSTED|quota|rate/i.test(JSON.stringify(data));
    } catch {
      // network hiccup — retry
    }
    // longer backoff on rate limits to let the per-minute quota recover
    await new Promise((r) => setTimeout(r, (rateLimited ? 8000 : 1000) * attempt));
  }
  return false;
}

async function main() {
  const only = process.argv.slice(2).find((a) => !a.startsWith("-"));
  for (const story of ["noir", "fantasy", "starship"]) {
    if (only && story !== only) continue;
    const outline: Outline = JSON.parse(
      readFileSync(new URL(`../src/lib/prebuilt/${story}.json`, import.meta.url), "utf8"),
    );
    const dir = fileURLToPath(new URL(`../public/scripted/${story}`, import.meta.url));
    mkdirSync(dir, { recursive: true });
    const beats = outline.acts.flatMap((a) => a.beats);
    const beatIds = new Set(beats.map((b) => b.id));
    const endingIds = new Set(outline.endings.map((e) => e.id));
    const voiceOf = (speaker: string): string => {
      if (speaker.toLowerCase() === "narrator") return narratorVoice(outline.genre);
      const c = outline.characters.find(
        (x) => x.name.toLowerCase() === speaker.toLowerCase() ||
          x.name.toLowerCase().includes(speaker.toLowerCase()),
      );
      return c?.voiceName ?? narratorVoice(outline.genre);
    };

    const scriptBeats: Record<string, unknown> = {};
    for (const beat of beats) {
      const isEnding = false;
      const lines = await genLines(outline, beat, isEnding);
      const outLines: { speaker: string; text: string; audio: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const file = `${beat.id}-${i}.mp3`;
        const abs = `${dir}/${file}`;
        const ok = existsSync(abs) || (await tts(ln.text, voiceOf(ln.speaker), ln.delivery, abs));
        if (!ok) {
          console.warn(`  ! skipped ${story}/${file} (tts failed)`);
          continue;
        }
        await new Promise((r) => setTimeout(r, 400)); // pace to stay under RPM
        outLines.push({ speaker: ln.speaker, text: ln.text, audio: `/scripted/${story}/${file}` });
      }
      // choices: choiceHints[i] -> leadsTo[i] (bottlenecks may share one target)
      const choices = beat.choiceHints.map((label, i) => ({
        label,
        next: beat.leadsTo[Math.min(i, beat.leadsTo.length - 1)],
      }));
      const b: Record<string, unknown> = {
        mood: /reactor|fire|combat|showdown|struggle|climax/.test(beat.id) ? "combat" : "tense",
        lines: outLines,
        choices,
      };
      if (beat.qte) {
        b.qte = {
          type: beat.qte.type,
          difficulty: 3,
          prompt: beat.qte.stakes,
          winNext: beat.qte.winBeat,
          loseNext: beat.qte.loseBeat,
        };
      }
      scriptBeats[beat.id] = b;
      console.log(`  ${story}/${beat.id}: ${outLines.length} lines`);
    }

    // ending pseudo-beats: one closing narrator line per ending
    for (const ending of outline.endings) {
      const file = `${ending.id}-0.mp3`;
      const abs = `${dir}/${file}`;
      const lines = await genLines(
        { ...outline },
        {
          id: ending.id,
          summary: `Ending (${ending.tone}): ${ending.condition}`,
          sceneHint: `The story's ${ending.tone} conclusion.`,
          choiceHints: [],
          leadsTo: [],
        } as Beat,
        true,
      );
      const outLines: { speaker: string; text: string; audio: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const f = `${ending.id}-${i}.mp3`;
        const a = `${dir}/${f}`;
        const ok = existsSync(a) || (await tts(ln.text, voiceOf(ln.speaker), ln.delivery, a));
        if (!ok) continue;
        outLines.push({ speaker: ln.speaker, text: ln.text, audio: `/scripted/${story}/${f}` });
      }
      void file;
      scriptBeats[ending.id] = {
        mood: ending.tone === "triumphant" ? "triumphant" : ending.tone === "tragic" ? "tragic" : "calm",
        isEnding: true,
        endingId: ending.id,
        lines: outLines,
        choices: [],
      };
      console.log(`  ${story}/${ending.id} (ending): ${outLines.length} lines`);
    }

    // sanity: every choice target exists
    for (const [id, b] of Object.entries(scriptBeats)) {
      for (const c of (b as { choices: { next: string }[] }).choices) {
        if (!beatIds.has(c.next) && !endingIds.has(c.next))
          console.warn(`  ! ${story}/${id} choice -> missing ${c.next}`);
      }
    }

    const script = {
      storyId: story,
      title: outline.title,
      startBeat: beats[0].id,
      beats: scriptBeats,
    };
    writeFileSync(
      fileURLToPath(new URL(`../public/scripted/${story}.json`, import.meta.url)),
      JSON.stringify(script, null, 2) + "\n",
    );
    console.log(`✓ ${story}: ${Object.keys(scriptBeats).length} beats written`);
  }
  console.log(`\ndone. text calls=${textCalls} tts calls=${ttsCalls}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
