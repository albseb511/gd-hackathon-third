"use client";

// Scripted playback for the prebuilt stories: a deterministic state-machine
// over pre-rendered audio (narrator + character voices) with forged scene
// images. No Live session, no per-turn generation — instant and ~free.
// Reuses the live stack's presentation queue, scene canvas, choice bar,
// music mixer, QTE overlays, and cast panel.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PresentationQueue, SpeakerInfo } from "@/components/audio/presentationQueue";
import { MusicMixer, bankForGenre } from "@/components/audio/mixer";
import { playSfx } from "@/components/audio/sfx";
import SceneCanvas from "@/components/game/SceneCanvas";
import ChoiceBar from "@/components/game/ChoiceBar";
import CastPanel from "@/components/game/CastPanel";
import Mash from "@/components/game/qte/Mash";
import TimedTap from "@/components/game/qte/TimedTap";
import Sequence from "@/components/game/qte/Sequence";
import { Mood, PlayState, StoryOutline, CharacterSheet } from "@/lib/storyEngine/types";
import { loadScriptedStory, ScriptedStory, ScriptedBeat } from "@/lib/scriptedStory";

interface PlaythroughData {
  playthrough: { id: string; state: PlayState; summary: string | null };
  storyId: string;
  outline: StoryOutline;
  characters: (CharacterSheet & { portraitAssetId?: string | null })[];
}

