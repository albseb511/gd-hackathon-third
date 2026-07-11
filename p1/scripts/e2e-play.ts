// Headless end-to-end playthrough against a deployed instance: creates a
// playthrough, opens a real Live session via the token route, plays a few
// beats (text in, audio+transcript out), executes render_scene against the
// deployed image pipeline, persists beats, then verifies what stuck.
// Usage: BASE_URL=https://... npx tsx scripts/e2e-play.ts
import {
  FunctionResponseScheduling,
  GoogleGenAI,
  LiveServerMessage,
  Session,
} from "@google/genai";
import {
  applyNarratorPatch,
  parseNarratorPatch,
} from "../src/lib/storyEngine/applyPatch";
import { initialPlayState, PlayState } from "../src/lib/storyEngine/types";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const MAX_BEATS = 3;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function main() {
  // 1. playthrough
  const { playthroughId } = await api<{ playthroughId: string }>(
    "/api/playthroughs",
    { storyId: "noir", deviceKey: `e2e-${Math.random().toString(36).slice(2, 8)}` },
  );
  console.log("playthrough:", playthroughId);

  // 2. token + connect
  const { token, model } = await api<{ token: string; model: string }>(
    "/api/live-token",
    { playthroughId },
  );
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

  let session: Session = null!;
  let sceneIdx = 0;
  let playState: PlayState = initialPlayState("start");
  let images = 0;
  let transcript = "";
  let turnText = "";
  let choicesSeen: string[] = [];
  let beats = 0;
  let firstAudioMs = 0;
  let sentAt = 0;
  const spokenLines: string[] = [];

  const persist = (payload: Record<string, unknown>) =>
    api("/api/beat", { playthroughId, ...payload }).catch(() => null);

  const renderScene = async (args: Record<string, unknown>) => {
    const t0 = performance.now();
    const { assetId } = await api<{ assetId: string | null }>("/api/scene-image", {
      prompt: args.image_prompt,
      artStyle:
        "hand-painted graphic novel realism — flat painterly cel-shaded panels, muted palette, rain-slick neon noir",
      shot: "new",
      playthroughId,
    });
    console.log(
      `  [image] ${Math.round(performance.now() - t0)}ms asset=${assetId?.slice(0, 8)}`,
    );
    images++;
    await persist({
      scene: { idx: sceneIdx++, beatId: args.beat_id, imageAssetId: assetId, imagePrompt: args.image_prompt },
    });
  };

  const done = new Promise<void>((resolve, reject) => {
    const guard = setTimeout(() => resolve(), 150_000);
    ai.live
      .connect({
        model,
        config: {},
        callbacks: {
          onopen: () => console.log("ws open"),
          onmessage: (m: LiveServerMessage) => {
            const sc = m.serverContent;
            const audio = sc?.modelTurn?.parts?.find((p) => p.inlineData?.data);
            if (audio && !firstAudioMs) firstAudioMs = Math.round(performance.now() - sentAt);
            if (sc?.outputTranscription?.text) {
              transcript += sc.outputTranscription.text;
              turnText += sc.outputTranscription.text;
            }
            for (const fc of m.toolCall?.functionCalls ?? []) {
              const args = (fc.args ?? {}) as Record<string, unknown>;
              // mirror the real client: SILENT acks so the ack itself never
              // re-triggers generation (the WHEN_IDLE default does)
              session.sendToolResponse({
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { ok: true },
                    scheduling: FunctionResponseScheduling.SILENT,
                  },
                ],
              });
              if (fc.name === "speak_as") {
                spokenLines.push(`${args.character_name}: ${args.line}`);
                console.log(`  [speak_as] ${args.character_name}: "${String(args.line).slice(0, 60)}"`);
              }
              if (fc.name === "render_scene") {
                if (typeof args.beat_id === "string") {
                  playState = applyNarratorPatch(playState, {}, args.beat_id);
                  void persist({ statePatch: { state: playState } });
                }
                void renderScene(args);
              }
              if (fc.name === "present_choices") choicesSeen = (args.options as string[]) ?? [];
              if (fc.name === "update_state") {
                playState = applyNarratorPatch(
                  playState,
                  parseNarratorPatch(args.patch),
                  args.beat_id as string | undefined,
                );
                void persist({ statePatch: { state: playState } });
              }
              console.log(`  [tool] ${fc.name}`);
            }
            if (sc?.turnComplete) {
              const narration = turnText.trim();
              turnText = "";
              if (narration) {
                void persist({ scene: { idx: Math.max(0, sceneIdx - 1), narration } });
                console.log(`  [gm] ${narration.slice(0, 90).replace(/\n/g, " ")}`);
              }
              beats++;
              if (beats > MAX_BEATS) {
                clearTimeout(guard);
                resolve();
                return;
              }
              // answer: pick a choice if offered, else freeform
              const answer = choicesSeen.length
                ? `I choose: ${choicesSeen[0]}`
                : "I look around carefully and keep moving.";
              choicesSeen = [];
              sentAt = performance.now();
              setTimeout(
                () =>
                  session.sendClientContent({
                    turns: [{ role: "user", parts: [{ text: answer }] }],
                  }),
                500,
              );
            }
          },
          onerror: (e) => reject(new Error(e.message)),
          onclose: () => {},
        },
      })
      .then((s) => {
        session = s;
        sentAt = performance.now();
        s.sendClientContent({
          turns: [{ role: "user", parts: [{ text: "Begin the story." }] }],
        });
      })
      .catch(reject);
  });

  await done;
  session?.close();

  // 3. verify persistence
  const state = await api<{
    scenes: { idx: number; narration: string | null; imageAssetId: string | null }[];
    playthrough: { state: { path: string[] } };
  }>(`/api/playthroughs/${playthroughId}`);

  console.log("\n=== E2E RESULT ===");
  console.log(`beats played: ${beats}, images generated: ${images}, first audio: ${firstAudioMs}ms`);
  console.log(`persisted scenes: ${state.scenes.length}, with images: ${state.scenes.filter((s) => s.imageAssetId).length}`);
  console.log(`path: ${state.playthrough.state.path?.join(" → ")}`);
  console.log(`transcript sample: ${transcript.trim().slice(0, 140)}`);
  console.log(`character lines via speak_as: ${spokenLines.length}`);
  if (!images || !state.scenes.some((s) => s.narration)) throw new Error("e2e incomplete");
  console.log("E2E PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("E2E FAIL", e);
  process.exit(1);
});
