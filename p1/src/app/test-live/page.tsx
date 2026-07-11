"use client";

// M0 de-risk page: ephemeral token → direct browser↔Google Live WebSocket,
// continuous mic in, scheduled audio out, barge-in flush, transcripts, tool
// call logging. If this page works, the PS1 core works.

import { useCallback, useRef, useState } from "react";
import { GoogleGenAI, Session, LiveServerMessage } from "@google/genai";
import { useLiveAudio } from "@/components/audio/useLiveAudio";

type LogLine = { t: string; kind: string; text: string };

export default function TestLivePage() {
  const audio = useLiveAudio();
  const sessionRef = useRef<Session | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const connectT0 = useRef(0);
  const gotFirstAudio = useRef(false);

  const addLog = useCallback((kind: string, text: string) => {
    setLog((l) => [...l.slice(-80), { t: new Date().toISOString().slice(11, 19), kind, text }]);
  }, []);

  const handleMessage = useCallback(
    (msg: LiveServerMessage) => {
      const sc = msg.serverContent;
      if (sc?.interrupted) {
        audio.flushPlayback();
        addLog("interrupt", "⚡ barge-in — playback flushed");
      }
      const audioPart = sc?.modelTurn?.parts?.find((p) => p.inlineData?.data);
      if (audioPart?.inlineData?.data) {
        if (!gotFirstAudio.current) {
          gotFirstAudio.current = true;
          setFirstAudioMs(Math.round(performance.now() - connectT0.current));
        }
        audio.playChunk(audioPart.inlineData.data);
      }
      if (sc?.outputTranscription?.text) {
        addLog("narrator", sc.outputTranscription.text);
      }
      if (sc?.inputTranscription?.text) {
        addLog("you", sc.inputTranscription.text);
      }
      if (msg.toolCall?.functionCalls?.length) {
        for (const fc of msg.toolCall.functionCalls) {
          addLog("tool", `${fc.name}(${JSON.stringify(fc.args).slice(0, 140)})`);
          // M0: acknowledge so the session keeps flowing
          sessionRef.current?.sendToolResponse({
            functionResponses: [
              { id: fc.id, name: fc.name, response: { ok: true } },
            ],
          });
        }
      }
      if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
        addLog("resume", `handle ${msg.sessionResumptionUpdate.newHandle.slice(0, 16)}…`);
      }
      if (msg.goAway) {
        addLog("goAway", `server closing in ${msg.goAway.timeLeft ?? "?"}`);
      }
    },
    [audio, addLog],
  );

  const start = useCallback(async () => {
    setStatus("connecting");
    gotFirstAudio.current = false;
    setFirstAudioMs(null);
    try {
      const res = await fetch("/api/live-token", { method: "POST", body: "{}" });
      const { token, model, error } = await res.json();
      if (error) throw new Error(error);

      const ai = new GoogleGenAI({
        apiKey: token,
        httpOptions: { apiVersion: "v1alpha" },
      });

      connectT0.current = performance.now();
      // Config is fully locked server-side in the token constraints.
      const session = await ai.live.connect({
        model,
        config: {},
        callbacks: {
          onopen: () => addLog("ws", "connected"),
          onmessage: handleMessage,
          onerror: (e) => {
            addLog("error", e.message ?? "ws error");
            setStatus("error");
          },
          onclose: (e) => {
            addLog("ws", `closed ${e?.reason ?? ""}`);
            setStatus("idle");
          },
        },
      });
      sessionRef.current = session;

      await audio.startMic((chunk) => {
        sessionRef.current?.sendRealtimeInput({
          audio: { data: chunk, mimeType: "audio/pcm;rate=16000" },
        });
      });
      audio.ensureOutCtx();
      setStatus("live");
      // kick things off
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "Begin the story." }] }],
      });
    } catch (e) {
      addLog("error", e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [audio, handleMessage, addLog]);

  const stop = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    audio.stop();
    setStatus("idle");
  }, [audio]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-mono text-sm">
      <h1 className="text-lg mb-1">Live API test — barge-in + audio + tools</h1>
      <p className="text-zinc-400 mb-4">
        Tap start (mic permission needed), listen, then interrupt mid-sentence.
      </p>
      <div className="flex gap-3 items-center mb-4">
        {status !== "live" ? (
          <button
            onClick={start}
            disabled={status === "connecting"}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded px-5 py-3"
          >
            {status === "connecting" ? "connecting…" : "▶ start session"}
          </button>
        ) : (
          <button onClick={stop} className="bg-rose-700 hover:bg-rose-600 rounded px-5 py-3">
            ■ stop
          </button>
        )}
        <span className={audio.speaking ? "text-emerald-400" : "text-zinc-500"}>
          {audio.speaking ? "● narrator speaking" : "○ silent"}
        </span>
        <span className={audio.micActive ? "text-sky-400" : "text-zinc-600"}>
          {audio.micActive ? "🎙 mic live" : "mic off"}
        </span>
        {firstAudioMs !== null && (
          <span className="text-amber-400">first audio: {firstAudioMs}ms</span>
        )}
      </div>
      <div className="bg-zinc-900 rounded p-3 h-[60vh] overflow-y-auto space-y-1">
        {log.map((l, i) => (
          <div key={i}>
            <span className="text-zinc-600">{l.t}</span>{" "}
            <span
              className={
                l.kind === "error"
                  ? "text-rose-400"
                  : l.kind === "tool"
                    ? "text-violet-400"
                    : l.kind === "interrupt"
                      ? "text-amber-400"
                      : l.kind === "you"
                        ? "text-sky-400"
                        : l.kind === "narrator"
                          ? "text-emerald-300"
                          : "text-zinc-400"
              }
            >
              [{l.kind}]
            </span>{" "}
            {l.text}
          </div>
        ))}
      </div>
    </main>
  );
}
