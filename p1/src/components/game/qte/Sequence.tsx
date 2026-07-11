"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "../overlays.css";

interface SequenceProps {
  difficulty: number; // 1-5
  prompt: string;
  onDone(result: { result: "win" | "lose"; accuracy: number; timeMs: number }): void;
}

type Dir = "up" | "down" | "left" | "right";

const GLYPH: Record<Dir, string> = { up: "▲", down: "▼", left: "◀", right: "▶" };
const DIRS: Dir[] = ["up", "down", "left", "right"];

const FLASH_ON_MS = 520;
const FLASH_GAP_MS = 160;
const SWIPE_MIN_PX = 24;

export default function Sequence({ difficulty, prompt, onDone }: SequenceProps) {
  const d = Math.min(5, Math.max(1, difficulty));
  const length = Math.min(6, 3 + d); // 4..6
  const inputLimitMs = Math.max(3.5, 6 - d * 0.5) * 1000;

  const [seq] = useState<Dir[]>(() =>
    Array.from({ length }, () => DIRS[Math.floor(Math.random() * DIRS.length)]),
  );

  const [phase, setPhase] = useState<"watch" | "input" | "win" | "lose">("watch");
  const [flashIdx, setFlashIdx] = useState(-1); // which glyph is showing during watch
  const [inputIdx, setInputIdx] = useState(0); // how many correct inputs so far
  const [lastPress, setLastPress] = useState<Dir | null>(null);

  const doneRef = useRef(false);
  const mountRef = useRef(0);
  const inputStartRef = useRef(0);
  const rafRef = useRef(0);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const timerBarRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const inputIdxRef = useRef(0); // mirrors inputIdx for the rAF timeout path

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const finish = useCallback((result: "win" | "lose", correct: number) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase(result);
    const timeMs = performance.now() - mountRef.current;
    const accuracy = result === "win" ? 1 : correct / seq.length;
    setTimeout(() => onDoneRef.current({ result, accuracy, timeMs }), 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- watch phase: flash glyphs one by one ---
  useEffect(() => {
    mountRef.current = performance.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    seq.forEach((_, i) => {
      timers.push(setTimeout(() => setFlashIdx(i), i * (FLASH_ON_MS + FLASH_GAP_MS)));
      timers.push(
        setTimeout(() => setFlashIdx(-1), i * (FLASH_ON_MS + FLASH_GAP_MS) + FLASH_ON_MS),
      );
    });
    timers.push(
      setTimeout(
        () => {
          inputStartRef.current = performance.now();
          setPhase("input");
        },
        seq.length * (FLASH_ON_MS + FLASH_GAP_MS) + 250,
      ),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- input phase: countdown ---
  useEffect(() => {
    if (phase !== "input") return;
    const loop = (now: number) => {
      const left = 1 - (now - inputStartRef.current) / inputLimitMs;
      if (timerBarRef.current) {
        timerBarRef.current.style.transform = `scaleX(${Math.max(0, left)})`;
      }
      if (left <= 0) {
        finish("lose", inputIdxRef.current);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, inputLimitMs, finish]);

  const handleDir = (dir: Dir) => {
    if (phase !== "input" || doneRef.current) return;
    setLastPress(dir);
    if (dir === seq[inputIdx]) {
      const next = inputIdx + 1;
      inputIdxRef.current = next;
      setInputIdx(next);
      if (next >= seq.length) finish("win", next);
    } else {
      finish("lose", inputIdx);
    }
  };

  // --- swipe gestures on the stage ---
  const onPointerDown = (e: React.PointerEvent) => {
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipeStart.current;
    swipeStart.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    const dir: Dir =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    handleDir(dir);
  };

  const over = phase === "win" || phase === "lose";
  const win = phase === "win";

  const padBtn = (dir: Dir, area: string) => (
    <button
      key={dir}
      type="button"
      onPointerDown={(e) => {
        e.stopPropagation();
        handleDir(dir);
      }}
      onPointerUp={(e) => e.stopPropagation()}
      disabled={phase !== "input"}
      className="flex h-16 w-16 items-center justify-center rounded-xl border text-2xl"
      style={{
        gridArea: area,
        borderColor:
          lastPress === dir ? "var(--vn-gold-bright)" : "rgba(242,232,213,0.25)",
        background: "rgba(242,232,213,0.06)",
        color: "var(--vn-paper)",
        touchAction: "none",
      }}
    >
      {GLYPH[dir]}
    </button>
  );

  return (
    <div
      className="vn vn-overlay"
      role="dialog"
      aria-label={prompt}
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{ touchAction: "none" }}
    >
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-7 px-6">
        <p className="vn-kicker text-center">{prompt}</p>

        {/* big glyph stage */}
        <div className="flex h-28 items-center justify-center">
          {phase === "watch" && flashIdx >= 0 && (
            <span
              key={flashIdx}
              className="text-7xl"
              style={{
                color: "var(--vn-gold-bright)",
                animation: "vn-glyph-in 480ms ease-out both",
                textShadow: "0 0 30px rgba(217,179,108,0.6)",
              }}
            >
              {GLYPH[seq[flashIdx]]}
            </span>
          )}
          {phase === "watch" && flashIdx < 0 && (
            <span className="text-sm uppercase tracking-[0.35em] opacity-40">watch</span>
          )}
          {phase === "input" && (
            <span className="text-sm uppercase tracking-[0.35em] opacity-70" style={{ color: "var(--vn-gold)" }}>
              repeat it
            </span>
          )}
        </div>

        {/* progress pips */}
        <div className="flex gap-2.5">
          {seq.map((g, i) => (
            <span
              key={i}
              className="flex h-8 w-8 items-center justify-center rounded-md border text-sm"
              style={{
                borderColor: i < inputIdx ? "var(--vn-jade)" : "rgba(242,232,213,0.2)",
                color: i < inputIdx ? "var(--vn-jade)" : "rgba(242,232,213,0.35)",
                background: i < inputIdx ? "rgba(126,226,168,0.1)" : "transparent",
              }}
            >
              {i < inputIdx || over ? GLYPH[g] : "·"}
            </span>
          ))}
        </div>

        {/* input timer */}
        <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-[rgba(242,232,213,0.1)]">
          <div
            ref={timerBarRef}
            className="h-full w-full"
            style={{
              transform: `scaleX(${phase === "input" ? 1 : 0})`,
              transformOrigin: "left",
              willChange: "transform",
              background: "var(--vn-gold)",
            }}
          />
        </div>

        {/* d-pad */}
        <div
          className="grid gap-2"
          style={{
            gridTemplateAreas: `". u ." "l . r" ". d ."`,
            opacity: phase === "input" ? 1 : 0.35,
            transition: "opacity 200ms",
          }}
        >
          {padBtn("up", "u")}
          {padBtn("left", "l")}
          {padBtn("right", "r")}
          {padBtn("down", "d")}
        </div>
        <p className="text-[10px] uppercase tracking-[0.3em] opacity-45">tap the pad or swipe anywhere</p>

        {/* win / lose flash */}
        {over && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              animation: "vn-flash-win 600ms ease-out both",
              background: win
                ? "radial-gradient(circle, rgba(126,226,168,0.22), rgba(8,7,5,0.75))"
                : "radial-gradient(circle, rgba(229,72,77,0.25), rgba(8,7,5,0.8))",
            }}
          >
            <span
              className="border-4 px-8 py-3 text-4xl tracking-[0.3em]"
              style={{
                animation: "vn-stamp-in 380ms cubic-bezier(0.2,1.4,0.4,1) both",
                color: win ? "var(--vn-jade)" : "var(--vn-blood)",
                borderColor: "currentcolor",
              }}
            >
              {win ? "PERFECT" : "BROKEN"}
            </span>
          </div>
        )}

        <div className="vn-grain" />
        <div className="vn-vignette" />
      </div>
    </div>
  );
}
