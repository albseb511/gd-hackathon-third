"use client";

// Post-chapter / post-story overlay: your route vs the simulated population.
import { useEffect, useState } from "react";
import BranchMap from "./BranchMap";
import JourneyTimeline from "./JourneyTimeline";
import { prettyEnding, shorten } from "@/lib/sim/aggregate";
import type { AggregateResult } from "@/lib/sim/aggregate";

interface AnalyticsPayload {
  title: string;
  simCount: number;
  aggregate: AggregateResult;
  playerPath: string[] | null;
}

export default function ChapterRecap({
  storyKey,
  playthroughId,
  onClose,
}: {
  storyKey: string; // prebuilt id or story uuid
  playthroughId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/analytics/${storyKey}?playthroughId=${playthroughId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, [storyKey, playthroughId]);

  return (
    <div className="fixed inset-0 z-40 bg-black/90 backdrop-blur-md overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 pt-10">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <p className="text-amber-400 text-sm tracking-[0.3em] uppercase mb-1">
              Your story so far
            </p>
            <h2
              className="text-3xl md:text-4xl text-zinc-100"
              style={{ fontFamily: "var(--font-display, Georgia, serif)" }}
            >
              {data?.title ?? "…"}
            </h2>
            {data && data.simCount > 0 && (
              <p className="text-zinc-400 text-base mt-1">
                your amber route vs {data.simCount} simulated players
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex items-center justify-center h-12 w-12 rounded-full border border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:text-zinc-50 hover:border-zinc-500 text-3xl leading-none"
            aria-label="close"
          >
            ×
          </button>
        </div>

        {error && <p className="text-zinc-400 text-base">the cartographer is unavailable.</p>}
        {!data && !error && (
          <p className="text-zinc-400 text-base animate-pulse">drawing the map…</p>
        )}
        {data && (
          <>
            {/* phones: big readable journey timeline */}
            <div className="md:hidden mb-6">
              <JourneyTimeline
                aggregate={data.aggregate}
                playerPath={data.playerPath}
                simCount={data.simCount}
              />
            </div>

            {/* md+: the full branch map plus the dense stats */}
            <div className="hidden md:block">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 mb-6">
                <BranchMap
                  aggregate={data.aggregate}
                  playerPath={data.playerPath}
                  height={420}
                />
              </div>

              {data.aggregate.endings.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-zinc-300 text-base uppercase tracking-widest mb-3">
                    How stories end
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {data.aggregate.endings.map((e) => (
                      <div
                        key={e.endingId}
                        className="rounded-lg border border-zinc-800 px-4 py-2 text-base"
                      >
                        <span className="text-zinc-200">{prettyEnding(e.endingId, e.tone)}</span>{" "}
                        <span className="text-amber-400">{e.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.aggregate.choiceStats.slice(0, 4).map((c) => (
                <div key={c.beatId} className="mb-4">
                  <p className="text-zinc-400 text-sm mb-1">
                    {data.aggregate.nodes.find((n) => n.beatId === c.beatId)?.label ??
                      c.beatId.replace(/[_-]+/g, " ")}
                  </p>
                  {c.options.map((o) => (
                    <div key={o.option} className="flex items-center gap-2 mb-1">
                      <div className="h-1.5 bg-amber-500/70 rounded" style={{ width: `${Math.max(2, o.pct)}%`, maxWidth: "60%" }} />
                      <span className="text-zinc-300 text-sm">
                        {o.pct}% — {shorten(o.option, 40)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
