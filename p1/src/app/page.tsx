"use client";

// VOICEBOUND — title / story-select screen.
// Client component on purpose: it owns deviceKey (localStorage), the resume
// list, and the start-playthrough flow. prebuiltStories is dependency-free
// and safe to import client-side.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { prebuiltStories, type PrebuiltStoryId } from "@/lib/prebuilt";
import "@/components/game/overlays.css";

const DEVICE_KEY_STORAGE = "vb-device-key";

function ensureDeviceKey(): string {
  let key = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY_STORAGE, key);
  }
  return key;
}

interface ResumeItem {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  sceneCount: number;
  lastImageAssetId: string | null;
}

// ---- per-story poster art: pure CSS, no image assets -----------------------

interface CardTheme {
  accent: string;
  kicker: string;
  art: React.CSSProperties;
  glow: string; // hover glow color
}

const CARD_THEMES: Record<PrebuiltStoryId, CardTheme> = {
  noir: {
    accent: "#7dd8ff",
    kicker: "CASE FILE No. 1",
    glow: "rgba(125, 216, 255, 0.22)",
    art: {
      background: [
        // neon sign bleed
        "radial-gradient(ellipse 70% 45% at 82% 18%, rgba(94, 200, 255, 0.34), transparent 65%)",
        "radial-gradient(ellipse 55% 35% at 18% 80%, rgba(255, 84, 140, 0.16), transparent 70%)",
        // rain streaks
        "repeating-linear-gradient(115deg, transparent 0px, transparent 9px, rgba(140, 200, 255, 0.05) 9px, rgba(140, 200, 255, 0.05) 10px)",
        // drowned-city depths
        "linear-gradient(165deg, #0a1830 0%, #061024 45%, #030812 100%)",
      ].join(", "),
    },
  },
  fantasy: {
    accent: "#ffb968",
    kicker: "SAGA OF THE DEEP HALLS",
    glow: "rgba(255, 165, 82, 0.25)",
    art: {
      background: [
        // hearth glow from below
        "radial-gradient(ellipse 75% 55% at 50% 108%, rgba(255, 128, 48, 0.42), transparent 68%)",
        "radial-gradient(ellipse 40% 28% at 22% 24%, rgba(255, 190, 110, 0.14), transparent 70%)",
        // drifting ash motes
        "radial-gradient(circle 2px at 30% 40%, rgba(255,170,90,0.5) 40%, transparent 60%)",
        "radial-gradient(circle 1.5px at 68% 26%, rgba(255,150,70,0.42) 40%, transparent 60%)",
        "radial-gradient(circle 1.5px at 82% 58%, rgba(255,190,120,0.34) 40%, transparent 60%)",
        // mountain-hold dark
        "linear-gradient(165deg, #2b1408 0%, #1c0c05 50%, #0d0503 100%)",
      ].join(", "),
    },
  },
  starship: {
    accent: "#7ff0dc",
    kicker: "DISTRESS LOG 0-6-0-0",
    glow: "rgba(110, 235, 210, 0.2)",
    art: {
      background: [
        // dying reactor glow
        "radial-gradient(ellipse 60% 40% at 50% -12%, rgba(96, 226, 202, 0.3), transparent 65%)",
        // starfield
        "radial-gradient(circle 1.5px at 18% 34%, rgba(220,250,245,0.8) 40%, transparent 60%)",
        "radial-gradient(circle 1px at 44% 62%, rgba(200,240,235,0.6) 40%, transparent 60%)",
        "radial-gradient(circle 1.5px at 70% 28%, rgba(220,250,245,0.7) 40%, transparent 60%)",
        "radial-gradient(circle 1px at 86% 74%, rgba(200,240,235,0.55) 40%, transparent 60%)",
        "radial-gradient(circle 1px at 58% 86%, rgba(200,240,235,0.45) 40%, transparent 60%)",
        "radial-gradient(circle 1px at 8% 78%, rgba(200,240,235,0.5) 40%, transparent 60%)",
        // the void
        "linear-gradient(170deg, #04202a 0%, #02121c 45%, #01070d 100%)",
      ].join(", "),
    },
  },
};

