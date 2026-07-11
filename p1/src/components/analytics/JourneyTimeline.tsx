// Mobile-first "your journey" view: the player's route (or the most-traveled
// road) as a big, kid-readable vertical timeline instead of the SVG graph.
// Pure DOM, no hooks — renders in server pages and client overlays alike.

import { prettyEnding, shorten } from "@/lib/sim/aggregate";
import type { AggregateResult } from "@/lib/sim/aggregate";

interface Props {
  aggregate: AggregateResult;
  playerPath?: string[] | null;
  simCount?: number;
}

interface Step {
  beatId: string;
  label: string;
  chapter: string;
  isEnding: boolean;
  /** top choice at this beat, if any */
  topChoice?: { option: string; pct: number };
  /** how the player got HERE vs everyone else (player mode only) */
  arrival?: { rare: boolean; pct: number };
}

/** options sometimes arrive already quoted — strip so we can add our own */
function unquote(s: string): string {
  return s.trim().replace(/^["“”']+/, "").replace(/["“”']+$/, "");
}

function buildSteps(
  aggregate: AggregateResult,
  playerPath?: string[] | null,
): { steps: Step[]; isPlayerJourney: boolean } {
  const nodeById = new Map(aggregate.nodes.map((n) => [n.beatId, n]));

  // ordered story chapters (acts), endings/improvised handled separately
  const actOrder: string[] = [];
  for (const n of aggregate.nodes) {
    if (n.actId === "ending" || n.actId === "improvised") continue;
    if (!actOrder.includes(n.actId)) actOrder.push(n.actId);
  }

  const chapterFor = (beatId: string): { chapter: string; isEnding: boolean } => {
    const node = nodeById.get(beatId);
    const actId = node?.actId ?? "";
    if (actId === "ending" || /^end(ing)?[_-]/i.test(beatId))
      return { chapter: "The End", isEnding: true };
    if (actId === "improvised") return { chapter: "A surprise turn", isEnding: false };
    if (!node) return { chapter: "The beginning", isEnding: false };
    const idx = actOrder.indexOf(actId);
    return { chapter: idx >= 0 ? `Chapter ${idx + 1}` : "A surprise turn", isEnding: false };
  };

  const isPlayerJourney = !!playerPath && playerPath.length > 0;

  // path: the player's own, or greedily follow the busiest edges from the start
  let path: string[];
  if (isPlayerJourney) {
    path = playerPath!;
  } else {
    path = [];
    const start = aggregate.nodes[0]?.beatId;
    if (start) {
      const seen = new Set<string>();
      let cur: string | undefined = start;
      while (cur && !seen.has(cur) && path.length <= aggregate.nodes.length) {
        path.push(cur);
        seen.add(cur);
        const out = aggregate.edges.filter((e) => e.from === cur && !seen.has(e.to));
        out.sort((a, b) => b.count - a.count);
        cur = out[0]?.to;
      }
    }
  }

  const steps: Step[] = path.map((beatId, i) => {
    const node = nodeById.get(beatId);
    const { chapter, isEnding } = chapterFor(beatId);
    const label = isEnding
      ? `${prettyEnding(beatId)} ending`
      : (node?.label ??
        (beatId === "start"
          ? "Your story begins…"
          : beatId.replace(/[_-]/g, " ")));

    // what most players picked at this beat
    const stat = aggregate.choiceStats.find((c) => c.beatId === beatId);
    const topChoice = stat?.options[0]
      ? {
          option: shorten(unquote(stat.options[0].option), 40),
          pct: Math.round(stat.options[0].pct),
        }
      : undefined;

    // player mode: was the road INTO this step busy or rare?
    let arrival: Step["arrival"];
    if (isPlayerJourney && i > 0) {
      const from = path[i - 1];
      const outgoing = aggregate.edges.filter((e) => e.from === from);
      const taken = outgoing.find((e) => e.to === beatId);
      const total = outgoing.reduce((a, e) => a + e.count, 0);
      const maxCount = Math.max(0, ...outgoing.map((e) => e.count));
      if (taken && total > 0) {
        arrival = {
          rare: taken.count < maxCount,
          pct: Math.round((taken.count / total) * 100),
        };
      } else if (!taken && total > 0) {
        // nobody in the simulation ever took this road
        arrival = { rare: true, pct: 0 };
      }
    }

    return { beatId, label, chapter, isEnding, topChoice, arrival };
  });

  return { steps, isPlayerJourney };
}

export default function JourneyTimeline({ aggregate, playerPath, simCount }: Props) {
  const { steps, isPlayerJourney } = buildSteps(aggregate, playerPath);
  const totalRuns =
    simCount ?? aggregate.endings.reduce((a, e) => a + e.count, 0);

  return (
    <div className="text-zinc-100">
      <style>{`
        @keyframes jt-travel {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: calc(100% - 8px); opacity: 0; }
        }
      `}</style>

      {/* ---- heading ------------------------------------------------------ */}
      <div className="mb-6">
        <h3
          className="text-2xl text-amber-300"
          style={{ fontFamily: "var(--font-display, Georgia, serif)" }}
        >
          {isPlayerJourney ? "Your story" : "The most-traveled road"}
        </h3>
        <p className="text-zinc-400 text-base mt-1">
          {isPlayerJourney
            ? "Every step you took, in order."
            : `The path most of our ${totalRuns} storytellers followed.`}
        </p>
      </div>

      {/* ---- timeline ------------------------------------------------------ */}
      <ol className="relative pl-9">
        {/* glowing amber spine */}
        <div
          aria-hidden
          className="absolute left-[11px] top-2 bottom-2 w-[3px] rounded-full"
          style={{
            background:
              "linear-gradient(to bottom, rgba(245,158,11,0.9), rgba(245,158,11,0.35))",
            boxShadow: "0 0 12px rgba(245,158,11,0.55)",
          }}
        >
          {/* animated dots drifting down the spine */}
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-amber-200"
              style={{
                boxShadow: "0 0 8px 2px rgba(251,191,36,0.8)",
                animation: `jt-travel 6s linear infinite`,
                animationDelay: `${i * 2}s`,
              }}
            />
          ))}
        </div>

        {steps.map((s, i) => (
          <li key={`${s.beatId}-${i}`} className="relative pb-8 last:pb-0">
            {/* node marker on the spine */}
            <span
              aria-hidden
              className={`absolute -left-9 top-1.5 ml-[3px] h-[19px] w-[19px] rounded-full border-2 ${
                s.isEnding
                  ? "bg-amber-400 border-amber-200"
                  : "bg-zinc-900 border-amber-400"
              }`}
              style={{ boxShadow: "0 0 10px rgba(245,158,11,0.6)" }}
            />

            <div
              className={`rounded-2xl border p-4 ${
                s.isEnding
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-zinc-700/80 bg-zinc-900/70"
              }`}
            >
              {/* chapter chip */}
              <span className="inline-block rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-sm font-semibold px-3 py-1 mb-2">
                {s.chapter}
              </span>

              {/* the beat itself, big and readable */}
              <p
                className="text-xl leading-snug text-zinc-50"
                style={{ fontFamily: "var(--font-display, Georgia, serif)" }}
              >
                {s.label}
              </p>

              {/* rare-path / crowd badge (player mode) */}
              {s.arrival && (
                <p
                  className={`mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-base font-medium ${
                    s.arrival.rare
                      ? "bg-violet-500/15 text-violet-300 border border-violet-500/40"
                      : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                  }`}
                >
                  {s.arrival.rare
                    ? s.arrival.pct === 0
                      ? "🔀 You went your own way — nobody else came here!"
                      : `🔀 Rare path — only ${s.arrival.pct}% came this way`
                    : `👣 Most players did this too (${s.arrival.pct}%)`}
                </p>
              )}

              {/* what most players chose here */}
              {s.topChoice && (
                <div className="mt-3 border-t border-zinc-700/60 pt-3">
                  <p className="text-base text-zinc-300">
                    Most players ({s.topChoice.pct}%) chose:
                  </p>
                  <p className="text-lg text-amber-200 leading-snug mt-0.5">
                    “{s.topChoice.option}”
                  </p>
                  <div className="mt-2 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${Math.max(4, s.topChoice.pct)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* ---- endings -------------------------------------------------------- */}
      {aggregate.endings.length > 0 && (
        <div className="mt-10">
          <h3
            className="text-2xl text-amber-300 mb-1"
            style={{ fontFamily: "var(--font-display, Georgia, serif)" }}
          >
            How the stories ended
          </h3>
          <p className="text-zinc-400 text-base mb-4">
            {totalRuns} storytellers played — here is where they all ended up.
          </p>
          <div className="space-y-3">
            {aggregate.endings.map((e) => {
              return (
                <div
                  key={e.endingId}
                  className="rounded-2xl border border-zinc-700/80 bg-zinc-900/70 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xl text-zinc-50">
                      {prettyEnding(e.endingId, e.tone)}
                    </p>
                    <span className="text-amber-300 text-xl font-semibold shrink-0">
                      {Math.round(e.pct)}%
                    </span>
                  </div>
                  <p className="text-base text-zinc-400 mt-1">
                    {e.count} of {totalRuns} stories ended this way
                  </p>
                  <div className="mt-2 h-3 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${Math.max(4, e.pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
