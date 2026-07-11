"use client";

import { useEffect, useRef, useState } from "react";
import type { Stat } from "@/lib/storyEngine/types";
import "./overlays.css";

interface DiceRollProps {
  stat: Stat;
  statValue: number; // 1-5
  difficulty: number; // the DC
  advantage: boolean;
  label?: string;
  onDone(result: {
    result: "success" | "fail";
    roll: number;
    secondRoll?: number;
    total: number;
  }): void;
}

type Phase = "rolling" | "rolled" | "stat" | "total" | "verdict";

const ROLL_MS = 1300;
const T_ROLLED = ROLL_MS; // dice settle, kept die highlighted
const T_STAT = 1800; // +stat appears
const T_TOTAL = 2250; // total appears vs DC
const T_VERDICT = 2650; // stamp
const T_DONE = T_VERDICT + 800;

const d20 = () => 1 + Math.floor(Math.random() * 20);

const STAT_GLYPH: Record<Stat, string> = { might: "⚔", wit: "◈", charm: "❦" };

/** A stylized d20: faceted gem silhouette + face number. */
function Die({
  value,
  rolling,
  dropped,
  kept,
  showKeptTag,
}: {
  value: number;
  rolling: boolean;
  dropped: boolean;
  kept: boolean;
  showKeptTag: boolean;
}) {
  const [flicker, setFlicker] = useState(value);

  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setFlicker(d20()), 75);
    return () => clearInterval(id);
  }, [rolling]);

  return (
    <div
      className="relative flex flex-col items-center gap-2"
      style={{
        transition: "opacity 350ms, transform 350ms",
        opacity: dropped ? 0.28 : 1,
        transform: dropped ? "scale(0.82)" : "scale(1)",
      }}
    >
      {/* glow behind the kept die */}
      {kept && !rolling && (
        <div
          className="absolute left-1/2 top-1/2 -z-10 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(217,179,108,0.35), transparent 70%)",
            animation: "vn-die-glow 1.6s ease-in-out infinite",
          }}
        />
      )}
      <div style={{ perspective: "600px" }}>
        <div
          className="relative flex h-28 w-28 items-center justify-center"
          style={{
            animation: rolling
              ? `vn-dice-tumble ${ROLL_MS}ms cubic-bezier(0.25, 0.9, 0.35, 1) both`
              : "vn-dice-land 320ms ease-out both",
            willChange: "transform",
            transformStyle: "preserve-3d",
          }}
        >
          {/* icosahedron-ish faceted silhouette */}
          <div
            className="absolute inset-0"
            style={{
              clipPath: "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)",
              background:
                "conic-gradient(from 210deg at 50% 42%, #2a2318, #4d3d22, #1c160d, #3b2f1b, #241d11, #2a2318)",
              boxShadow: "inset 0 0 0 1px rgba(240,208,144,0.4)",
            }}
          />
          {/* facet edge lines */}
          <div
            className="absolute inset-[6%]"
            style={{
              clipPath: "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)",
              background:
                "linear-gradient(120deg, transparent 48%, rgba(240,208,144,0.25) 50%, transparent 52%), linear-gradient(60deg, transparent 48%, rgba(240,208,144,0.2) 50%, transparent 52%), linear-gradient(0deg, transparent 48%, rgba(240,208,144,0.15) 50%, transparent 52%)",
            }}
          />
          <span
            className="relative text-5xl tabular-nums"
            style={{
              color: "var(--vn-gold-bright)",
              textShadow: "0 2px 12px rgba(0,0,0,0.9)",
            }}
          >
            {rolling ? flicker : value}
          </span>
        </div>
      </div>
      <span
        className="text-[9px] uppercase tracking-[0.35em]"
        style={{
          color: "var(--vn-gold)",
          opacity: showKeptTag ? 1 : 0,
          transition: "opacity 250ms",
        }}
      >
        kept
      </span>
    </div>
  );
}

