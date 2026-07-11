"use client";

// The Dusk-Falls-style story map: beats as nodes in act columns, traversal
// edges weighted by the simulated population, the player's own route lit
// in amber, unvisited branches as spoiler-safe "?".

import { useMemo } from "react";
import type { AggregateResult } from "@/lib/sim/aggregate";

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
  visitedByPlayer: boolean;
  isEnding: boolean;
}

export default function BranchMap({ aggregate, playerPath, height = 480 }: Props) {
  const { nodes, edges, W, H } = useMemo(() => {
    const acts: string[] = [];
    for (const n of aggregate.nodes) {
      if (!acts.includes(n.actId)) acts.push(n.actId);
    }
    // endings and improvised nodes go to the last column
    const cols = acts.length || 1;
    const W = Math.max(760, cols * 260);
    const H = height;
    const playerSet = new Set(playerPath ?? []);

    const byAct = new Map<string, typeof aggregate.nodes>();
    for (const n of aggregate.nodes) {
      const arr = byAct.get(n.actId) ?? [];
      arr.push(n);
      byAct.set(n.actId, arr);
    }

    const positioned = new Map<string, Positioned>();
    acts.forEach((act, col) => {
      const colNodes = byAct.get(act) ?? [];
      colNodes.forEach((n, row) => {
        positioned.set(n.beatId, {
          beatId: n.beatId,
          label: n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label,
          visits: n.visits,
          x: 140 + col * ((W - 280) / Math.max(1, cols - 1)),
          y: 50 + (row + 0.5) * ((H - 100) / colNodes.length),
          onPlayerPath: playerSet.has(n.beatId),
          visitedByPlayer: playerSet.has(n.beatId),
          isEnding: n.actId === "(ending)" || n.beatId.startsWith("ending"),
        });
      });
    });

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

    return { nodes: [...positioned.values()], edges: posEdges, W, H };
  }, [aggregate, playerPath, height]);

  const maxEdge = Math.max(1, ...edges.map((e) => e.count));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ minWidth: W, height }}
        className="block"
      >
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
                opacity={e.onPlayerPath ? 0.95 : 0.55}
              />
              {e.count > 0 && (
                <text
                  x={mx}
                  y={(a.y + b.y) / 2 - 6}
                  textAnchor="middle"
                  fill="#71717a"
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
              fill={n.onPlayerPath ? "#fbbf24" : n.visitedByPlayer || n.visits > 0 ? "#a1a1aa" : "#52525b"}
              fontSize="11"
              style={{ fontFamily: "var(--font-geist-sans, sans-serif)" }}
            >
              {n.visitedByPlayer || n.visits > 0 ? n.label : "?"}
            </text>
            {n.visits > 0 && (
              <text y={24} textAnchor="middle" fill="#71717a" fontSize="10">
                {n.visits}×
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
