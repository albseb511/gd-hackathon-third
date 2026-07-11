"use client";

// The client half of the Game Orchestrator: owns the Live session lifecycle
// (token → connect → reconnect), dispatches narrator tool calls to the right
// executor (Artist images, choices, QTE, dice), applies state patches, and
// persists beats. The narrator talks; this component makes the game happen.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FunctionResponseScheduling,
  GoogleGenAI,
  LiveServerMessage,
  Session,
} from "@google/genai";
import { useLiveAudio } from "@/components/audio/useLiveAudio";
import SceneCanvas from "@/components/game/SceneCanvas";
import ChoiceBar from "@/components/game/ChoiceBar";
import DiceRoll from "@/components/game/DiceRoll";
import Mash from "@/components/game/qte/Mash";
import TimedTap from "@/components/game/qte/TimedTap";
import Sequence from "@/components/game/qte/Sequence";
import {
  CharacterSheet,
  Mood,
  PlayState,
  QteType,
  Stat,
  StoryOutline,
} from "@/lib/storyEngine/types";
import {
  applyNarratorPatch,
  parseNarratorPatch,
  NarratorPatch,
} from "@/lib/storyEngine/applyPatch";

type QteConfig = {
  id: string;
  name: string;
  type: QteType;
  difficulty: number;
  prompt: string;
};
type DiceConfig = {
  id: string;
  name: string;
  stat: Stat;
  difficulty: number;
  advantage: boolean;
};
type Ending = { endingId: string; epilogue: string };

interface PlaythroughData {
  playthrough: { id: string; state: PlayState; summary: string | null };
  outline: StoryOutline;
  scenes: { narration: string | null; imageAssetId: string | null; idx: number }[];
  characters: CharacterSheet[];
}

