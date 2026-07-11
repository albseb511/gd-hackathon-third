// One-time: assign a distinct performable voiceStyle to every character in
// the prebuilt outlines. Run: npx tsx scripts/backfill-voices.ts
import { readFileSync, writeFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string]),
);

async function main() {
  for (const story of ["noir", "fantasy", "starship"]) {
    const path = new URL(`../src/lib/prebuilt/${story}.json`, import.meta.url).pathname;
    const outline = JSON.parse(readFileSync(path, "utf8"));
    const chars: { name: string; role: string; visualDescription: string; voiceStyle?: string }[] =
      outline.characters;
    if (chars.every((c) => c.voiceStyle)) {
      console.log(`${story}: already voiced`);
      continue;
    }
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Story: "${outline.title}" (${outline.genre}). For each character below, write ONE voiceStyle line performable by a voice actor: pitch, pace, texture, accent flavor, one verbal tic. Every voice must be unmistakably distinct from the others.\n\n${chars
                    .map((c) => `- ${c.name} (${c.role}): ${c.visualDescription}`)
                    .join("\n")}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
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
          },
        }),
      },
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
    const voices: { name: string; voiceStyle: string }[] = JSON.parse(text);
    for (const c of chars) {
      const v = voices.find((x) => x.name === c.name);
      if (v) c.voiceStyle = v.voiceStyle;
    }
    writeFileSync(path, JSON.stringify(outline, null, 2) + "\n");
    console.log(`${story}: voiced ${chars.filter((c) => c.voiceStyle).length}/${chars.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
