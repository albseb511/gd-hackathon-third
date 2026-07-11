"use client";

// The Dusk-Falls-style story map: beats as nodes in act columns, traversal
// edges weighted by the simulated population, the player's own route lit
// in amber, unvisited branches as spoiler-safe "?".
//
// Rows inside each column are ordered by a 2-pass weighted barycenter sweep
// (left→right on incoming edges, then right→left on outgoing) so edges flow
// straighter and cross less.

import { useMemo } from "react";
import type { AggregateNode, AggregateResult } from "@/lib/sim/aggregate";

interface Props {
  aggregate: AggregateResult;
  playerPath?: string[] | null;
  height?: number;
}

interface Positioned {
  beatId: string;
  label: string;
  visits: number;
  x: number;
  y: number;
  onPlayerPath: boolean;
  isEnding: boolean;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

const columnHeader = (actId: string, storyActIndex: number): string => {
  if (actId === "ending") return "ENDINGS";
  if (actId === "improvised") return "OFF SCRIPT";
  return `ACT ${ROMAN[storyActIndex] ?? storyActIndex + 1}`;
};

export default function BranchMap({ aggregate, playerPath, height = 480 }: Props) {
  const { nodes, edges, headers, W, H } = useMemo(() => {
    const actIds: string[] = [];
    for (const n of aggregate.nodes) {
      if (!actIds.includes(n.actId)) actIds.push(n.actId);
    }
    // story acts keep outline order; off-script beats next; endings always last
    const rank = (id: string) => (id === "ending" ? 2 : id === "improvised" ? 1 : 0);
    actIds.sort((a, b) => rank(a) - rank(b));
    const cols = actIds.length || 1;
    const W = Math.max(760, cols * 232);
    const H = height;
    const playerSet = new Set(playerPath ?? []);

    // ---- columns in outline order --------------------------------------
    const columns: AggregateNode[][] = actIds.map((id) =>
      aggregate.nodes.filter((n) => n.actId === id),
    );

    // ---- 2-pass weighted barycenter row ordering ------------------------
    const rowOf = new Map<string, number>();
    const syncRows = () =>
      columns.forEach((col) => col.forEach((n, i) => rowOf.set(n.beatId, i)));
    syncRows();

    const barycenter = (beatId: string, dir: "in" | "out"): number => {
      let weighted = 0;
      let total = 0;
      for (const e of aggregate.edges) {
        const neighbor =
          dir === "in"
            ? e.to === beatId
              ? e.from
              : null
            : e.from === beatId
              ? e.to
              : null;
        if (!neighbor) continue;
        const row = rowOf.get(neighbor);
        if (row === undefined) continue;
        weighted += row * e.count;
        total += e.count;
      }
      return total > 0 ? weighted / total : rowOf.get(beatId) ?? 0;
    };

    const reorder = (col: AggregateNode[], dir: "in" | "out") => {
      const score = new Map(col.map((n) => [n.beatId, barycenter(n.beatId, dir)]));
      col.sort((a, b) => score.get(a.beatId)! - score.get(b.beatId)!);
      syncRows();
    };
    // pass 1: left→right, pull nodes toward their incoming sources
    for (let c = 1; c < columns.length; c++) reorder(columns[c], "in");
    // pass 2: right→left, pull nodes toward their outgoing targets
    for (let c = columns.length - 2; c >= 0; c--) reorder(columns[c], "out");

    // ---- positions & headers --------------------------------------------
    const colX = (c: number) => 120 + c * ((W - 240) / Math.max(1, cols - 1));
    const TOP = 66; // room for the ACT headers
    const positioned = new Map<string, Positioned>();
    columns.forEach((colNodes, col) => {
      colNodes.forEach((n, row) => {
        positioned.set(n.beatId, {
          beatId: n.beatId,
          label: n.label,
          visits: n.visits,
          x: colX(col),
          y: TOP + (row + 0.5) * ((H - TOP - 40) / colNodes.length),
          onPlayerPath: playerSet.has(n.beatId),
          isEnding: n.actId === "ending" || /^end(ing)?[_-]/i.test(n.beatId),
        });
      });
    });

    let storyAct = 0;
    const headers = actIds.map((id, c) => ({
      x: colX(c),
      text: columnHeader(
        id,
        id === "ending" || id === "improvised" ? 0 : storyAct++,
      ),
    }));

    const posEdges = aggregate.edges
      .map((e) => ({
        ...e,
        a: positioned.get(e.from),
        b: positioned.get(e.to),
        onPlayerPath:
          playerSet.has(e.from) &&
          playerSet.has(e.to) &&
          (playerPath ?? []).some(
            (p, i) => p === e.from && (playerPath ?? [])[i + 1] === e.to,
          ),
      }))
      .filter((e) => e.a && e.b);

    return { nodes: [...positioned.values()], edges: posEdges, headers, W, H };
  }, [aggregate, playerPath, height]);

  const maxEdge = Math.max(1, ...edges.map((e) => e.count));
  const hasPlayer = (playerPath?.length ?? 0) > 0;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ minWidth: W, height }}
        className="block"
      >
        {/* act column headers */}
        {headers.map((h) => (
          <text
            key={`${h.text}-${h.x}`}
            x={h.x}
            y={26}
            textAnchor="middle"
            fill="#8f8f98"
            fontSize="12"
            fontWeight="600"
            letterSpacing="0.25em"
            style={{ fontFamily: "var(--font-geist-sans, sans-serif)" }}
          >
            {h.text}
          </text>
        ))}

        {edges.map((e, i) => {
          const a = e.a!;
          const b = e.b!;
          const mx = (a.x + b.x) / 2;
          const w = 1 + (e.count / maxEdge) * 5;
          return (
            <g key={i}>
              <path
                d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
                fill="none"
                stroke={e.onPlayerPath ? "#f59e0b" : "#3f3f46"}
                strokeWidth={e.onPlayerPath ? Math.max(2.5, w) : w}
                opacity={e.onPlayerPath ? 0.95 : hasPlayer ? 0.25 : 0.4}
              />
              {e.count > 0 && (
                <text
                  x={mx}
                  y={(a.y + b.y) / 2 - 5}
                  textAnchor="middle"
                  fill={e.onPlayerPath ? "#b98a2e" : "#67676f"}
                  fontSize="10"
                >
                  {e.count}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => (
          <g key={n.beatId} transform={`translate(${n.x}, ${n.y})`}>
            <circle
              r={n.onPlayerPath ? 11 : 8}
              fill={
                n.onPlayerPath
                  ? "#f59e0b"
                  : n.visits > 0
                    ? "#52525b"
                    : "#27272a"
              }
              stroke={n.isEnding ? "#a1a1aa" : "none"}
              strokeWidth={n.isEnding ? 2 : 0}
            />
            <text
              y={-16}
              textAnchor="middle"
              fill={
                n.onPlayerPath
                  ? "#fde68a"
                  : n.visits > 0
                    ? hasPlayer
                      ? "#a1a1aa"
                      : "#d4d4d8"
                    : "#71717a"
              }
              fontSize="14"
              fontWeight={n.onPlayerPath ? 600 : 400}
              style={{ fontFamily: "var(--font-geist-sans, sans-serif)" }}
            >
              {n.visits > 0 || n.onPlayerPath ? n.label : "?"}
            </text>
            {n.visits > 0 && (
              <text y={24} textAnchor="middle" fill="#7c7c85" fontSize="11">
                {n.visits}×
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
