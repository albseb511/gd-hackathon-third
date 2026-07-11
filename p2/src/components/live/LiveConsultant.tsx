"use client";

// Voice consultant (PS1). Ephemeral token → direct browser↔Google Live socket,
// continuous mic in, scheduled audio out, barge-in flush. Model tool-calls are
// executed against the scene store, so speaking edits the live 3D room.
import { useCallback, useRef, useState } from "react";
import { GoogleGenAI, Session, LiveServerMessage } from "@google/genai";
import { useLiveAudio } from "./useLiveAudio";
import { useScene } from "@/scene/store";
import { actionToPatches } from "@/scene/tools";

type Line = { kind: "you" | "atelier" | "tool" | "sys"; text: string };

export function LiveConsultant() {
  const audio = useLiveAudio();
  const sessionRef = useRef<Session | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [lines, setLines] = useState<Line[]>([]);

  const push = useCallback((kind: Line["kind"], text: string) => {
    if (!text.trim()) return;
    setLines((l) => [...l.slice(-40), { kind, text }]);
  }, []);

  const handleMessage = useCallback(
    (msg: LiveServerMessage) => {
      const sc = msg.serverContent;
      if (sc?.interrupted) audio.flushPlayback();
      const audioPart = sc?.modelTurn?.parts?.find((p) => p.inlineData?.data);
      if (audioPart?.inlineData?.data) audio.playChunk(audioPart.inlineData.data);
      if (sc?.outputTranscription?.text) push("atelier", sc.outputTranscription.text);
      if (sc?.inputTranscription?.text) push("you", sc.inputTranscription.text);

      if (msg.toolCall?.functionCalls?.length) {
        for (const fc of msg.toolCall.functionCalls) {
          const design = useScene.getState().design;
          const { patches, error } = actionToPatches(fc.name ?? "", fc.args ?? {}, design);
          if (patches.length) {
            useScene.getState().apply(patches);
            push("tool", `${fc.name}(${JSON.stringify(fc.args).slice(0, 80)})`);
          } else {
            push("tool", `${fc.name} — no-op${error ? ` (${error.slice(0, 40)})` : ""}`);
          }
          sessionRef.current?.sendToolResponse({
            functionResponses: [
              { id: fc.id, name: fc.name, response: { ok: patches.length > 0, applied: patches.length } },
            ],
          });
        }
      }
    },
    [audio, push],
  );

  const start = useCallback(async () => {
    setStatus("connecting");
    try {
      const res = await fetch("/api/live-token", { method: "POST", body: "{}" });
      const { token, model, error } = await res.json();
      if (error) throw new Error(error);
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
      const session = await ai.live.connect({
        model,
        config: {},
        callbacks: {
          onopen: () => push("sys", "connected"),
          onmessage: handleMessage,
          onerror: (e) => { push("sys", e.message ?? "socket error"); setStatus("error"); },
          onclose: () => setStatus("idle"),
        },
      });
      sessionRef.current = session;
      await audio.startMic((chunk) =>
        sessionRef.current?.sendRealtimeInput({ audio: { data: chunk, mimeType: "audio/pcm;rate=16000" } }),
      );
      audio.ensureOutCtx();
      setStatus("live");
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "Briefly greet me and ask what room I'd like to design." }] }],
      });
    } catch (e) {
      push("sys", e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [audio, handleMessage, push]);

  const stop = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    audio.stop();
    setStatus("idle");
  }, [audio]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">Voice consultant</span>
        <span className={audio.speaking ? "text-xs text-emerald-400" : "text-xs text-zinc-500"}>
          {status === "live" ? (audio.speaking ? "● speaking" : "🎙 listening") : status}
        </span>
      </div>
      {status !== "live" ? (
        <button
          onClick={start}
          disabled={status === "connecting"}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {status === "connecting" ? "connecting…" : "▶ Talk to Atelier"}
        </button>
      ) : (
        <button onClick={stop} className="w-full rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600">
          ■ End session
        </button>
      )}
      {lines.length > 0 && (
        <div className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
          {lines.map((l, i) => (
            <div key={i} className={
              l.kind === "you" ? "text-sky-300" :
              l.kind === "atelier" ? "text-emerald-200" :
              l.kind === "tool" ? "text-violet-300" : "text-zinc-500"
            }>
              <span className="opacity-60">{l.kind}:</span> {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
