// Pure aggregation over simulator runs: branch-graph visits/edges, "X% of
// players chose Y" stats, ending distribution, unreached beats, and latency
// percentiles. No I/O — feeds both the CLI report and any future dashboard.

import type { StoryOutline } from "../storyEngine/types";
import type { SimRunResult } from "./simulate";

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

const truncate = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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
      nodes.push({
        beatId: beat.id,
        label: truncate(beat.summary),
        visits: visits.get(beat.id) ?? 0,
        actId: act.id,
      });
    }
  }
  const endingIds = new Set(outline.endings.map((e) => e.id));
  // Beats that showed up in paths but aren't in the outline (GM improvisation
  // or ending ids written as beats) still get nodes so edges stay connected.
  for (const beatId of visits.keys()) {
    if (!outlineBeatIds.has(beatId)) {
      nodes.push({
        beatId,
        label: endingIds.has(beatId) ? `(ending) ${beatId}` : `(improvised) ${beatId}`,
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
    .map(([endingId, count]) => ({ endingId, count, pct: pct(count, runs.length) }))
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