export default function GameStage({ playthroughId }: { playthroughId: string }) {
  const audio = useLiveAudio();
  const sessionRef = useRef<Session | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "gate" | "connecting" | "live" | "ended" | "error"
  >("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const dataRef = useRef<PlaythroughData | null>(null);
  const stateRef = useRef<PlayState | null>(null);
  const sceneIdxRef = useRef(0);
  const lastAssetIdRef = useRef<string | null>(null);
  const resumeHandleRef = useRef<string | null>(null);
  const closingRef = useRef(false);
  const speechEndMarkRef = useRef(0);
  const captionRef = useRef("");
  const connectRef = useRef<(resume: boolean) => Promise<Session>>(null!);
  const lastScenePromptRef = useRef<string>("");
  const turnFlagsRef = useRef({ hadRenderScene: false, hadChoices: false });
  const lastPlayerTextRef = useRef("");
  // speculative branch pre-generation: option → in-flight/settled image
  const speculativeRef = useRef<Map<string, Promise<{ dataUrl: string; assetId: string | null } | null>>>(
    new Map(),
  );

  // render mirrors of ref-held game data
  const [data, setData] = useState<PlaythroughData | null>(null);
  const [hp, setHp] = useState(10);
  const [canResume, setCanResume] = useState(false);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [mood, setMood] = useState<Mood>("intro");
  const [caption, setCaption] = useState("");
  const [choices, setChoices] = useState<string[]>([]);
  const [qte, setQte] = useState<QteConfig | null>(null);
  const [dice, setDice] = useState<DiceConfig | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);

  // ---- load playthrough ----
  useEffect(() => {
    let alive = true;
    fetch(`/api/playthroughs/${playthroughId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: PlaythroughData) => {
        if (!alive) return;
        dataRef.current = d;
        setData(d);
        stateRef.current = d.playthrough.state;
        setHp(d.playthrough.state?.hp ?? 10);
        sceneIdxRef.current = d.scenes.length
          ? Math.max(...d.scenes.map((s) => s.idx)) + 1
          : 0;
        setCanResume(sceneIdxRef.current > 0);
        const last = [...d.scenes].sort((a, b) => b.idx - a.idx)[0];
        if (last?.imageAssetId) {
          setImageUrl(`/api/assets/${last.imageAssetId}`);
          lastAssetIdRef.current = last.imageAssetId;
        }
        setPhase("gate");
      })
      .catch((e) => {
        setErrorMsg(String(e));
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [playthroughId]);

  // ---- persistence (fire-and-forget) ----
  const persistBeat = useCallback(
    (payload: Record<string, unknown>) => {
      void fetch("/api/beat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playthroughId, ...payload }),
      }).catch(() => {});
    },
    [playthroughId],
  );

  const respond = useCallback(
    (
      id: string | undefined,
      name: string | undefined,
      response: Record<string, unknown>,
      scheduling: FunctionResponseScheduling = FunctionResponseScheduling.SILENT,
    ) => {
      sessionRef.current?.sendToolResponse({
        functionResponses: [{ id, name, response: { ...response, scheduling } }],
      });
    },
    [],
  );

  // ---- tool executors ----
  const execRenderScene = useCallback(
    async (args: Record<string, unknown>) => {
      const t0 = performance.now();
      setGenerating(true);
      setMood((args.mood as Mood) ?? "explore");
      const data = dataRef.current!;
      try {
        const res = await fetch("/api/scene-image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: args.image_prompt,
            artStyle: data.outline.artStyle,
            mood: args.mood,
            shot: args.shot ?? "new",
            previousAssetId:
              args.shot === "edit" ? lastAssetIdRef.current : undefined,
            playthroughId,
          }),
        });
        if (!res.ok) throw new Error(`scene-image ${res.status}`);
        const { assetId, dataUrl } = await res.json();
        lastScenePromptRef.current = String(args.image_prompt ?? "");
        setImageUrl(dataUrl);
        if (assetId) lastAssetIdRef.current = assetId;
        const idx = sceneIdxRef.current++;
        persistBeat({
          scene: {
            idx,
            beatId: args.beat_id,
            imagePrompt: args.image_prompt,
            imageAssetId: assetId,
          },
          marks: [{ name: "image-on-screen", ms: Math.round(performance.now() - t0) }],
        });
      } catch {
        // keep previous image; Ken Burns hides the gap
      } finally {
        setGenerating(false);
      }
    },
    [persistBeat, playthroughId],
  );

  const handleToolCall = useCallback(
    (msg: LiveServerMessage) => {
      for (const fc of msg.toolCall?.functionCalls ?? []) {
        const args = (fc.args ?? {}) as Record<string, unknown>;
        switch (fc.name) {
          case "render_scene":
            turnFlagsRef.current.hadRenderScene = true;
            respond(fc.id, fc.name, { ok: true });
            void execRenderScene(args);
            break;
          case "present_choices": {
            turnFlagsRef.current.hadChoices = true;
            respond(fc.id, fc.name, { ok: true });
            const options = (args.options as string[]) ?? [];
            setChoices(options);
            // Speculative pre-generation: render every branch's likely next
            // frame in parallel while the player is deciding. Decision time
            // usually exceeds generation time, so the pick swaps in instantly.
            speculativeRef.current = new Map();
            const data = dataRef.current;
            if (data && lastScenePromptRef.current) {
              for (const option of options.slice(0, 4)) {
                const p = fetch("/api/scene-image", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    prompt: `${lastScenePromptRef.current}. The moment after the player chooses: "${option}".`,
                    artStyle: data.outline.artStyle,
                    shot: lastAssetIdRef.current ? "edit" : "new",
                    previousAssetId: lastAssetIdRef.current ?? undefined,
                    playthroughId,
                  }),
                })
                  .then((r) => (r.ok ? r.json() : null))
                  .catch(() => null);
                speculativeRef.current.set(option, p);
              }
            }
            break;
          }
          case "start_qte":
            setQte({
              id: fc.id!,
              name: fc.name!,
              type: (args.type as QteType) ?? "mash",
              difficulty: Number(args.difficulty ?? 3),
              prompt: String(args.prompt ?? "Fight!"),
            });
            setMood("combat");
            break;
          case "skill_check":
            setDice({
              id: fc.id!,
              name: fc.name!,
              stat: (args.stat as Stat) ?? "wit",
              difficulty: Number(args.difficulty ?? 12),
              advantage: Boolean(args.advantage),
            });
            break;
          case "update_state": {
            respond(fc.id, fc.name, { ok: true });
            const patch = parseNarratorPatch(args.patch);
            if (stateRef.current) {
              stateRef.current = applyNarratorPatch(
                stateRef.current,
                patch,
                args.beat_id as string | undefined,
              );
              setHp(stateRef.current.hp);
              persistBeat({ statePatch: { state: stateRef.current } });
            }
            break;
          }
          case "show_ui":
            // M3 wires the UI-Smith; acknowledge so narration continues
            respond(fc.id, fc.name, { ok: true, note: "ui coming soon" });
            break;
          case "end_story":
            respond(fc.id, fc.name, { ok: true });
            setEnding({
              endingId: String(args.ending_id ?? "end"),
              epilogue: String(args.epilogue ?? ""),
            });
            persistBeat({
              statePatch: { status: "ended", endingId: args.ending_id },
            });
            setTimeout(() => setPhase("ended"), 12000);
            break;
          default:
            respond(fc.id, fc.name, { ok: true });
        }
      }
    },
    [respond, execRenderScene, persistBeat, playthroughId],
  );

  // ---- Director: continuity guard + missed-tool fill + social read ----
  const runDirectorPass = useCallback(
    async (turnText: string) => {
      const flags = { ...turnFlagsRef.current };
      turnFlagsRef.current = { hadRenderScene: false, hadChoices: false };
      if (!turnText || turnText.length < 40) return; // skip trivial turns
      try {
        const res = await fetch("/api/director", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            playthroughId,
            turnText,
            playerText: lastPlayerTextRef.current || undefined,
            state: stateRef.current,
            hadRenderScene: flags.hadRenderScene,
            hadChoices: flags.hadChoices,
          }),
        });
        if (!res.ok) return;
        const v = (await res.json()) as {
          continuityIssue: string | null;
          missedScene: { imagePrompt: string; mood: string } | null;
          missedChoices: string[] | null;
          socialPatch: NarratorPatch | null;
        };
        if (v.continuityIssue) {
          // steer the narrator in-fiction; state stays the source of truth
          sessionRef.current?.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: `[CONTINUITY] ${v.continuityIssue} Correct course naturally in your next line without breaking character.`,
                  },
                ],
              },
            ],
            turnComplete: false,
          });
        }
        if (v.missedScene) {
          void execRenderScene({
            image_prompt: v.missedScene.imagePrompt,
            mood: v.missedScene.mood,
            shot: "new",
          });
        }
        if (v.missedChoices) setChoices(v.missedChoices);
        if (v.socialPatch && stateRef.current) {
          stateRef.current = applyNarratorPatch(stateRef.current, v.socialPatch);
          persistBeat({ statePatch: { state: stateRef.current } });
        }
      } catch {
        // director is best-effort; the show goes on
      }
    },
    [playthroughId, execRenderScene, persistBeat],
  );

  // ---- Live session ----
  const connect = useCallback(
    async (resume: boolean) => {
      const res = await fetch("/api/live-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playthroughId,
          resume,
          resumeHandle: resumeHandleRef.current ?? undefined,
        }),
      });
      const { token, model, error } = await res.json();
      if (error) throw new Error(error);

      const ai = new GoogleGenAI({
        apiKey: token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const session = await ai.live.connect({
        model,
        config: {}, // locked server-side in token constraints
        callbacks: {
          onopen: () => {},
          onmessage: (m: LiveServerMessage) => {
            const sc = m.serverContent;
            if (sc?.interrupted) audio.flushPlayback();
            const part = sc?.modelTurn?.parts?.find((p) => p.inlineData?.data);
            if (part?.inlineData?.data) {
              if (speechEndMarkRef.current) {
                persistBeat({
                  marks: [
                    {
                      name: "speech-to-first-audio",
                      ms: Math.round(performance.now() - speechEndMarkRef.current),
                    },
                  ],
                });
                speechEndMarkRef.current = 0;
              }
              audio.playChunk(part.inlineData.data);
            }
            if (sc?.outputTranscription?.text) {
              captionRef.current += sc.outputTranscription.text;
              setCaption(captionRef.current);
            }
            if (sc?.inputTranscription?.text) {
              // player spoke: clear stale choices, mark for latency,
              // accumulate for the director's social read
              speechEndMarkRef.current = performance.now();
              lastPlayerTextRef.current =
                (lastPlayerTextRef.current + " " + sc.inputTranscription.text).slice(-500);
              setChoices([]);
            }
            if (m.toolCall) handleToolCall(m);
            if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
              resumeHandleRef.current = m.sessionResumptionUpdate.newHandle;
              persistBeat({ sessionHandle: m.sessionResumptionUpdate.newHandle });
            }
            if (sc?.turnComplete) {
              const narration = captionRef.current.trim();
              captionRef.current = "";
              if (narration) {
                persistBeat({
                  scene: { idx: Math.max(0, sceneIdxRef.current - 1), narration },
                });
                void runDirectorPass(narration);
              }
            }
            if (m.goAway) {
              // server is about to close: reconnect seamlessly with the handle
              closingRef.current = true;
              sessionRef.current?.close();
            }
          },
          onerror: () => {},
          onclose: () => {
            if (closingRef.current) {
              closingRef.current = false;
              void connectRef.current(true).catch(() => setPhase("error"));
            }
          },
        },
      });
      sessionRef.current = session;
      return session;
    },
    [playthroughId, audio, handleToolCall, persistBeat, runDirectorPass],
  );
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const begin = useCallback(async () => {
    setPhase("connecting");
    try {
      const resume = sceneIdxRef.current > 0;
      const session = await connect(resume);
      await audio.startMic((chunk) => {
        sessionRef.current?.sendRealtimeInput({
          audio: { data: chunk, mimeType: "audio/pcm;rate=16000" },
        });
      });
      audio.ensureOutCtx();
      setPhase("live");
      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              {
                text: resume
                  ? "[SYSTEM] Resuming session. Recap in two atmospheric sentences, re-render the current scene, then continue."
                  : "Begin the story.",
              },
            ],
          },
        ],
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [connect, audio]);

  useEffect(
    () => () => {
      closingRef.current = false;
      sessionRef.current?.close();
      audio.stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---- player inputs ----
  const sendText = useCallback((text: string) => {
    speechEndMarkRef.current = performance.now();
    lastPlayerTextRef.current = text;
    setChoices([]);
    sessionRef.current?.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
    });
  }, []);

  const onChoose = useCallback(
    (option: string) => {
      sendText(`I choose: ${option}`);
      // instant scene swap if this branch's image is already rendered
      const spec = speculativeRef.current.get(option);
      speculativeRef.current = new Map();
      void spec?.then((img) => {
        if (img?.dataUrl) {
          setImageUrl(img.dataUrl);
          if (img.assetId) lastAssetIdRef.current = img.assetId;
        }
      });
    },
    [sendText],
  );

  const onQteDone = useCallback(
    (r: { result: "win" | "lose"; accuracy: number; timeMs: number }) => {
      const q = qte;
      setQte(null);
      setMood(r.result === "win" ? "triumphant" : "tense");
      if (!q) return;
      respond(q.id, q.name, r, FunctionResponseScheduling.INTERRUPT);
      persistBeat({
        scene: { idx: Math.max(0, sceneIdxRef.current - 1), qteResult: r },
      });
    },
    [qte, respond, persistBeat],
  );

  const onDiceDone = useCallback(
    (r: { result: "success" | "fail"; roll: number; secondRoll?: number; total: number }) => {
      const d = dice;
      setDice(null);
      if (!d) return;
      respond(d.id, d.name, r, FunctionResponseScheduling.INTERRUPT);
      persistBeat({
        scene: { idx: Math.max(0, sceneIdxRef.current - 1), diceResult: r },
      });
    },
    [dice, respond, persistBeat],
  );

  // ---- render ----
  if (phase === "loading") {
    return <Shell><p className="text-zinc-500 animate-pulse">loading your story…</p></Shell>;
  }
  if (phase === "error") {
    return (
      <Shell>
        <p className="text-rose-400 mb-3">something broke: {errorMsg}</p>
        <button onClick={() => location.reload()} className="underline text-zinc-300">
          reload
        </button>
      </Shell>
    );
  }
  if (phase === "gate" || phase === "connecting") {
    const resume = canResume;
    return (
      <Shell>
        <h1
          className="text-4xl mb-2 tracking-wide"
          style={{ fontFamily: "var(--font-display, Georgia, serif)" }}
        >
          {data?.outline.title ?? ""}
        </h1>
        <p className="text-zinc-400 mb-8 max-w-md text-center">
          {data?.outline.logline}
        </p>
        <button
          onClick={begin}
          disabled={phase === "connecting"}
          className="rounded-full border border-amber-500/60 text-amber-300 px-8 py-4 text-lg hover:bg-amber-500/10 disabled:opacity-50 transition"
        >
          {phase === "connecting"
            ? "the narrator clears their throat…"
            : resume
              ? "▶ Continue the story"
              : "▶ Begin the story"}
        </button>
        <p className="text-zinc-600 text-xs mt-4">uses your microphone — speak anytime, even to interrupt</p>
      </Shell>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <SceneCanvas imageUrl={imageUrl} caption={caption} mood={mood} generating={generating} />

      {/* HP + mic status */}
      <div className="absolute top-3 left-3 right-3 flex justify-between items-center text-xs z-20">
        <div className="flex gap-1 items-center bg-black/40 rounded-full px-3 py-1.5 backdrop-blur">
          {Array.from({ length: 10 }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-3 rounded-sm ${i < hp ? "bg-rose-500" : "bg-zinc-700"}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 bg-black/40 rounded-full px-3 py-1.5 backdrop-blur text-zinc-300">
          <span className={`w-2 h-2 rounded-full ${audio.speaking ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
          {audio.speaking ? "narrator" : "listening"}
        </div>
      </div>

      <ChoiceBar
        options={choices}
        visible={choices.length > 0 && !qte && !dice && !ending}
        onChoose={onChoose}
        onFreeText={sendText}
        listening={audio.micActive && !audio.speaking}
      />

      {qte?.type === "mash" && (
        <Mash difficulty={qte.difficulty} prompt={qte.prompt} onDone={onQteDone} />
      )}
      {qte?.type === "timed" && (
        <TimedTap difficulty={qte.difficulty} prompt={qte.prompt} onDone={onQteDone} />
      )}
      {qte?.type === "sequence" && (
        <Sequence difficulty={qte.difficulty} prompt={qte.prompt} onDone={onQteDone} />
      )}
      {dice && (
        <DiceRoll
          stat={dice.stat}
          statValue={data?.characters[0]?.stats[dice.stat] ?? 3}
          difficulty={dice.difficulty}
          advantage={dice.advantage}
          onDone={onDiceDone}
        />
      )}

      {ending && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-8 text-center">
          <p
            className="text-amber-300 text-sm tracking-[0.3em] uppercase mb-4"
          >
            The End
          </p>
          <p
            className="text-zinc-100 text-xl max-w-lg leading-relaxed"
            style={{ fontFamily: "var(--font-display, Georgia, serif)" }}
          >
            {ending.epilogue}
          </p>
          <Link href="/" className="mt-10 text-zinc-400 underline hover:text-zinc-200">
            tell another story
          </Link>
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6">
      {children}
    </div>
  );
}
