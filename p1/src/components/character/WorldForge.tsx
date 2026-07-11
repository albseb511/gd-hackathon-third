"use client";

// WorldForge — the player watches their story's visual world being smithed:
// 50+ assets (scenes, locations, props, cast, poses, UI cards) streaming into
// a gold-lit gallery as one pipeline paints them. Live mode polls the forge;
// readonly mode is the same gallery reborn as an in-game codex.

import { useEffect, useMemo, useRef, useState } from "react";
import "@/components/game/overlays.css";

interface ForgeItem {
  kind: string;
  key: string;
  label: string;
  assetId: string | null;
  ms: number;
  ok: boolean;
}

interface ForgeStatus {
  running: boolean;
  total: number;
  done: number;
  startedAt: number;
  wallMs?: number;
  items: ForgeItem[];
}

export interface WorldForgeProps {
  playthroughId: string;
  readonly?: boolean;
  onClose?: () => void;
  // fires on every poll so the parent can gate flow on forge progress;
  // `settled` is true once the forge completed, failed, or went quiet
  onProgress?: (p: { done: number; total: number; settled: boolean }) => void;
}

// ---- category bucketing --------------------------------------------------------
// The status item carries the asset row's `kind` plus its manifest `key`;
// poses share kind 'portrait' with cast but are keyed 'pose_*'. Location
// establishing shots share kind 'scene' with beat art — beats are keyed with
// the outline's act-slug convention ('a1_docks'), locations by place slug.

const GROUPS = ["Scenes", "Locations", "Props", "Cast", "Poses", "Cards"] as const;
type Group = (typeof GROUPS)[number];

const GROUP_GLYPH: Record<Group, string> = {
  Scenes: "❖",
  Locations: "🗺",
  Props: "⚱",
  Cast: "❦",
  Poses: "☙",
  Cards: "🂠",
};

const BEAT_KEY_RE = /^a\d+_/; // outline beat ids: 'a1_docks', 'a3_showdown'…

function groupOf(item: ForgeItem): Group {
  if (item.key.startsWith("pose_")) return "Poses";
  if (item.kind === "portrait") return "Cast";
  if (item.kind === "ui") return "Cards";
  if (item.kind === "item") return "Props";
  if (item.kind === "scene")
    return BEAT_KEY_RE.test(item.key)
      ? "Scenes" // beat art keyed by outline beat id
      : "Locations"; // establishing shots keyed by place slug ('command_bridge')
  return "Scenes"; // anything unrecognized
}

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---- component -------------------------------------------------------------------

