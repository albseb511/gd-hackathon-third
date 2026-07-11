"use client";

// CharacterCreator — the "step into the story" screen. A selfie (optional),
// a name, one line of self-description; the server paints a portrait and
// rolls a sheet in parallel while this component stages the wait, then the
// photo crossfades into the portrait for the reveal.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MusicMixer, bankForGenre } from "@/components/audio/mixer";
import type { CharacterSheet, Stat } from "@/lib/storyEngine/types";
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

// Client-side compression: longest edge <= 1024px, JPEG. Keeps selfies from
// phone cameras (often 10MB+) off the wire.
async function compressPhoto(
  file: File,
): Promise<{ blob: Blob; dataUrl: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image."));
      el.src = url;
    });

    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not process that image."))),
        "image/jpeg",
        0.85,
      ),
    );
    return { blob, dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface CreateResult {
  characterId: string | null;
  sheet: CharacterSheet;
  portraitAssetId: string | null;
  portraitDataUrl: string | null;
}

const STAGES = [
  { label: "reading your face…", at: 0 },
  { label: "painting your portrait…", at: 3800 },
  { label: "rolling your stats…", at: 10500 },
];

const STAT_ORDER: Stat[] = ["might", "wit", "charm"];
const STAT_GLYPH: Record<Stat, string> = { might: "⚔", wit: "◈", charm: "❦" };

type Phase = "form" | "working" | "reveal";

export default function CharacterCreator({
  playthroughId,
}: {
  playthroughId: string | null;
}) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [whoAmI, setWhoAmI] = useState("");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [portraitIn, setPortraitIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mixerRef = useRef<MusicMixer | null>(null);
  const bankRef = useRef("fantasy");

  useEffect(() => {
    const timers = stageTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // BGM starts here, on the first user gesture (autoplay rules) — the story's
  // score plays quietly from the forge onward
  useEffect(() => {
    if (playthroughId) {
      fetch(`/api/playthroughs/${playthroughId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { outline?: { genre?: string } } | null) => {
          if (d?.outline?.genre) bankRef.current = bankForGenre(d.outline.genre);
        })
        .catch(() => {});
    }
    const startMusic = () => {
      if (mixerRef.current) return;
      mixerRef.current = new MusicMixer(bankRef.current);
      mixerRef.current.start();
      void mixerRef.current.play("intro");
    };
    window.addEventListener("pointerdown", startMusic, { once: true });
    return () => {
      window.removeEventListener("pointerdown", startMusic);
      mixerRef.current?.dispose();
      mixerRef.current = null;
    };
  }, [playthroughId]);

  async function onPickPhoto(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const { blob, dataUrl } = await compressPhoto(file);
      setPhotoBlob(blob);
      setPhotoPreview(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    }
  }

  async function create() {
    if (!name.trim()) return;
    setError(null);
    setPhase("working");
    setStage(0);
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = STAGES.slice(1).map((s, i) =>
      setTimeout(() => setStage(i + 1), s.at),
    );

    try {
      const form = new FormData();
      form.set("name", name.trim());
      if (whoAmI.trim()) form.set("whoAmI", whoAmI.trim());
      if (playthroughId) form.set("playthroughId", playthroughId);
      form.set("deviceKey", ensureDeviceKey());
      if (photoBlob) form.set("photo", photoBlob, "photo.jpg");

      const res = await fetch("/api/character", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The forge went cold. Try again.");

      stageTimers.current.forEach(clearTimeout);
      setResult(data as CreateResult);
      setPortraitIn(false);
      setPhase("reveal");
      // let the base image mount before the portrait crossfades in
      setTimeout(() => setPortraitIn(true), 350);

      // while the player admires their portrait, pre-paint the opening
      // scenes (first beat + its branches) so the story starts instantly
      if (playthroughId) {
        void fetch("/api/prewarm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            playthroughId,
            aspect: window.innerHeight > window.innerWidth ? "9:16" : "16:9",
          }),
        }).catch(() => {});
      }
      // ask for the mic here too — /play then starts without a permission stop
      void navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => stream.getTracks().forEach((t) => t.stop()))
        .catch(() => {});
    } catch (err) {
      stageTimers.current.forEach(clearTimeout);
      setError(err instanceof Error ? err.message : "The forge went cold. Try again.");
      setPhase("form");
    }
  }

  function onContinue() {
    router.push(playthroughId ? `/play/${playthroughId}` : "/");
  }

  const frameArt = photoPreview ?? result?.portraitDataUrl ?? null;

  return (
    <div
      className="vn relative min-h-dvh w-full overflow-x-hidden bg-zinc-950"
      style={{ fontFamily: "var(--vn-font-display)" }}
    >
      <style>{`
        .cc-input { width: 100%; border-radius: 8px; border: 1px solid rgba(242,232,213,0.15); background: rgba(16,13,8,0.7); color: var(--vn-paper); padding: 14px 18px; font-family: var(--vn-font-display); font-size: 16px; }
        .cc-input::placeholder { color: rgba(242,232,213,0.28); font-style: italic; }
        .cc-input:focus { outline: none; border-color: rgba(217,179,108,0.6); box-shadow: 0 0 0 1px rgba(217,179,108,0.25), 0 0 40px rgba(217,179,108,0.06); }
        .cc-cta { letter-spacing: 0.3em; font-family: var(--vn-font-display); border: 1px solid rgba(217,179,108,0.5); color: var(--vn-gold-bright); background: rgba(217,179,108,0.06); border-radius: 999px; padding: 14px 44px; font-size: 12px; text-transform: uppercase; cursor: pointer; transition: background 300ms ease, transform 200ms ease; }
        .cc-cta:hover:not(:disabled) { background: rgba(217,179,108,0.14); transform: translateY(-1px); }
        .cc-cta:disabled { opacity: 0.4; cursor: not-allowed; }
        .cc-frame { position: relative; overflow: hidden; border-radius: 12px; border: 1px solid rgba(217,179,108,0.35); background: radial-gradient(ellipse at 50% 30%, #241c10 0%, #0d0a06 75%); box-shadow: 0 30px 80px -30px rgba(0,0,0,0.9), inset 0 0 60px rgba(0,0,0,0.5); }
        .cc-frame::after { content: ""; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 40px rgba(0,0,0,0.55); border-radius: 12px; }
        .cc-picker { cursor: pointer; transition: border-color 250ms ease, background 250ms ease; }
        .cc-picker:hover { border-color: rgba(217,179,108,0.6); background: rgba(217,179,108,0.05); }
        @keyframes cc-portrait-in { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: scale(1); } }
        @keyframes cc-pip-in { from { opacity: 0; transform: scaleX(0.3); } to { opacity: 1; transform: scaleX(1); } }
        .cc-pip { width: 26px; height: 9px; border-radius: 2px; background: rgba(242,232,213,0.1); border: 1px solid rgba(242,232,213,0.14); }
        .cc-pip.on { background: linear-gradient(180deg, var(--vn-gold-bright), var(--vn-gold)); border-color: rgba(240,208,144,0.7); box-shadow: 0 0 8px rgba(217,179,108,0.35); animation: cc-pip-in 320ms ease-out both; }
        @keyframes cc-stage-swap { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
        @media (prefers-reduced-motion: reduce) { .cc-pip.on { animation: none; } }
      `}</style>

      {/* atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% -8%, rgba(217,179,108,0.10), transparent 60%), radial-gradient(ellipse 70% 50% at 50% 110%, rgba(120,70,20,0.10), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 90% at 50% 42%, transparent 50%, rgba(4,3,2,0.6) 100%)",
        }}
      />
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="vn-grain" />
      </div>

      <main className="relative mx-auto flex w-full max-w-lg flex-col items-center px-6 pb-20 pt-16 sm:pt-20">
        <header className="text-center" style={{ animation: "vn-rise-in 600ms ease-out both" }}>
          <p className="vn-kicker">Before the tale begins</p>
          <h1
            className="mt-4 text-4xl sm:text-5xl"
            style={{
              letterSpacing: "0.08em",
              fontWeight: 400,
              background:
                "linear-gradient(180deg, #f7edd8 20%, var(--vn-gold-bright) 55%, #9a7638 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Step Into the Story
          </h1>
        </header>

        {/* ======================= FORM ======================= */}
        {phase === "form" && (
          <section
            className="mt-10 flex w-full flex-col items-center gap-5"
            style={{ animation: "vn-rise-in 600ms ease-out 120ms both" }}
          >
            {/* photo picker */}
            <label
              className="cc-picker relative flex h-44 w-44 flex-col items-center justify-center gap-2 overflow-hidden rounded-full border border-dashed text-center"
              style={{ borderColor: "rgba(217,179,108,0.35)" }}
            >
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoPreview}
                  alt="Your photo"
                  className="absolute inset-0 h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <>
                  <span aria-hidden style={{ fontSize: 30, color: "var(--vn-gold)" }}>
                    ◉
                  </span>
                  <span className="px-6 text-xs leading-snug" style={{ color: "rgba(242,232,213,0.6)" }}>
                    Lend the story your face
                    <br />
                    <em style={{ color: "rgba(242,232,213,0.4)" }}>(optional)</em>
                  </span>
                </>
              )}
              {photoPreview && (
                <span
                  className="absolute inset-x-0 bottom-0 py-1.5 text-[10px] uppercase"
                  style={{
                    letterSpacing: "0.25em",
                    background: "rgba(8,6,4,0.75)",
                    color: "var(--vn-gold-bright)",
                  }}
                >
                  change
                </span>
              )}
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="sr-only"
                onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
              />
            </label>

            <input
              className="cc-input"
              type="text"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name in this world…"
              aria-label="Character name"
            />
            <input
              className="cc-input"
              type="text"
              value={whoAmI}
              maxLength={140}
              onChange={(e) => setWhoAmI(e.target.value)}
              placeholder="Who are you? One line — “retired smuggler with a soft heart”…"
              aria-label="Who are you?"
            />

            {error && (
              <p
                role="alert"
                className="w-full rounded-md border px-4 py-2.5 text-sm"
                style={{
                  borderColor: "rgba(229,72,77,0.4)",
                  background: "rgba(229,72,77,0.08)",
                  color: "#f0b0b2",
                }}
              >
                {error}
              </p>
            )}

            <button type="button" className="cc-cta mt-2" disabled={!name.trim()} onClick={create}>
              Forge my character
            </button>
          </section>
        )}

        {/* ======================= WORKING ======================= */}
        {phase === "working" && (
          <section
            className="mt-12 flex w-full flex-col items-center gap-8"
            style={{ animation: "vn-fade-in 300ms ease-out both" }}
          >
            <div className="cc-frame h-72 w-56 sm:h-80 sm:w-64">
              {photoPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoPreview}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{ filter: "grayscale(0.5) brightness(0.55)" }}
                  draggable={false}
                />
              )}
              <div
                className="absolute inset-0"
                style={{ background: "rgba(11,10,8,0.25)", animation: "vn-breathe 1.8s ease-in-out infinite" }}
              />
              {/* shimmer bar */}
              <div className="absolute left-1/2 top-4 h-[3px] w-32 -translate-x-1/2 overflow-hidden rounded-full bg-[rgba(242,232,213,0.12)]">
                <div
                  className="h-full w-1/3 rounded-full"
                  style={{
                    background: "linear-gradient(90deg, transparent, var(--vn-gold-bright), transparent)",
                    animation: "vn-shimmer 1.1s ease-in-out infinite",
                  }}
                />
              </div>
            </div>

            <div className="flex flex-col items-center gap-3">
              <p
                key={stage}
                className="text-lg italic"
                style={{ color: "var(--vn-paper)", animation: "cc-stage-swap 420ms ease-out both" }}
              >
                {STAGES[stage].label}
              </p>
              <div className="flex gap-2" aria-hidden>
                {STAGES.map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 w-8 rounded-full"
                    style={{
                      background: i <= stage ? "var(--vn-gold)" : "rgba(242,232,213,0.12)",
                      transition: "background 400ms ease",
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ======================= REVEAL ======================= */}
        {phase === "reveal" && result && (
          <section
            className="mt-10 flex w-full flex-col items-center gap-7"
            style={{ animation: "vn-rise-in 500ms ease-out both" }}
          >
            <div className="cc-frame h-80 w-60 sm:h-96 sm:w-72">
              {/* base layer: the source photo (or dark velvet if none) */}
              {frameArt && !result.portraitDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={frameArt} alt="" className="h-full w-full object-cover" draggable={false} />
              )}
              {photoPreview && result.portraitDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreview} alt="" className="h-full w-full object-cover" draggable={false} />
              )}
              {/* portrait crossfades in over the photo */}
              {result.portraitDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.portraitDataUrl}
                  alt={`Portrait of ${result.sheet.name}`}
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{
                    opacity: portraitIn ? 1 : 0,
                    transition: "opacity 1400ms ease",
                    animation: portraitIn ? "cc-portrait-in 1400ms ease both" : undefined,
                  }}
                  draggable={false}
                />
              )}
              {!frameArt && (
                <div className="flex h-full w-full items-center justify-center">
                  <span style={{ fontSize: 44, color: "rgba(217,179,108,0.5)" }}>✦</span>
                </div>
              )}
              <div
                className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-12 text-center"
                style={{ background: "linear-gradient(to top, rgba(6,5,4,0.85), transparent)" }}
              >
                <p className="text-2xl" style={{ color: "var(--vn-paper)", textShadow: "0 1px 8px rgba(0,0,0,0.9)" }}>
                  {result.sheet.name}
                </p>
              </div>
            </div>

            {/* stats */}
            <div className="flex w-full max-w-xs flex-col gap-4">
              {STAT_ORDER.map((stat, row) => (
                <div key={stat} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-sm uppercase" style={{ letterSpacing: "0.22em" }}>
                    <span aria-hidden style={{ color: "var(--vn-gold)" }}>{STAT_GLYPH[stat]}</span>
                    {stat}
                  </span>
                  <span className="flex gap-1.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className={`cc-pip${i < result.sheet.stats[stat] ? " on" : ""}`}
                        style={{ animationDelay: `${600 + row * 250 + i * 90}ms` }}
                      />
                    ))}
                  </span>
                </div>
              ))}
            </div>

            <p
              className="max-w-sm text-center text-base italic leading-relaxed"
              style={{ color: "rgba(242,232,213,0.7)", animation: "vn-rise-in 600ms ease-out 1400ms both" }}
            >
              “{result.sheet.personalityHints}”
            </p>

            <button
              type="button"
              className="cc-cta"
              onClick={onContinue}
              style={{ animation: "vn-rise-in 600ms ease-out 1700ms both" }}
            >
              {playthroughId ? "Enter the story" : "Continue"}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
