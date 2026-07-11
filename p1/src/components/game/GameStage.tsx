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
import { MusicMixer, bankForGenre } from "@/components/audio/mixer";
import { playSfx } from "@/components/audio/sfx";
import SceneCanvas from "@/components/game/SceneCanvas";
import ChoiceBar from "@/components/game/ChoiceBar";
import DiceRoll from "@/components/game/DiceRoll";
import ChapterRecap from "@/components/analytics/ChapterRecap";
import UIRenderer from "@/components/genui/UIRenderer";
import ArtifactFrame from "@/components/genui/ArtifactFrame";
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
  storyId: string;
  outline: StoryOutline;
  scenes: { narration: string | null; imageAssetId: string | null; idx: number }[];
  characters: (CharacterSheet & { portraitAssetId?: string | null })[];
}

type GenUiPanel =
  | { kind: "artifact_html"; html: string }
  | { kind: string; spec: unknown };

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
  const mixerRef = useRef<MusicMixer | null>(null);
  const lastScenePromptRef = useRef<string>("");
  const turnFlagsRef = useRef({ hadRenderScene: false, hadChoices: false });
  const lastPlayerTextRef = useRef("");
  // choices are buffered until the narrator finishes the turn — no mid-speech
  // option swaps on screen
  const pendingChoicesRef = useRef<string[] | null>(null);
  // caption updates are throttled to kill per-chunk layout jank
  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNarrationRef = useRef(""); // previous turn's text, for echo detection
  // opening gate: hold narrator audio until the first scene image is visible
  const audioGateRef = useRef<{ active: boolean; queue: string[] }>({
    active: true,
    queue: [],
  });
  const renderSeqRef = useRef(0);
  // portrait phones get portrait art — full frame, no center crop
  const aspectRef = useRef<"16:9" | "9:16">("16:9");
  useEffect(() => {
    const update = () => {
      aspectRef.current = window.innerHeight > window.innerWidth ? "9:16" : "16:9";
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // speculative branch pre-generation: option → in-flight/settled image
  const speculativeRef = useRef<Map<string, Promise<{ dataUrl: string; assetId: string | null } | null>>>(
    new Map(),
  );
  // predictive beat prefetch: outline beatId → in-flight/settled image
  const beatCacheRef = useRef<Map<string, Promise<{ dataUrl: string; assetId: string | null } | null>>>(
    new Map(),
  );
  // what the player said since the narrator last finished a turn
  const utteranceRef = useRef("");
  const provisionalFiredRef = useRef(false);

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
  const [showRecap, setShowRecap] = useState(false);
  const [genUi, setGenUi] = useState<GenUiPanel | null>(null);

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

  // one background image generation, cache-shaped; never touches UI state
  const generateQuiet = useCallback(
    (prompt: string, shot: "new" | "edit") => {
      const data = dataRef.current;
      if (!data) return Promise.resolve(null);
      return fetch("/api/scene-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          artStyle: data.outline.artStyle,
          shot,
          previousAssetId: shot === "edit" ? lastAssetIdRef.current : undefined,
          referenceAssetIds: data.characters
            .map((c) => c.portraitAssetId)
            .filter((x): x is string => Boolean(x)),
          playthroughId,
          aspect: aspectRef.current,
        }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ dataUrl: string; assetId: string | null }>) : null))
        .catch(() => null);
    },
    [playthroughId],
  );

  // Predictive prefetch: after each narrator turn, pre-paint the outline
  // beats reachable from where the player stands. When the narrator later
  // calls render_scene for one of them, the frame is already here.
  const prefetchNextBeats = useCallback(() => {
    const data = dataRef.current;
    const beatId = stateRef.current?.beatId;
    if (!data || !beatId || !lastAssetIdRef.current) return;
    const beat = data.outline.acts.flatMap((a) => a.beats).find((b) => b.id === beatId);
    if (!beat) return;
    const targets = beat.leadsTo.slice(0, 3);
    for (const targetId of targets) {
      if (beatCacheRef.current.has(targetId)) continue;
      const target = data.outline.acts.flatMap((a) => a.beats).find((b) => b.id === targetId);
      if (!target) continue;
      beatCacheRef.current.set(
        targetId,
        generateQuiet(
          `${target.sceneHint}. Continuation of the ongoing story, same protagonist.`,
          "edit",
        ),
      );
    }
    // keep the cache small — drop entries not reachable from here
    for (const key of [...beatCacheRef.current.keys()]) {
      if (!targets.includes(key) && key !== beatId) beatCacheRef.current.delete(key);
    }
  }, [generateQuiet]);

  // release the opening audio gate: flush anything queued and play live after
  const releaseAudioGate = useCallback(() => {
    const gate = audioGateRef.current;
    if (!gate.active) return;
    gate.active = false;
    for (const chunk of gate.queue) audio.playChunk(chunk);
    gate.queue = [];
  }, [audio]);

  // ---- tool executors ----
  const execRenderScene = useCallback(
    async (args: Record<string, unknown>) => {
      const t0 = performance.now();
      const seq = ++renderSeqRef.current;
      setGenerating(true);
      setMood((args.mood as Mood) ?? "explore");
      void mixerRef.current?.play((args.mood as Mood) ?? "explore");
      const data = dataRef.current!;
      // story position advances with the scene, not only with update_state
      if (typeof args.beat_id === "string" && stateRef.current) {
        stateRef.current = applyNarratorPatch(stateRef.current, {}, args.beat_id);
        persistBeat({ statePatch: { state: stateRef.current } });
      }
      // predictive cache: if this beat was prefetched, the frame is instant
      if (typeof args.beat_id === "string" && beatCacheRef.current.has(args.beat_id)) {
        const cached = await beatCacheRef.current.get(args.beat_id)!;
        beatCacheRef.current.delete(args.beat_id);
        if (cached?.dataUrl && renderSeqRef.current === seq) {
          lastScenePromptRef.current = String(args.image_prompt ?? "");
          setImageUrl(cached.dataUrl);
          playSfx("whoosh");
          releaseAudioGate();
          if (cached.assetId) lastAssetIdRef.current = cached.assetId;
          const idx = sceneIdxRef.current++;
          persistBeat({
            scene: {
              idx,
              beatId: args.beat_id,
              imagePrompt: args.image_prompt,
              imageAssetId: cached.assetId,
            },
            marks: [{ name: "image-on-screen", ms: Math.round(performance.now() - t0) }],
          });
          setGenerating(false);
          return;
        }
      }
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
            // protagonist consistency: portrait rides along as reference
            referenceAssetIds: data.characters
              .map((c) => c.portraitAssetId)
              .filter((x): x is string => Boolean(x)),
            playthroughId,
            aspect: aspectRef.current,
          }),
        });
        if (!res.ok) throw new Error(`scene-image ${res.status}`);
        const { assetId, dataUrl } = await res.json();
        lastScenePromptRef.current = String(args.image_prompt ?? "");
        setImageUrl(dataUrl);
        playSfx("whoosh");
        releaseAudioGate();
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

        // Visual progression: for high-drama moods, paint a follow-up frame
        // of the same scene (edit mode) and crossfade to it while the
        // narrator is still talking — the scene visibly moves.
        const mood = String(args.mood ?? "");
        if (args.shot !== "edit" && assetId && ["combat", "tense", "triumphant"].includes(mood)) {
          setTimeout(() => {
            if (renderSeqRef.current !== seq) return; // a newer scene took over
            void fetch("/api/scene-image", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                prompt: `${args.image_prompt}. A few heartbeats later — the action has visibly progressed.`,
                artStyle: data.outline.artStyle,
                shot: "edit",
                previousAssetId: assetId,
                playthroughId,
                aspect: aspectRef.current,
              }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((follow: { assetId: string | null; dataUrl: string } | null) => {
                if (follow?.dataUrl && renderSeqRef.current === seq) {
                  setImageUrl(follow.dataUrl);
                  if (follow.assetId) lastAssetIdRef.current = follow.assetId;
                }
              })
              .catch(() => {});
          }, 6000);
        }
      } catch {
        releaseAudioGate(); // never hold narration hostage to a failed image
      } finally {
        setGenerating(false);
      }
    },
    [persistBeat, playthroughId, releaseAudioGate],
  );

  // Provisional frame from the player's OWN words: the scene starts moving
  // the moment the narrator starts answering, without waiting for its
  // render_scene call. A canonical frame that lands later simply replaces it.
  const fireProvisionalFrame = useCallback(() => {
    if (provisionalFiredRef.current) return;
    const said = utteranceRef.current.trim();
    if (said.length < 8 || !lastScenePromptRef.current) return;
    provisionalFiredRef.current = true;
    const seq = renderSeqRef.current;

    // 1) did they effectively pick a pre-rendered branch out loud?
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3);
    const saidWords = new Set(norm(said));
    for (const [option, promise] of speculativeRef.current) {
      const ow = norm(option);
      if (ow.length && ow.filter((w) => saidWords.has(w)).length / ow.length >= 0.5) {
        void promise.then((img) => {
          if (img?.dataUrl && renderSeqRef.current === seq) {
            setImageUrl(img.dataUrl);
            playSfx("whoosh");
            if (img.assetId) lastAssetIdRef.current = img.assetId;
          }
        });
        return;
      }
    }

    // 2) otherwise paint the immediate consequence of what they said
    void generateQuiet(
      `${lastScenePromptRef.current}. The player just said or did: "${said.slice(0, 160)}" — show the immediate consequence in the same scene.`,
      "edit",
    ).then((img) => {
      if (img?.dataUrl && renderSeqRef.current === seq) {
        setImageUrl(img.dataUrl);
        if (img.assetId) lastAssetIdRef.current = img.assetId;
      }
    });
  }, [generateQuiet]);

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
            respond(fc.id, fc.name, {
              ok: true,
              note: "choices are on screen — finish your sentence, then stop and wait for the player's decision",
            });
            const options = (args.options as string[]) ?? [];
            // buffer: options appear when the narrator finishes speaking,
            // never mutate mid-sentence
            pendingChoicesRef.current = options;
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
                    aspect: aspectRef.current,
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
            void mixerRef.current?.play("combat");
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
            playSfx("dice");
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
          case "show_ui": {
            respond(fc.id, fc.name, { ok: true });
            void fetch("/api/gen-ui", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                kind: args.kind,
                context: args.context,
                playthroughId,
              }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((panel: GenUiPanel | null) => {
                if (panel) {
                  playSfx("pop");
                  setGenUi(panel);
                  persistBeat({
                    scene: { idx: Math.max(0, sceneIdxRef.current - 1), genUi: panel },
                  });
                }
              })
              .catch(() => {});
            break;
          }
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
          spokeSuggestions?: boolean;
          trueMood?: string | null;
        };
        // the score follows the real emotional beat, even when the narrator
        // didn't call render_scene this turn
        if (v.trueMood) {
          setMood(v.trueMood as Mood);
          void mixerRef.current?.play(v.trueMood);
        }
        if (v.spokeSuggestions) {
          sessionRef.current?.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: "[STYLE] You spoke the player's options aloud again. Never do that — the buttons on screen carry the options. End on tension and go silent.",
                  },
                ],
              },
            ],
            turnComplete: false,
          });
        }
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
        // never fight the narrator: only fill choices if none are up
        if (v.missedChoices && !pendingChoicesRef.current) {
          setChoices((cur) => (cur.length ? cur : v.missedChoices!));
        }
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
            if (sc?.interrupted) {
              audio.flushPlayback();
              audioGateRef.current.queue = [];
            }
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
              const gate = audioGateRef.current;
              if (gate.active) {
                // opening: hold voice until the first scene image is up
                gate.queue.push(part.inlineData.data);
              } else {
                audio.playChunk(part.inlineData.data);
              }
              // narrator has started answering — the player's words are final
              if (utteranceRef.current) fireProvisionalFrame();
            }
            if (sc?.outputTranscription?.text) {
              captionRef.current += sc.outputTranscription.text;
              // throttle caption paints (~350ms) — the text still arrives
              // well ahead of the voice, without per-chunk layout jitter
              if (!captionTimerRef.current) {
                captionTimerRef.current = setTimeout(() => {
                  captionTimerRef.current = null;
                  setCaption(captionRef.current);
                }, 350);
              }
            }
            if (sc?.inputTranscription?.text) {
              const heard = sc.inputTranscription.text;
              // echo guard: on speakers, the mic can pick up the narrator's
              // own words — if the "player input" is a substring of what the
              // narrator just said, it isn't the player. Don't let it clear
              // choices or fire provisional frames.
              const recentOut = (captionRef.current + " " + lastNarrationRef.current).toLowerCase();
              const words = heard.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
              const isEcho =
                words.length >= 3 &&
                words.filter((w) => recentOut.includes(w)).length / words.length > 0.8;
              if (!isEcho) {
                // player spoke: clear stale choices, mark for latency,
                // accumulate for the director's social read + provisional frame
                speechEndMarkRef.current = performance.now();
                lastPlayerTextRef.current =
                  (lastPlayerTextRef.current + " " + heard).slice(-500);
                utteranceRef.current = (utteranceRef.current + " " + heard).slice(-300);
                provisionalFiredRef.current = false;
                setChoices([]);
              }
            }
            if (m.toolCall) handleToolCall(m);
            if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
              resumeHandleRef.current = m.sessionResumptionUpdate.newHandle;
              persistBeat({ sessionHandle: m.sessionResumptionUpdate.newHandle });
            }
            if (sc?.turnComplete) {
              const narration = captionRef.current.trim();
              if (narration) lastNarrationRef.current = narration;
              captionRef.current = "";
              if (captionTimerRef.current) {
                clearTimeout(captionTimerRef.current);
                captionTimerRef.current = null;
              }
              setCaption(narration); // final full text, stable
              // reveal the buffered choices now that the narrator is done
              if (pendingChoicesRef.current) {
                setChoices(pendingChoicesRef.current);
                pendingChoicesRef.current = null;
              }
              releaseAudioGate(); // safety: never gate past the first turn
              utteranceRef.current = "";
              provisionalFiredRef.current = false;
              if (narration) {
                persistBeat({
                  scene: { idx: Math.max(0, sceneIdxRef.current - 1), narration },
                });
                void runDirectorPass(narration);
              }
              // pre-paint wherever the story can go next
              prefetchNextBeats();
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
    [playthroughId, audio, handleToolCall, persistBeat, runDirectorPass, releaseAudioGate, fireProvisionalFrame, prefetchNextBeats],
  );
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const begin = useCallback(async () => {
    setPhase("connecting");
    try {
      // music mixer must start inside the user gesture (iOS autoplay rules)
      if (!mixerRef.current && dataRef.current) {
        mixerRef.current = new MusicMixer(bankForGenre(dataRef.current.outline.genre));
        mixerRef.current.start();
        audio.setDuckHandler((speaking) => mixerRef.current?.setSpeaking(speaking));
        void mixerRef.current.play("intro");
      }
      const resume = sceneIdxRef.current > 0;
      // hold the narrator's voice until the first image is on screen —
      // unless a saved scene image is already showing (resume)
      audioGateRef.current = { active: !lastAssetIdRef.current, queue: [] };
      setTimeout(releaseAudioGate, 9000); // failsafe: image slow ≠ silence forever
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
                  ? "[SYSTEM] Resuming session. Recap where the story stands in two atmospheric sentences, call render_scene for the current moment, then continue from exactly where we left off."
                  : "[SYSTEM] New story. Call render_scene for the establishing shot, then deliver your opening preface — the world, the stakes, who I am — and flow into the first scene.",
              },
            ],
          },
        ],
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [connect, audio, releaseAudioGate]);

  useEffect(
    () => () => {
      closingRef.current = false;
      sessionRef.current?.close();
      audio.stop();
      mixerRef.current?.dispose();
      mixerRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---- player inputs ----
  const sendText = useCallback((text: string) => {
    speechEndMarkRef.current = performance.now();
    lastPlayerTextRef.current = text;
    utteranceRef.current = text;
    provisionalFiredRef.current = false;
    setChoices([]);
    sessionRef.current?.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
    });
  }, []);

  const onChoose = useCallback(
    (option: string) => {
      playSfx("tap");
      sendText(`I choose: ${option}`);
      // instant scene swap if this branch's image is already rendered;
      // the provisional path is redundant for button picks
      provisionalFiredRef.current = true;
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
      playSfx(r.result === "win" ? "win" : "lose");
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
      playSfx(r.result === "success" ? "win" : "lose");
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRecap(true)}
            className="bg-black/40 rounded-full px-3 py-1.5 backdrop-blur text-zinc-300 hover:text-amber-300"
          >
            ◈ map
          </button>
          <div className="flex items-center gap-2 bg-black/40 rounded-full px-3 py-1.5 backdrop-blur text-zinc-300">
            <span className={`w-2 h-2 rounded-full ${audio.speaking ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
            {audio.speaking ? "narrator" : "listening"}
          </div>
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
          <button
            onClick={() => setShowRecap(true)}
            className="mt-8 rounded-full border border-amber-500/60 text-amber-300 px-6 py-3 hover:bg-amber-500/10"
          >
            ◈ see your journey
          </button>
          <Link href="/" className="mt-4 text-zinc-400 underline hover:text-zinc-200">
            tell another story
          </Link>
        </div>
      )}

      {genUi &&
        (genUi.kind === "artifact_html" ? (
          <ArtifactFrame
            html={(genUi as { html: string }).html}
            onClose={() => setGenUi(null)}
          />
        ) : (
          <UIRenderer
            kind={genUi.kind}
            spec={(genUi as { spec: unknown }).spec}
            onClose={() => setGenUi(null)}
          />
        ))}

      {showRecap && data && (
        <ChapterRecap
          storyKey={data.storyId}
          playthroughId={playthroughId}
          onClose={() => setShowRecap(false)}
        />
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
