// Verifies the M0 critical path exactly as the browser does it:
// POST /api/live-token → connect Live WS with empty config → text in →
// audio + transcription (+ tool calls) out.
import { GoogleGenAI, LiveServerMessage } from "@google/genai";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

async function main() {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/live-token`, { method: "POST", body: "{}" });
  const { token, model, error } = (await res.json()) as {
    token?: string;
    model?: string;
    error?: string;
  };
  if (error || !token) throw new Error(error ?? "no token");
  console.log(`token minted in ${Math.round(performance.now() - t0)}ms`);

  const client = new GoogleGenAI({
    apiKey: token,
    httpOptions: { apiVersion: "v1alpha" },
  });

  let audioBytes = 0;
  let transcript = "";
  let firstAudioAt = 0;
  let sentAt = 0;
  let resumeHandle = "";
  const toolCalls: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), 30000);
    let session: Awaited<ReturnType<typeof client.live.connect>> | null = null;
    let turns = 0;
    client.live
      .connect({
        model: model!,
        config: {}, // everything locked server-side in token constraints
        callbacks: {
          onopen: () => console.log(`ws open at ${Math.round(performance.now() - t0)}ms`),
          onmessage: (m: LiveServerMessage) => {
            const part = m.serverContent?.modelTurn?.parts?.find((p) => p.inlineData?.data);
            if (part?.inlineData?.data) {
              if (!firstAudioAt) firstAudioAt = performance.now();
              audioBytes += Buffer.from(part.inlineData.data, "base64").length;
            }
            if (m.serverContent?.outputTranscription?.text)
              transcript += m.serverContent.outputTranscription.text;
            if (m.toolCall?.functionCalls?.length) {
              toolCalls.push(...m.toolCall.functionCalls.map((f) => f.name ?? "?"));
              // acknowledge every call so narration proceeds (as the client will)
              session?.sendToolResponse({
                functionResponses: m.toolCall.functionCalls.map((f) => ({
                  id: f.id,
                  name: f.name,
                  response: { ok: true },
                })),
              });
            }
            if (m.sessionResumptionUpdate?.newHandle)
              resumeHandle = m.sessionResumptionUpdate.newHandle;
            if (m.serverContent?.turnComplete) {
              turns++;
              // stop once we have audio, or after a few tool-only turns
              if (audioBytes > 0 || turns >= 4) {
                clearTimeout(timer);
                resolve();
              }
            }
          },
          onerror: (e) => reject(new Error(e.message)),
          onclose: (e) => console.log("ws closed", e?.reason ?? ""),
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

  console.log(`first audio: ${Math.round(firstAudioAt - sentAt)}ms after send`);
  console.log(`audio: ${(audioBytes / 48000).toFixed(1)}s at 24kHz`);
  console.log(`transcript: ${transcript.trim().slice(0, 120)}`);
  console.log(`tool calls: ${toolCalls.join(", ") || "none"}`);
  console.log(`resume handle: ${resumeHandle ? "yes" : "no"}`);
  if (!audioBytes) throw new Error("no audio received");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