export default function ScriptedStage({
  playthroughId,
  scriptedId,
}: {
  playthroughId: string;
  scriptedId: string;
}) {
  const [phase, setPhase] = useState<"loading" | "gate" | "live" | "ended" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const dataRef = useRef<PlaythroughData | null>(null);
  const scriptRef = useRef<ScriptedStory | null>(null);
  const queueRef = useRef<PresentationQueue | null>(null);
  const mixerRef = useRef<MusicMixer | null>(null);
  const beatIdRef = useRef<string>("");
  const playSeqRef = useRef(0);

  const [data, setData] = useState<PlaythroughData | null>(null);
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mood, setMood] = useState<Mood>("intro");
  const [speakerInfo, setSpeakerInfo] = useState<SpeakerInfo | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [outputBusy, setOutputBusy] = useState(false);
  const [qte, setQte] = useState<ScriptedBeat["qte"] | null>(null);
  const [ending, setEnding] = useState<{ endingId: string; line: string } | null>(null);
  const [showCast, setShowCast] = useState(false);
  const [charactersInView, setCharactersInView] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);

  // ---- load playthrough + script ----
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/playthroughs/${playthroughId}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)),
      ),
      loadScriptedStory(scriptedId),
    ])
      .then(([d, script]: [PlaythroughData, ScriptedStory | null]) => {
        if (!alive) return;
        if (!script) throw new Error("script unavailable");
        dataRef.current = d;
        setData(d);
        scriptRef.current = script;
        setTitle(d.outline.title);
        const resumeBeat = d.playthrough.state?.beatId;
        beatIdRef.current =
          resumeBeat && script.beats[resumeBeat] ? resumeBeat : script.startBeat;
        const forged =
          d.playthrough.state?.assetLibrary?.scenes?.[beatIdRef.current] ??
          Object.values(d.playthrough.state?.assetLibrary?.scenes ?? {})[0];
        if (forged) setImageUrl(`/api/assets/${forged}`);
        setPhase("gate");
      })
      .catch((e) => {
        if (alive) {
          setErrorMsg(String(e));
          setPhase("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [playthroughId, scriptedId]);

  // ---- output-busy poll (drives choice/input gating, same as live) ----
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => {
      setOutputBusy(queueRef.current ? !queueRef.current.drained : false);
    }, 120);
    return () => clearInterval(id);
  }, [phase]);

  const persistPosition = useCallback(
    (beatId: string) => {
      const st = dataRef.current?.playthrough.state;
      if (!st) return;
      const path = st.path?.includes(beatId) ? st.path : [...(st.path ?? []), beatId];
      const next = { ...st, beatId, path };
      dataRef.current!.playthrough.state = next;
      void fetch("/api/beat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playthroughId, statePatch: { state: next } }),
      }).catch(() => {});
    },
    [playthroughId],
  );

  // ---- play a beat: audio lines in order, then reveal choices / QTE / ending ----
  const playBeat = useCallback(
    async (beatId: string) => {
      const script = scriptRef.current;
      const q = queueRef.current;
      const beat = script?.beats[beatId];
      if (!script || !q || !beat) return;
      const seq = ++playSeqRef.current;
      beatIdRef.current = beatId;
      persistPosition(beatId);
      setChoices([]);
      setQte(null);

      // scene image (forged, per-playthrough) + mood music
      const forged = dataRef.current?.playthrough.state?.assetLibrary?.scenes?.[beatId];
      if (forged) setImageUrl(`/api/assets/${forged}`);
      setMood((beat.mood as Mood) ?? "tense");
      void mixerRef.current?.play((beat.mood as Mood) ?? "tense");

      // who's on camera this beat
      setCharactersInView(
        [...new Set(beat.lines.map((l) => l.speaker).filter((s) => s.toLowerCase() !== "narrator"))],
      );

      // decode & queue every line (decode runs in parallel; queue plays in order)
      for (const line of beat.lines) {
        if (playSeqRef.current !== seq) return; // superseded
        q.pushClip(line.speaker, line.text, q.decodeUrl(line.audio));
      }

      // wait until the whole beat has played out
      await q.waitForDrain();
      if (playSeqRef.current !== seq) return;

      if (beat.isEnding) {
        const spoken = beat.lines.map((l) => l.text).join(" ").trim();
        const endingId = beat.endingId ?? beatId;
        // some endings may have no rendered audio yet — fall back to a
        // tone-appropriate closing line so the finale still lands.
        const tone = dataRef.current?.outline.endings?.find((e) => e.id === endingId)?.tone;
        setEnding({ endingId, line: spoken || endingFallback(tone) });
        setTimeout(() => setPhase("ended"), 10000);
        return;
      }
      if (beat.qte) {
        setQte(beat.qte);
        return;
      }
      setChoices(beat.choices.map((c) => c.label));
    },
    [persistPosition],
  );

  const begin = useCallback(() => {
    if (!queueRef.current) {
      const q = new PresentationQueue();
      q.ensureCtx();
      q.onSpeaker = (info) => {
        setSpeakerInfo(info);
        if (info && info.speaker.toLowerCase() !== "narrator") {
          setCharactersInView((cur) =>
            cur.some((n) => n.toLowerCase() === info.speaker.toLowerCase())
              ? cur
              : [...cur, info.speaker],
          );
        }
      };
      queueRef.current = q;
    }
    if (!mixerRef.current && dataRef.current) {
      mixerRef.current = new MusicMixer(bankForGenre(dataRef.current.outline.genre));
      mixerRef.current.start();
      void mixerRef.current.play("intro");
    }
    setPhase("live");
    void playBeat(beatIdRef.current);
  }, [playBeat]);

  const onChoose = useCallback(
    (label: string) => {
      playSfx("tap");
      const beat = scriptRef.current?.beats[beatIdRef.current];
      const choice = beat?.choices.find((c) => c.label === label);
      setChoices([]);
      if (choice) void playBeat(choice.next);
    },
    [playBeat],
  );

  const onQteDone = useCallback(
    (r: { result: "win" | "lose" }) => {
      const beat = scriptRef.current?.beats[beatIdRef.current];
      const q = beat?.qte;
      setQte(null);
      playSfx(r.result === "win" ? "win" : "lose");
      if (q) void playBeat(r.result === "win" ? q.winNext : q.loseNext);
    },
    [playBeat],
  );

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      queueRef.current?.setPaused(next);
      mixerRef.current?.setPaused(next);
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      queueRef.current?.dispose();
      queueRef.current = null;
      mixerRef.current?.dispose();
      mixerRef.current = null;
    },
    [],
  );

  // ---- render ----
  if (phase === "loading")
    return <Shell><p className="text-zinc-500 animate-pulse">loading your story…</p></Shell>;
  if (phase === "error")
    return (
      <Shell>
        <p className="text-rose-400 mb-3">something broke: {errorMsg}</p>
        <button onClick={() => location.reload()} className="underline text-zinc-300">reload</button>
      </Shell>
    );
  if (phase === "gate") {
    const resume = (data?.playthrough.state?.path?.length ?? 0) > 1;
    return (
      <Shell>
        <h1 className="text-4xl mb-2 tracking-wide" style={{ fontFamily: "var(--font-display, Georgia, serif)" }}>
          {title}
        </h1>
        <p className="text-zinc-400 mb-8 max-w-md text-center">{data?.outline.logline}</p>
        <button
          onClick={begin}
          className="rounded-full border border-amber-500/60 text-amber-300 px-8 py-4 text-lg hover:bg-amber-500/10 transition"
        >
          {resume ? "▶ Continue the story" : "▶ Begin the story"}
        </button>
        <p className="text-zinc-600 text-xs mt-4">a fully voiced, choice-driven tale</p>
      </Shell>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <SceneCanvas
        imageUrl={imageUrl}
        caption={speakerInfo?.line ? `“${speakerInfo.line}”` : ""}
        speaker={speakerInfo?.speaker ?? null}
        raiseCaption={!qte && !ending && !outputBusy}
        mood={mood}
      />

      <div className="absolute top-3 left-3 right-3 flex justify-end items-center text-xs z-20">
        <div className="flex items-center gap-2">
          <button onClick={togglePause} className="bg-black/40 rounded-full px-3 py-1.5 backdrop-blur text-zinc-300 hover:text-amber-300">
            {paused ? "▶" : "⏸"}
          </button>
          {(data?.outline.characters.length ?? 0) > 0 && (
            <button onClick={() => setShowCast(true)} className="bg-black/40 rounded-full px-3 py-1.5 backdrop-blur text-zinc-300 hover:text-amber-300">
              ❦ cast
            </button>
          )}
          <div className="flex items-center gap-2 bg-black/40 rounded-full px-3 py-1.5 backdrop-blur text-zinc-300">
            <span className={`w-2 h-2 rounded-full ${outputBusy ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
            {speakerInfo ? speakerInfo.speaker : outputBusy ? "…" : "your move"}
          </div>
        </div>
      </div>

      <ChoiceBar
        options={choices}
        visible={!qte && !ending && choices.length > 0}
        onChoose={onChoose}
        onFreeText={onChoose}
        listening={false}
      />

      {qte?.type === "mash" && <Mash difficulty={qte.difficulty} prompt={qte.prompt} onDone={onQteDone} />}
      {qte?.type === "timed" && <TimedTap difficulty={qte.difficulty} prompt={qte.prompt} onDone={onQteDone} />}
      {qte?.type === "sequence" && <Sequence difficulty={qte.difficulty} prompt={qte.prompt} onDone={onQteDone} />}

      {ending && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-8 text-center">
          {(() => {
            const card = data?.playthrough.state?.assetLibrary?.cards?.[ending.endingId];
            return card ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/assets/${card}`} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 -z-10" draggable={false} />
            ) : null;
          })()}
          <p className="text-amber-300 text-sm tracking-[0.3em] uppercase mb-4">The End</p>
          <p className="text-zinc-100 text-xl max-w-lg leading-relaxed" style={{ fontFamily: "var(--font-display, Georgia, serif)" }}>
            {ending.line}
          </p>
          <Link href="/" className="mt-10 text-zinc-400 underline hover:text-zinc-200">tell another story</Link>
        </div>
      )}

      <CastPanel
        characters={data?.outline.characters ?? []}
        portraits={
          data?.playthrough.state?.assetLibrary?.npcs ??
          data?.playthrough.state?.npcPortraits ??
          {}
        }
        inView={charactersInView}
        open={showCast}
        onClose={() => setShowCast(false)}
      />

      {paused && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/75 backdrop-blur-md" onClick={togglePause}>
          <p className="text-amber-300 text-sm tracking-[0.4em] uppercase mb-8">Paused</p>
          <button className="rounded-full border border-amber-500/60 text-amber-300 px-8 py-4 text-lg hover:bg-amber-500/10" onClick={togglePause}>
            ▶ Resume
          </button>
        </div>
      )}
    </div>
  );
}

// Closing line when an ending has no rendered audio, keyed to its tone.
function endingFallback(tone?: string): string {
  switch (tone) {
    case "triumphant":
      return "Against every odd, you made it through — and the dark holds no more fear for you.";
    case "tragic":
      return "Some choices cannot be unmade. The silence that follows is yours to carry.";
    case "bittersweet":
      return "You won, but not without cost. What you saved and what you lost will travel with you always.";
    default:
      return "And so your story comes to rest — every choice along the way was your own.";
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6">
      {children}
    </div>
  );
}
