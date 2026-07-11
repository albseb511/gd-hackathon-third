// Generates the app's own icons with NB2 Lite — the asset pipeline builds
// the app it lives in. Run: npx tsx scripts/gen-app-assets.ts
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string]),
);

const PROMPT = `App icon, centered composition on a near-black background: a stylized golden sound-wave forming an open book silhouette, hand-painted graphic novel style, bold flat shapes, subtle amber glow, no text, no border. Square 1:1.`;

async function main() {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
        },
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
  if (!b64) throw new Error("no image");

  mkdirSync(new URL("../public/icons", import.meta.url), { recursive: true });
  const src = new URL("../public/icons/icon-src.jpg", import.meta.url).pathname;
  writeFileSync(src, Buffer.from(b64, "base64"));
  for (const size of [192, 512]) {
    const out = new URL(`../public/icons/icon-${size}.png`, import.meta.url).pathname;
    execSync(`sips -s format png -z ${size} ${size} "${src}" --out "${out}"`, {
      stdio: "ignore",
    });
  }
  console.log("icons written: public/icons/icon-{192,512}.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
