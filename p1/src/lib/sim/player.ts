// Synthetic persona players for the Simulator agent. Each persona is a short
// behavioral system prompt driven through MODELS.text (thinking off, high
// temperature). Returns either one of the presented options VERBATIM or a
// short freeform in-character line (~30% of the time, prompt-driven).

import { genai } from "../gemini";
import { MODELS } from "../models";

export type Persona =
  | "cautious"
  | "heroic"
  | "chaotic"
  | "hostile"
  | "speedrunner";

export const PERSONAS: Persona[] = [
  "cautious",
  "heroic",
  "chaotic",
  "hostile",
  "speedrunner",
];

const PERSONA_PROMPTS: Record<Persona, string> = {
  cautious:
    "You are a CAUTIOUS player. You avoid risk, gather information before acting, prefer stealth, retreat, and talking over fighting. You pick the safest-looking option and distrust anything that sounds like a trap.",
  heroic:
    "You are a HEROIC player. You are brave, selfless, and protective. You take bold risks to save others, confront villains head-on, and always choose the noble path even when it is dangerous.",
  chaotic:
    "You are a CHAOTIC player. You are unpredictable and mischievous. You poke at the world, try weird or unexpected things, ignore the obvious path, and pick whatever seems most entertaining or absurd.",
  hostile:
    "You are a HOSTILE player. You are rude and confrontational. You antagonize NPCs, insult people, threaten violence, and pick the most aggressive option available. You do not cooperate nicely.",
  speedrunner:
    "You are a SPEEDRUNNER. You want the story over as fast as possible. Pick whatever advances the plot most directly, skip side content, keep any freeform reply terse and goal-directed ('go to the docks now').",
};

function buildSystemPrompt(persona: Persona): string {
  return `You are a synthetic playtester playing an interactive audio story. ${PERSONA_PROMPTS[persona]}

RESPONSE RULES:
- If a list of OPTIONS is given: about 70% of the time reply with EXACTLY ONE of the options, copied verbatim, nothing else. The other ~30% of the time, ignore the menu and reply with one short freeform in-character line instead (first person, under 20 words) — something your persona would actually say or do.
- If no options are given: always reply with one short freeform in-character line (first person, under 20 words).
- Never narrate, never explain your reasoning, never use quotes or markdown. Output ONLY the chosen option text or the single line.`;
}

export interface PickActionOpts {
  persona: Persona;
  narration: string;
  options?: string[];
}

export async function pickAction(opts: PickActionOpts): Promise<string> {
  const { persona, narration, options } = opts;

  const userParts = [`NARRATOR SAYS:\n${narration || "(silence — the story waits for you)"}`];
  if (options && options.length > 0) {
    userParts.push(`OPTIONS:\n${options.map((o) => `- ${o}`).join("\n")}`);
    userParts.push("Reply now (one option verbatim, or one short in-character line).");
  } else {
    userParts.push("No options were shown. Reply with one short in-character line.");
  }

  const res = await genai().models.generateContent({
    model: MODELS.text,
    contents: userParts.join("\n\n"),
    config: {
      systemInstruction: buildSystemPrompt(persona),
      temperature: 1.0,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 100,
    },
  });

  let out = (res.text ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!out) out = options?.[0] ?? "I look around carefully.";

  // If the model picked an option but drifted on case/punctuation, snap to the
  // verbatim option so choice analytics aggregate cleanly.
  if (options) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const match = options.find((o) => norm(o) === norm(out));
    if (match) return match;
  }

  // Freeform line: keep it short.
  return out.split("\n")[0].slice(0, 200);
}