export default function DiceRoll({
  stat,
  statValue,
  difficulty,
  advantage,
  label,
  onDone,
}: DiceRollProps) {
  const [phase, setPhase] = useState<Phase>("rolling");

  // rolls decided once, up front
  const [rolls] = useState(() => {
    const r1 = d20();
    const r2 = advantage ? d20() : undefined;
    return { r1, r2 };
  });

  const kept = rolls.r2 !== undefined ? Math.max(rolls.r1, rolls.r2) : rolls.r1;
  const total = kept + statValue;
  const success = total >= difficulty;

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase("rolled"), T_ROLLED),
      setTimeout(() => setPhase("stat"), T_STAT),
      setTimeout(() => setPhase("total"), T_TOTAL),
      setTimeout(() => setPhase("verdict"), T_VERDICT),
      setTimeout(
        () =>
          onDoneRef.current({
            result: success ? "success" : "fail",
            roll: rolls.r1,
            secondRoll: rolls.r2,
            total,
          }),
        T_DONE,
      ),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rolling = phase === "rolling";
  const showStat = phase === "stat" || phase === "total" || phase === "verdict";
  const showTotal = phase === "total" || phase === "verdict";
  const showVerdict = phase === "verdict";

  return (
    <div className="vn vn-overlay" role="dialog" aria-label={label ?? `${stat} check`}>
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-8 px-6">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="vn-kicker">{label ?? "fate decides"}</p>
          <p className="text-sm opacity-70">
            {STAT_GLYPH[stat]} {stat} check · DC {difficulty}
            {advantage && (
              <span className="ml-2" style={{ color: "var(--vn-gold)" }}>
                advantage
              </span>
            )}
          </p>
        </div>

        {/* dice */}
        <div className="flex items-center gap-8">
          <Die
            value={rolls.r1}
            rolling={rolling}
            dropped={!rolling && rolls.r2 !== undefined && rolls.r1 < rolls.r2}
            kept={rolls.r2 === undefined || rolls.r1 >= rolls.r2}
            showKeptTag={!rolling && rolls.r2 !== undefined && rolls.r1 >= rolls.r2}
          />
          {rolls.r2 !== undefined && (
            <Die
              value={rolls.r2}
              rolling={rolling}
              dropped={!rolling && rolls.r2 < rolls.r1}
              kept={rolls.r2 >= rolls.r1}
              showKeptTag={!rolling && rolls.r2 >= rolls.r1}
            />
          )}
        </div>

        {/* the math, beat by beat */}
        <div className="flex h-12 items-baseline gap-3 text-2xl tabular-nums">
          <span
            style={{
              opacity: rolling ? 0 : 1,
              transition: "opacity 250ms",
              color: "var(--vn-paper)",
            }}
          >
            {kept}
          </span>
          <span
            style={{
              opacity: showStat ? 1 : 0,
              transform: showStat ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 250ms, transform 250ms",
              color: "var(--vn-gold)",
            }}
          >
            + {statValue} <span className="text-sm opacity-70">{stat}</span>
          </span>
          <span
            style={{
              opacity: showTotal ? 1 : 0,
              transform: showTotal ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 250ms, transform 250ms",
            }}
          >
            = <span className="text-3xl" style={{ color: "var(--vn-gold-bright)" }}>{total}</span>
            <span className="ml-2 text-sm opacity-60">vs DC {difficulty}</span>
          </span>
        </div>

        {/* verdict stamp */}
        <div className="flex h-20 items-center justify-center">
          {showVerdict && (
            <span
              className="border-4 px-8 py-3 text-4xl tracking-[0.3em]"
              style={{
                animation: "vn-stamp-in 380ms cubic-bezier(0.2,1.4,0.4,1) both",
                color: success ? "var(--vn-jade)" : "var(--vn-blood)",
                borderColor: "currentcolor",
              }}
            >
              {success ? "SUCCESS" : "FAILURE"}
            </span>
          )}
        </div>

        <div className="vn-grain" />
        <div className="vn-vignette" />
      </div>
    </div>
  );
}
