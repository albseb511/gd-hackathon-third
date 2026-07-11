// Pure aggregation over simulator runs: branch-graph visits/edges, "X% of
// players chose Y" stats, ending distribution, unreached beats, and latency
// percentiles. No I/O — feeds both the CLI report and any future dashboard.

import type { OutlineBeat, StoryOutline } from "../storyEngine/types";
import type { SimRunResult } from "./simulate";

// Outline beats are gaining short 2-4 word `label` titles; tolerate data that
// hasn't been backfilled yet by falling back to a shortened summary.
type LabeledBeat = OutlineBeat & { label?: string };

export interface AggregateNode {
  beatId: string;
  label: string;
  visits: number;
  actId: string;
}

export interface AggregateEdge {
  from: string;
  to: string;
  count: number;
}

export interface ChoiceStat {
  beatId: string;
  options: { option: string; count: number; pct: number }[];
}

export interface EndingStat {
  endingId: string;
  /** outline tone (tragic | bittersweet | triumphant | …) when known */
  tone?: string;
  count: number;
  pct: number;
}

export interface LatencyStat {
  step: string;
  p50: number;
  p95: number;
  n: number;
}

export interface AggregateResult {
  nodes: AggregateNode[];
  edges: AggregateEdge[];
  choiceStats: ChoiceStat[];
  endings: EndingStat[];
  unreachedBeats: string[];
  latency: LatencyStat[];
}

/** Word-boundary truncation — never cuts mid-word ("The bridge is b…"). */
export function shorten(s: string, n = 26): string {
  const t = s.trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1);
  const sp = cut.lastIndexOf(" ");
  const head = sp > n / 2 ? cut.slice(0, sp) : t.slice(0, n);
  return `${head.replace(/[\s,;:.!?—-]+$/, "")}…`;
}

const ENDING_EMOJI: Record<string, string> = {
  tragic: "💔",
  bittersweet: "🌗",
  triumphant: "🌅",
  unfinished: "⏳",
};

/**
 * "end_tragic" / "ending-bittersweet" / "(unfinished)" → "💔 Tragic",
 * "🌗 Bittersweet", "⏳ Unfinished". The ONE place ending ids get friendly.
 */
export function prettyEnding(endingId: string, tone?: string): string {
  const name = endingId
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .replace(/^end(ing)?[_-]?/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const display = name ? name.charAt(0).toUpperCase() + name.slice(1) : "The end";
  const emoji =
    ENDING_EMOJI[(tone ?? "").toLowerCase()] ??
    ENDING_EMOJI[name.toLowerCase()] ??
    "⭐";
  return `${emoji} ${display}`;
}

const pct = (count: number, total: number) =>
  total === 0 ? 0 : Math.round((count / total) * 1000) / 10;

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function aggregate(runs: SimRunResult[], outline: StoryOutline): AggregateResult {
  // ---- visits per beat -----------------------------------------------------
  const visits = new Map<string, number>();
  for (const run of runs) {
    for (const beatId of run.path) {
      visits.set(beatId, (visits.get(beatId) ?? 0) + 1);
    }
  }

  const nodes: AggregateNode[] = [];
  const outlineBeatIds = new Set<string>();
  for (const act of outline.acts) {
    for (const beat of act.beats) {
      outlineBeatIds.add(beat.id);
      const short = (beat as LabeledBeat).label?.trim();
      nodes.push({
        beatId: beat.id,
        label: short || shorten(beat.summary),
        visits: visits.get(beat.id) ?? 0,
        actId: act.id,
      });
    }
  }
  const endingIds = new Set(outline.endings.map((e) => e.id));
  const endingTone = new Map(outline.endings.map((e) => [e.id, e.tone]));
  // Beats that showed up in paths but aren't in the outline (GM improvisation
  // or ending ids written as beats) still get nodes so edges stay connected.
  for (const beatId of visits.keys()) {
    if (!outlineBeatIds.has(beatId)) {
      nodes.push({
        beatId,
        label: endingIds.has(beatId)
          ? prettyEnding(beatId, endingTone.get(beatId))
          : shorten(beatId.replace(/[_-]+/g, " ")),
        visits: visits.get(beatId) ?? 0,
        actId: endingIds.has(beatId) ? "ending" : "improvised",
      });
    }
  }

  // ---- edges from consecutive path entries ----------------------------------
  const edgeCounts = new Map<string, AggregateEdge>();
  for (const run of runs) {
    for (let i = 0; i + 1 < run.path.length; i++) {
      const from = run.path[i];
      const to = run.path[i + 1];
      const key = `${from}→${to}`;
      const edge = edgeCounts.get(key);
      if (edge) edge.count++;
      else edgeCounts.set(key, { from, to, count: 1 });
    }
  }
  const edges = [...edgeCounts.values()].sort((a, b) => b.count - a.count);

  // ---- choice stats: "X% of players chose Y" ---------------------------------
  const byBeat = new Map<string, Map<string, number>>();
  for (const run of runs) {
    for (const choice of run.choices) {
      let counts = byBeat.get(choice.beatId);
      if (!counts) byBeat.set(choice.beatId, (counts = new Map()));
      counts.set(choice.picked, (counts.get(choice.picked) ?? 0) + 1);
    }
  }
  const choiceStats: ChoiceStat[] = [...byBeat.entries()].map(([beatId, counts]) => {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return {
      beatId,
      options: [...counts.entries()]
        .map(([option, count]) => ({ option, count, pct: pct(count, total) }))
        .sort((a, b) => b.count - a.count),
    };
  });

  // ---- endings ----------------------------------------------------------------
  const endingCounts = new Map<string, number>();
  for (const run of runs) {
    const id = run.endingId ?? "(unfinished)";
    endingCounts.set(id, (endingCounts.get(id) ?? 0) + 1);
  }
  const endings: EndingStat[] = [...endingCounts.entries()]
    .map(([endingId, count]) => ({
      endingId,
      tone: endingTone.get(endingId),
      count,
      pct: pct(count, runs.length),
    }))
    .sort((a, b) => b.count - a.count);

  // ---- unreached outline beats ---------------------------------------------------
  const unreachedBeats = [...outlineBeatIds].filter((id) => !visits.has(id));

  // ---- latency percentiles per step -----------------------------------------------
  const byStep = new Map<string, number[]>();
  for (const run of runs) {
    for (const { step, ms } of run.latencies) {
      let arr = byStep.get(step);
      if (!arr) byStep.set(step, (arr = []));
      arr.push(ms);
    }
  }
  const latency: LatencyStat[] = [...byStep.entries()].map(([step, arr]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      step,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      n: sorted.length,
    };
  });

  return { nodes, edges, choiceStats, endings, unreachedBeats, latency };
}