// ---------------------------------------------------------------------------

export default function Home() {
  const router = useRouter();
  const [resume, setResume] = useState<ResumeItem[]>([]);
  const [starting, setStarting] = useState<PrebuiltStoryId | "custom" | null>(null);
  const [premise, setPremise] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Resume list: only if this device has a key already (never create on load).
  useEffect(() => {
    const key = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (!key) return;
    fetch(`/api/playthroughs?deviceKey=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : { playthroughs: [] }))
      .then((data) => setResume(data.playthroughs ?? []))
      .catch(() => {});
  }, []);

  async function start(payload: { storyId?: PrebuiltStoryId; premise?: string }) {
    const which = payload.storyId ?? "custom";
    setStarting(which);
    setError(null);
    try {
      const res = await fetch("/api/playthroughs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, deviceKey: ensureDeviceKey() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 503
            ? "Connect a database to create custom stories — the three tales below play without one."
            : (data.error ?? "Something went wrong starting the story."),
        );
        setStarting(null);
        return;
      }
      router.push(`/play/${data.playthroughId}`);
    } catch {
      setError("Could not reach the storyteller. Try again.");
      setStarting(null);
    }
  }

  return (
    <div
      className="relative min-h-dvh w-full overflow-x-hidden bg-zinc-950"
      style={
        {
          "--vb-paper": "#f2e8d5",
          "--vb-gold": "#d9b36c",
          "--vb-gold-bright": "#f0d090",
          "--vb-display": "var(--font-display, Georgia, 'Times New Roman', serif)",
          fontFamily: "var(--vb-display)",
          color: "var(--vb-paper)",
        } as React.CSSProperties
      }
    >
      <style>{`
        .vb-card { transition: transform 300ms ease, box-shadow 300ms ease, border-color 300ms ease; }
        .vb-card:hover:not(:disabled) { transform: translateY(-4px); }
        .vb-card:hover:not(:disabled) .vb-card-cta { color: var(--vb-gold-bright); }
        .vb-card:hover:not(:disabled) .vb-card-cta .vb-arrow { transform: translateX(5px); }
        .vb-arrow { display: inline-block; transition: transform 250ms ease; }
        .vb-card:active:not(:disabled) { transform: translateY(-1px); }
        .vb-resume:hover { border-color: rgba(217, 179, 108, 0.55); transform: translateY(-2px); }
        .vb-resume { transition: transform 250ms ease, border-color 250ms ease; }
        .vb-reveal { animation: vn-rise-in 700ms ease-out both; }
        .vb-textarea::placeholder { color: rgba(242, 232, 213, 0.28); font-style: italic; }
        .vb-textarea:focus { outline: none; border-color: rgba(217, 179, 108, 0.6); box-shadow: 0 0 0 1px rgba(217, 179, 108, 0.25), 0 0 40px rgba(217, 179, 108, 0.06); }
        @keyframes vb-flicker { 0%, 100% { opacity: 1; } 92% { opacity: 1; } 94% { opacity: 0.86; } 96% { opacity: 1; } 98% { opacity: 0.93; } }
        @media (prefers-reduced-motion: reduce) {
          .vb-reveal { animation: none; }
          .vb-card, .vb-resume, .vb-arrow { transition: none; }
        }
      `}</style>

      {/* ---- atmosphere: candlelight, vignette, grain ---- */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% -8%, rgba(217, 179, 108, 0.10), transparent 60%), radial-gradient(ellipse 70% 50% at 50% 110%, rgba(120, 70, 20, 0.10), transparent 65%)",
          animation: "vb-flicker 7s linear infinite",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 90% at 50% 42%, transparent 50%, rgba(4, 3, 2, 0.6) 100%)",
        }}
      />
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="vn-grain" />
      </div>

      <main className="relative mx-auto flex w-full max-w-5xl flex-col px-6 pb-24 pt-20 sm:pt-28">
        {/* ================= title ================= */}
        <header className="vb-reveal flex flex-col items-center text-center">
          <p className="vn-kicker" style={{ color: "var(--vb-gold)" }}>
            A voice-driven visual novel
          </p>
          <h1
            className="mt-5 text-5xl sm:text-7xl"
            style={{
              letterSpacing: "0.18em",
              fontWeight: 400,
              background:
                "linear-gradient(180deg, #f7edd8 20%, var(--vb-gold-bright) 55%, #9a7638 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              textShadow: "0 0 60px rgba(217, 179, 108, 0.18)",
            }}
          >
            VOICEBOUND
          </h1>
          <div className="mt-6 flex items-center gap-4" aria-hidden>
            <span className="h-px w-16 sm:w-24" style={{ background: "linear-gradient(to left, rgba(217,179,108,0.6), transparent)" }} />
            <span style={{ color: "var(--vb-gold)", fontSize: 11 }}>✦</span>
            <span className="h-px w-16 sm:w-24" style={{ background: "linear-gradient(to right, rgba(217,179,108,0.6), transparent)" }} />
          </div>
          <p className="mt-5 text-lg italic sm:text-xl" style={{ color: "rgba(242, 232, 213, 0.72)" }}>
            A story that listens back.
          </p>
        </header>

        {/* ================= continue ================= */}
        {resume.length > 0 && (
          <section className="vb-reveal mt-16" style={{ animationDelay: "120ms" }}>
            <h2 className="vn-kicker mb-4" style={{ color: "var(--vb-gold)" }}>
              Continue
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "thin" }}>
              {resume.map((p) => (
                <Link
                  key={p.id}
                  href={`/play/${p.id}`}
                  className="vb-resume flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border"
                  style={{
                    borderColor: "rgba(217, 179, 108, 0.22)",
                    background: "rgba(20, 16, 10, 0.6)",
                  }}
                >
                  <div className="relative h-28 w-full overflow-hidden">
                    {p.lastImageAssetId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/assets/${p.lastImageAssetId}`}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div
                        className="h-full w-full"
                        style={{
                          background:
                            "radial-gradient(ellipse at 50% 30%, #241c10 0%, #0d0a06 75%)",
                        }}
                      />
                    )}
                    <div
                      className="absolute inset-0"
                      style={{
                        background: "linear-gradient(to top, rgba(10,8,5,0.85), transparent 55%)",
                      }}
                    />
                    {p.status === "ended" && (
                      <span
                        className="absolute right-2 top-2 rounded px-2 py-0.5 text-[10px] uppercase"
                        style={{
                          letterSpacing: "0.2em",
                          background: "rgba(8, 6, 4, 0.75)",
                          color: "var(--vb-gold)",
                          border: "1px solid rgba(217,179,108,0.35)",
                        }}
                      >
                        The End
                      </span>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    <p className="truncate text-base" style={{ color: "var(--vb-paper)" }}>
                      {p.title}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "rgba(242,232,213,0.5)" }}>
                      {p.sceneCount === 1 ? "1 scene" : `${p.sceneCount} scenes`}
                      {" · "}
                      {p.status === "ended" ? "finished" : "in progress"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ================= prebuilt stories ================= */}
        <section className="vb-reveal mt-16" style={{ animationDelay: "220ms" }}>
          <h2 className="vn-kicker mb-5" style={{ color: "var(--vb-gold)" }}>
            Choose your tale
          </h2>
          <div className="grid gap-5 md:grid-cols-3">
            {prebuiltStories.map((story, i) => {
              const theme = CARD_THEMES[story.id];
              const busy = starting === story.id;
              return (
                <button
                  key={story.id}
                  type="button"
                  disabled={starting !== null}
                  onClick={() => start({ storyId: story.id })}
                  className="vb-card vb-reveal group relative flex min-h-[22rem] flex-col overflow-hidden rounded-xl border text-left disabled:cursor-wait"
                  style={{
                    animationDelay: `${280 + i * 110}ms`,
                    borderColor: "rgba(242, 232, 213, 0.12)",
                    boxShadow: `0 20px 50px -20px rgba(0,0,0,0.8), 0 0 0 0 transparent`,
                    ...theme.art,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = `0 24px 60px -18px rgba(0,0,0,0.85), 0 0 60px -8px ${theme.glow}`;
                    e.currentTarget.style.borderColor = theme.glow;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = `0 20px 50px -20px rgba(0,0,0,0.8), 0 0 0 0 transparent`;
                    e.currentTarget.style.borderColor = "rgba(242, 232, 213, 0.12)";
                  }}
                >
                  {/* readability scrim */}
                  <div
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(to top, rgba(5,4,3,0.88) 0%, rgba(5,4,3,0.35) 45%, transparent 75%)",
                    }}
                  />
                  <div className="relative flex flex-1 flex-col justify-end p-6">
                    <p
                      className="text-[10px] uppercase"
                      style={{ letterSpacing: "0.3em", color: theme.accent, opacity: 0.85 }}
                    >
                      {theme.kicker}
                    </p>
                    <h3
                      className="mt-2 text-3xl leading-tight"
                      style={{ color: "var(--vb-paper)", textShadow: "0 2px 16px rgba(0,0,0,0.8)" }}
                    >
                      {story.title}
                    </h3>
                    <p
                      className="mt-1 text-xs uppercase"
                      style={{ letterSpacing: "0.18em", color: "rgba(242,232,213,0.55)" }}
                    >
                      {story.outline.genre}
                    </p>
                    <p
                      className="mt-3 text-sm leading-relaxed"
                      style={{
                        color: "rgba(242,232,213,0.78)",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {story.outline.logline}
                    </p>
                    <p
                      className="vb-card-cta mt-5 text-xs uppercase"
                      style={{ letterSpacing: "0.28em", color: "var(--vb-gold)" }}
                    >
                      {busy ? "Setting the stage…" : (
                        <>
                          Begin <span className="vb-arrow">→</span>
                        </>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ================= custom premise ================= */}
        <section className="vb-reveal mt-20" style={{ animationDelay: "520ms" }}>
          <div className="mb-6 flex items-center gap-5" aria-hidden>
            <span className="h-px flex-1" style={{ background: "linear-gradient(to left, rgba(217,179,108,0.35), transparent)" }} />
            <span className="vn-kicker" style={{ color: "var(--vb-gold)" }}>
              Or tell your own
            </span>
            <span className="h-px flex-1" style={{ background: "linear-gradient(to right, rgba(217,179,108,0.35), transparent)" }} />
          </div>

          <div className="mx-auto flex w-full max-w-2xl flex-col items-center">
            <textarea
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              rows={3}
              disabled={starting !== null}
              placeholder="A lighthouse keeper finds a door at the bottom of the sea…"
              className="vb-textarea w-full resize-none rounded-lg border px-5 py-4 text-base leading-relaxed"
              style={{
                fontFamily: "var(--vb-display)",
                background: "rgba(16, 13, 8, 0.7)",
                borderColor: "rgba(242, 232, 213, 0.15)",
                color: "var(--vb-paper)",
              }}
            />
            {error && (
              <p
                role="alert"
                className="mt-3 w-full rounded-md border px-4 py-2.5 text-sm"
                style={{
                  borderColor: "rgba(229, 72, 77, 0.4)",
                  background: "rgba(229, 72, 77, 0.08)",
                  color: "#f0b0b2",
                }}
              >
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={starting !== null || !premise.trim()}
              onClick={() => start({ premise: premise.trim() })}
              className="mt-5 rounded-full border px-10 py-3 text-xs uppercase transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                letterSpacing: "0.3em",
                fontFamily: "var(--vb-display)",
                borderColor: "rgba(217, 179, 108, 0.5)",
                color: "var(--vb-gold-bright)",
                background:
                  starting === "custom"
                    ? "rgba(217, 179, 108, 0.12)"
                    : "rgba(217, 179, 108, 0.06)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(217, 179, 108, 0.14)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(217, 179, 108, 0.06)";
              }}
            >
              {starting === "custom" ? "Weaving your tale — this takes a minute…" : "Begin your story"}
            </button>
          </div>
        </section>

        <footer
          className="vb-reveal mt-24 text-center text-[11px] uppercase"
          style={{ animationDelay: "640ms", letterSpacing: "0.25em", color: "rgba(242,232,213,0.3)" }}
        >
          Speak, and the story answers
        </footer>
      </main>
    </div>
  );
}
