"use client";

import { useEffect, useRef, useState } from "react";
import "../overlays.css";

interface TimedTapProps {
  difficulty: number; // 1-5
  prompt: string;
  onDone(result: { result: "win" | "lose"; accuracy: number; timeMs: number }): void;
}

const PERIOD_MS = 1200; // one full sweep, one direction
const ROUND_TIMEOUT_MS = PERIOD_MS * 4; // no tap after 4 sweeps = miss
const FEEDBACK_MS = 650;

type RoundOutcome = { hit: boolean; accuracy: number };

const randomZone = (half: number) => half + 0.15 + Math.random() * (0.7 - half * 2);

export default function TimedTap({ difficulty, prompt, onDone }: TimedTapProps) {
  const d = Math.min(5, Math.max(1, difficulty));
  const zoneWidth = Math.max(0.1, 0.3 - d * 0.04); // fraction of bar: 0.26 .. 0.10
  const half = zoneWidth / 2;

  const [round, setRound] = useState(0);
  const [zoneCenter, setZoneCenter] = useState(() => randomZone(half));
  const [feedback, setFeedback] = useState<"hit" | "miss" | null>(null);
  const [phase, setPhase] = useState<"play" | "win" | "lose">("play");
  const [results, setResults] = useState<RoundOutcome[]>([]);

  const posRef = useRef(0); // current marker position 0..1
  const roundStartRef = useRef(0);
  const mountRef = useRef(0);
  const lockedRef = useRef(false); // true during feedback / after finish
  const doneRef = useRef(false);
  const rafRef = useRef(0);

  const trackRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    mountRef.current = performance.now();
  }, []);

  function finish(result: "win" | "lose", all: RoundOutcome[]) {
    doneRef.current = true;
    setPhase(result);
    const accuracy = all.length ? all.reduce((s, r) => s + r.accuracy, 0) / all.length : 0;
    const timeMs = performance.now() - mountRef.current;
    setTimeout(() => onDoneRef.current({ result, accuracy, timeMs }), 600);
  }

  function settleRound(hit: boolean, accuracy: number) {
    if (lockedRef.current || doneRef.current) return;
    lockedRef.current = true;
    setFeedback(hit ? "hit" : "miss");

    const next = [...results, { hit, accuracy }];
    setResults(next);
    const hits = next.filter((r) => r.hit).length;
    const misses = next.length - hits;

    setTimeout(() => {
      if (doneRef.current) return;
      if (hits >= 2 || misses >= 2) {
        finish(hits >= 2 ? "win" : "lose", next);
      } else {
        setFeedback(null);
        setZoneCenter(randomZone(half));
        lockedRef.current = false;
        setRound((r) => r + 1);
      }
    }, FEEDBACK_MS);
  }

  // marker sweep loop (ping-pong triangle wave)
  useEffect(() => {
    if (phase !== "play") return;
    roundStartRef.current = performance.now();

    const loop = (now: number) => {
      const t = (now - roundStartRef.current) / PERIOD_MS;
      const cycle = t % 2;
      const pos = cycle <= 1 ? cycle : 2 - cycle;
      posRef.current = pos;

      const track = trackRef.current;
      const marker = markerRef.current;
      if (track && marker) {
        marker.style.transform = `translate3d(${pos * track.offsetWidth}px, -50%, 0)`;
      }

      if (!lockedRef.current && now - roundStartRef.current >= ROUND_TIMEOUT_MS) {
        settleRound(false, 0);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, phase]);

  const settleRound = (hit: boolean, accuracy: number) => {
    if (lockedRef.current || doneRef.current) return;
    lockedRef.current = true;
    setFeedback(hit ? "hit" : "miss");

    const next = [...results, { hit, accuracy }];
    setResults(next);
    const hits = next.filter((r) => r.hit).length;
    const misses = next.length - hits;

    setTimeout(() => {
      if (doneRef.current) return;
      if (hits >= 2 || misses >= 2) {
        finish(hits >= 2 ? "win" : "lose", next);
      } else {
        setFeedback(null);
        setZoneCenter(randomZone(half));
        lockedRef.current = false;
        setRound((r) => r + 1);
      }
    }, FEEDBACK_MS);
  };

  const finish = (result: "win" | "lose", all: RoundOutcome[]) => {
    doneRef.current = true;
    setPhase(result);
    const accuracy = all.length ? all.reduce((s, r) => s + r.accuracy, 0) / all.length : 0;
    const timeMs = performance.now() - mountRef.current;
    setTimeout(() => onDoneRef.current({ result, accuracy, timeMs }), 600);
  };

  const handleTap = () => {
    if (lockedRef.current || doneRef.current) return;
    const off = Math.abs(posRef.current - zoneCenter);
    const hit = off <= half;
    settleRound(hit, hit ? 1 - off / half : 0);
  };

  const over = phase !== "play";
  const win = phase === "win";
  const hits = results.filter((r) => r.hit).length;
  const misses = results.length - hits;

  return (
    <div
      className="vn vn-overlay"
      role="dialog"
      aria-label={prompt}
      onPointerDown={handleTap}
      style={{ cursor: "pointer" }}
    >
      <div
        className="relative flex h-full w-full flex-col items-center justify-center gap-10 px-6"
        style={{
          animation: feedback === "miss" ? "vn-shake-x 340ms ease-out" : undefined,
          willChange: "transform",
        }}
      >
        <p className="vn-kicker text-center">{prompt}</p>

        {/* round pips */}
        <div className="flex gap-3">
          {[0, 1, 2].map((i) => {
            const r = results[i];
            return (
              <span
                key={i}
                className="h-2.5 w-2.5 rounded-full border"
                style={{
                  borderColor: "rgba(242,232,213,0.35)",
                  background: r ? (r.hit ? "var(--vn-jade)" : "var(--vn-blood)") : "transparent",
                  opacity: i === round && !r ? 1 : 0.75,
                }}
              />
            );
          })}
        </div>

        {/* sweep track */}
        <div className="w-full max-w-md">
          <div
            ref={trackRef}
            className="relative h-14 overflow-visible rounded-md border border-[rgba(242,232,213,0.2)] bg-[rgba(242,232,213,0.05)]"
            style={{
              animation:
                feedback === "hit" ? "vn-hit-pulse 420ms ease-out" : undefined,
            }}
          >
            {/* target zone */}
            <div
              className="absolute top-0 h-full rounded-sm"
              style={{
                left: `${(zoneCenter - half) * 100}%`,
                width: `${zoneWidth * 100}%`,
                background:
                  feedback === "hit"
                    ? "rgba(126,226,168,0.4)"
                    : feedback === "miss"
                      ? "rgba(229,72,77,0.35)"
                      : "rgba(217,179,108,0.28)",
                boxShadow: "inset 0 0 0 1px rgba(240,208,144,0.6)",
                transition: "background 150ms",
              }}
            />
            {/* center notch of the zone */}
            <div
              className="absolute top-0 h-full w-px"
              style={{ left: `${zoneCenter * 100}%`, background: "rgba(240,208,144,0.9)" }}
            />
            {/* sweeping marker */}
            <div
              ref={markerRef}
              className="absolute top-1/2 -ml-[2px] h-[130%] w-1 rounded-full"
              style={{
                transform: "translate3d(0, -50%, 0)",
                willChange: "transform",
                background: "var(--vn-paper)",
                boxShadow: "0 0 12px rgba(242,232,213,0.8)",
              }}
            />
          </div>
          <p className="mt-3 text-center text-[10px] uppercase tracking-[0.3em] opacity-50">
            tap when the needle crosses the gold — {2 - hits} more to land it
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
              {win ? "LANDED" : "MISSED"}
            </span>
          </div>
        )}

        <div className="vn-grain" />
        <div className="vn-vignette" />
      </div>
    </div>
  );
}