export default function WorldForge({
  playthroughId,
  readonly = false,
  onClose,
  onProgress,
}: WorldForgeProps) {
  const [status, setStatus] = useState<ForgeStatus | null>(null);
  const [stalled, setStalled] = useState(false); // 404s beyond patience, or fetch death
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Group | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // ---- polling (live) / single fetch (readonly) --------------------------------
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;

    async function tick() {
      let retryable = true;
      try {
        const res = await fetch(
          `/api/forge?playthroughId=${encodeURIComponent(playthroughId)}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (res.status === 404) {
          // the POST may still be spinning up — wait and retry for ~15s
          misses += 1;
          if (readonly || (misses >= 3 && Date.now() - mountedAt > 15_000)) {
            setStalled(true);
            onProgressRef.current?.({ done: 0, total: 0, settled: true });
            return;
          }
        } else if (res.ok) {
          misses = 0;
          const data = (await res.json()) as ForgeStatus;
          if (cancelled) return;
          setStatus(data);
          setStalled(false);
          const complete = !data.running && data.total > 0 && data.done >= data.total;
          onProgressRef.current?.({
            done: data.done,
            total: data.total,
            settled: complete || !data.running,
          });
          if (readonly) return; // codex mode: one snapshot is enough
          if (complete) return;
        } else if (readonly) {
          setStalled(true);
          return;
        }
      } catch {
        if (cancelled) return;
        if (readonly) {
          setStalled(true);
          retryable = false;
        }
      }
      if (!cancelled && retryable) timer = setTimeout(tick, 900);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [playthroughId, readonly, mountedAt]);

  // ---- elapsed-seconds ticker (live only) ---------------------------------------
  const running = !readonly && (status === null ? !stalled : status.running);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const complete =
    status !== null && !status.running && status.total > 0 && status.done >= status.total;

  const elapsedSec = useMemo(() => {
    if (status && !status.running) return (status.wallMs ?? 0) / 1000;
    const from = status?.startedAt || mountedAt;
    return Math.max(0, (now - from) / 1000);
  }, [status, now, mountedAt]);

  // ---- derived: grouped counts + stagger assignment ------------------------------
  const items = useMemo(() => status?.items ?? [], [status]);

  const counts = useMemo(() => {
    const c = new Map<Group, number>();
    for (const it of items) {
      const g = groupOf(it);
      c.set(g, (c.get(g) ?? 0) + 1);
    }
    return c;
  }, [items]);

  const visible = filter ? items.filter((it) => groupOf(it) === filter) : items;
  const total = status?.total ?? 0;
  const done = status?.done ?? 0;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;

  // ---- render pieces ---------------------------------------------------------------

  const body = (
    <div className="vn w-full" style={{ fontFamily: "var(--vn-font-display)" }}>
      <style>{`
        @keyframes wf-pop { from { opacity: 0; transform: scale(0.72); } to { opacity: 1; transform: scale(1); } }
        @keyframes wf-flow { from { background-position: 0 0; } to { background-position: 48px 0; } }
        .wf-tile { position: relative; overflow: hidden; border-radius: 8px; border: 1px solid rgba(217,179,108,0.22); background: linear-gradient(180deg, #1c1610 0%, #0e0b07 100%); animation: wf-pop 480ms cubic-bezier(0.22, 1.2, 0.36, 1) both; }
        .wf-tile img { transition: transform 400ms ease; }
        .wf-tile:hover img { transform: scale(1.07); }
        .wf-tile:hover { border-color: rgba(240,208,144,0.55); }
        .wf-ms { position: absolute; right: 3px; bottom: 3px; font-size: 9px; line-height: 1; padding: 2px 4px; border-radius: 4px; background: rgba(6,5,3,0.72); color: rgba(240,208,144,0.85); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
        .wf-chip { border: 1px solid rgba(217,179,108,0.28); border-radius: 999px; padding: 5px 12px; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(242,232,213,0.65); background: rgba(217,179,108,0.04); cursor: pointer; transition: color 200ms ease, border-color 200ms ease, background 200ms ease; white-space: nowrap; }
        .wf-chip:hover { border-color: rgba(240,208,144,0.5); color: var(--vn-paper); }
        .wf-chip.on { color: var(--vn-gold-bright); border-color: rgba(240,208,144,0.65); background: rgba(217,179,108,0.12); }
        .wf-chip .n { color: var(--vn-gold); margin-left: 6px; font-variant-numeric: tabular-nums; }
        @media (prefers-reduced-motion: reduce) { .wf-tile { animation: none; } }
      `}</style>

      {/* header */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="vn-kicker">The World Forge</p>
          <h2
            className="mt-1.5 text-2xl sm:text-3xl"
            style={{
              fontWeight: 400,
              letterSpacing: "0.05em",
              background:
                "linear-gradient(180deg, #f7edd8 20%, var(--vn-gold-bright) 60%, #b08a48 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {readonly ? "Your world" : complete ? "Your world, forged" : "Forging your world…"}
          </h2>
        </div>
        {!readonly && !complete && (
          <div
            className="flex items-baseline gap-4 text-right"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span className="text-xl" style={{ color: "var(--vn-gold-bright)" }}>
              {done}
              <span style={{ color: "rgba(242,232,213,0.4)" }}> / {total || "…"}</span>
            </span>
            <span className="text-sm" style={{ color: "rgba(242,232,213,0.5)" }}>
              {elapsedSec.toFixed(0)}s
            </span>
          </div>
        )}
      </header>

      {/* progress bar (live, in flight) */}
      {!readonly && !complete && !stalled && (
        <div
          className="mt-4 h-[3px] w-full overflow-hidden rounded-full"
          style={{ background: "rgba(242,232,213,0.1)" }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total || 100}
          aria-valuenow={done}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(pct, 1.5)}%`,
              background: "linear-gradient(90deg, var(--vn-gold), var(--vn-gold-bright))",
              boxShadow: "0 0 10px rgba(240,208,144,0.5)",
              transition: "width 700ms ease",
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 10px, transparent 10px 24px), linear-gradient(90deg, var(--vn-gold), var(--vn-gold-bright))",
              backgroundSize: "48px 100%, 100% 100%",
              animation: "wf-flow 1.2s linear infinite",
            }}
          />
        </div>
      )}

      {/* completion banner */}
      {complete && status && (
        <p
          className="mt-4 text-base sm:text-lg"
          style={{
            color: "var(--vn-gold-bright)",
            letterSpacing: "0.06em",
            textShadow: "0 0 24px rgba(217,179,108,0.35)",
            animation: "vn-rise-in 600ms ease-out both",
          }}
        >
          ⚒ {status.total} assets · {fmtSeconds(status.wallMs ?? 0)} · one pipeline
        </p>
      )}

      {/* stalled / empty codex */}
      {stalled && items.length === 0 && (
        <p className="mt-5 text-sm italic" style={{ color: "rgba(242,232,213,0.5)" }}>
          {readonly
            ? "The codex is empty — this world was never forged."
            : "The forge is quiet. Your world will be painted as the story unfolds."}
        </p>
      )}

      {/* category chips */}
      {items.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className={`wf-chip${filter === null ? " on" : ""}`}
            onClick={() => setFilter(null)}
          >
            All<span className="n">{items.length}</span>
          </button>
          {GROUPS.map((g) => {
            const n = counts.get(g) ?? 0;
            if (n === 0) return null;
            return (
              <button
                key={g}
                type="button"
                className={`wf-chip${filter === g ? " on" : ""}`}
                onClick={() => setFilter(filter === g ? null : g)}
              >
                <span aria-hidden style={{ marginRight: 6, color: "var(--vn-gold)" }}>
                  {GROUP_GLYPH[g]}
                </span>
                {g}
                <span className="n">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* the gallery */}
      {visible.length > 0 && (
        <div
          className="mt-4 grid gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))" }}
        >
          {visible.map((it, i) => (
            <div
              key={it.key}
              className="wf-tile aspect-square"
              title={`${it.label} · ${groupOf(it)} · ${fmtSeconds(it.ms)}`}
              // pure batch-cascade: keys are stable, so settled tiles never
              // re-animate on poll; newly landed tiles pop in staggered
              style={{ animationDelay: `${(i % 8) * 65}ms` }}
            >
              {it.ok && it.assetId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/assets/${it.assetId}`}
                  alt={it.label}
                  loading="lazy"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center"
                  style={{ opacity: 0.45 }}
                >
                  <span aria-hidden style={{ color: "rgba(229,72,77,0.8)", fontSize: 18 }}>
                    ✕
                  </span>
                </div>
              )}
              <span className="wf-ms" aria-hidden>
                {fmtSeconds(it.ms)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* forging with nothing landed yet: an anticipatory shimmer row */}
      {!readonly && !stalled && items.length === 0 && (
        <div className="mt-6 flex items-center gap-3">
          <div
            className="relative h-[3px] w-28 overflow-hidden rounded-full"
            style={{ background: "rgba(242,232,213,0.1)" }}
          >
            <div
              className="h-full w-1/3 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--vn-gold-bright), transparent)",
                animation: "vn-shimmer 1.1s ease-in-out infinite",
              }}
            />
          </div>
          <p className="text-sm italic" style={{ color: "rgba(242,232,213,0.55)" }}>
            stoking the forge…
          </p>
        </div>
      )}
    </div>
  );

  // Readonly + onClose: present as a fullscreen codex overlay.
  if (readonly && onClose) {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-black/90 backdrop-blur-md">
        <div className="mx-auto max-w-4xl p-6 pt-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">{body}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close codex"
              className="flex h-12 w-12 flex-none items-center justify-center rounded-full border text-3xl leading-none"
              style={{
                borderColor: "rgba(217,179,108,0.35)",
                background: "rgba(16,13,8,0.8)",
                color: "rgba(242,232,213,0.75)",
              }}
            >
              ×
            </button>
          </div>
        </div>
      </div>
    );
  }

  return body;
}
