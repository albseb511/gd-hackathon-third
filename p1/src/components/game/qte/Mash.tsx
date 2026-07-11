"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "../overlays.css";

interface MashProps {
  difficulty: number; // 1-5
  prompt: string;
  onDone(result: { result: "win" | "lose"; accuracy: number; timeMs: number }): void;
}

const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

/** Restart a CSS animation class on an element (screen-shake / tap-pop). */
function retrigger(el: HTMLElement | null, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  // force reflow so the animation restarts
  void el.offsetWidth;
  el.classList.add(cls);
}

export default function Mash({ difficulty, prompt, onDone }: MashProps) {
  const d = Math.min(5, Math.max(1, difficulty));
  const tapsNeeded = 8 + d * 4; // 12..28
  const totalMs = Math.max(3.5, 6 - d * 0.5) * 1000; // 5500..3500
  const decayPerSec = 0.015 + d * 0.01; // fraction of bar lost per second

  const [phase, setPhase] = useState<"play" | "win" | "lose">("play");

  const progressRef = useRef(0); // 0..1
  const peakRef = useRef(0);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const rafRef = useRef(0);

  const shakeRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const finish = useCallback(
    (result: "win" | "lose") => {
      if (doneRef.current) return;
      doneRef.current = true;
      const timeMs = performance.now() - startRef.current;
      const remaining = Math.max(0, totalMs - timeMs);
      const accuracy =
        result === "win"
          ? Math.min(1, 0.5 + 0.5 * (remaining / totalMs))
          : Math.min(1, peakRef.current);
      setPhase(result);
      const t = setTimeout(() => onDoneRef.current({ result, accuracy, timeMs }), 600);
      return () => clearTimeout(t);
    },
    [totalMs],
  );

  useEffect(() => {
    startRef.current = performance.now();
    let last = startRef.current;

    const loop = (now: number) => {
      if (doneRef.current) return;
      const dt = (now - last) / 1000;
      last = now;
      const elapsed = now - startRef.current;

      progressRef.current = Math.max(0, progressRef.current - decayPerSec * dt);

      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${progressRef.current})`;
      }
      const left = Math.max(0, 1 - elapsed / totalMs);
      if (ringRef.current) {
        ringRef.current.style.strokeDashoffset = String(RING_C * (1 - left));
      }
      if (countRef.current) {
        countRef.current.textContent = ((left * totalMs) / 1000).toFixed(1);
      }

      if (elapsed >= totalMs) {
        finish(progressRef.current >= 1 ? "win" : "lose");
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [decayPerSec, totalMs, finish]);

  const handleTap = () => {
    if (doneRef.current) return;
    progressRef.current = Math.min(1.05, progressRef.current + 1 / tapsNeeded);
    peakRef.current = Math.max(peakRef.current, Math.min(1, progressRef.current));
    retrigger(shakeRef.current, "vn-mash-shake");
    retrigger(zoneRef.current, "vn-mash-pop");
    if (progressRef.current >= 1) finish("win");
  };

  const over = phase !== "play";
  const win = phase === "win";

  return (
    <div className="vn vn-overlay" role="dialog" aria-label={prompt}>
      <div
        ref={shakeRef}
        className="relative flex h-full w-full flex-col items-center justify-center gap-8 px-6"
        style={{ willChange: "transform" }}
      >
        <p className="vn-kicker text-center">{prompt}</p>

        {/* countdown ring wrapping the tap zone */}
        <div className="relative flex items-center justify-center">
          <svg width="260" height="260" viewBox="0 0 120 120" className="absolute -rotate-90">
            <circle cx="60" cy="60" r={RING_R} fill="none" stroke="rgba(242,232,213,0.12)" strokeWidth="2" />
            <circle
              ref={ringRef}
              cx="60"
              cy="60"
              r={RING_R}
              fill="none"
              stroke="var(--vn-gold)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset="0"
            />
          </svg>

          <button
            ref={zoneRef}
            type="button"
            onPointerDown={handleTap}
            disabled={over}
            className="relative flex h-52 w-52 items-center justify-center rounded-full border border-[rgba(217,179,108,0.45)] bg-[radial-gradient(circle_at_50%_38%,rgba(217,179,108,0.22),rgba(11,10,8,0.9)_72%)]"
            style={{
              animation: over ? "none" : "vn-pulse 0.9s ease-in-out infinite",
              willChange: "transform",
              touchAction: "manipulation",
            }}
          >
            <span
              className="text-4xl tracking-[0.18em]"
              style={{ fontFamily: "var(--vn-font-display)", color: "var(--vn-gold-bright)" }}
            >
              TAP
            </span>
            <span ref={countRef} className="absolute bottom-9 text-xs tabular-nums opacity-60" />
          </button>
        </div>

        {/* decaying progress bar */}
        <div className="w-full max-w-xs">
          <div className="h-2.5 overflow-hidden rounded-full border border-[rgba(242,232,213,0.15)] bg-[rgba(242,232,213,0.06)]">
            <div
              ref={barRef}
              className="h-full w-full rounded-full"
              style={{
                transform: "scaleX(0)",
                transformOrigin: "left",
                willChange: "transform",
                background: "linear-gradient(90deg, var(--vn-ember), var(--vn-gold-bright))",
              }}
            />
          </div>
          <p className="mt-2 text-center text-[10px] uppercase tracking-[0.3em] opacity-50">
            fill the bar before it drains
          </p>
        </div>

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
              {win ? "DONE" : "FAILED"}
            </span>
          </div>
        )}

        <div className="vn-grain" />
        <div className="vn-vignette" />
      </div>

      {/* local animation hooks (retriggered via class toggling) */}
      <style>{`
        .vn-mash-shake { animation: vn-shake 160ms ease-out; }
        .vn-mash-pop { animation: vn-tap-pop 130ms ease-out !important; }
      `}</style>
    </div>
  );
}
