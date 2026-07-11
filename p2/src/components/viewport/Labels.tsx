"use client";

import { Html } from "@react-three/drei";
import { useScene } from "@/scene/store";
import { useView } from "./viewStore";
import { catalogEntry } from "@/scene/catalog";

// Floating explanatory labels anchored in 3D (drei Html): a tag per room and a
// card on the selected furniture item.
export function Labels() {
  const design = useScene((s) => s.design);
  const selectedId = useScene((s) => s.selectedId);
  const showLabels = useView((s) => s.showLabels);
  const rooms = design.rooms ?? [];
  const selected = design.furniture.find((f) => f.id === selectedId);
  const selEntry = selected ? catalogEntry(selected.catalogId ?? "") : undefined;

  return (
    <>
      {showLabels &&
        rooms.map((r) => {
          const cx = (r.bounds.min[0] + r.bounds.max[0]) / 2;
          const cz = (r.bounds.min[1] + r.bounds.max[1]) / 2;
          const area = (r.bounds.max[0] - r.bounds.min[0]) * (r.bounds.max[1] - r.bounds.min[1]);
          return (
            <Html key={r.id} position={[cx, 0.06, cz]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
              <div className="whitespace-nowrap rounded-md border border-white/10 bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                {r.name} · {area.toFixed(1)} m²
              </div>
            </Html>
          );
        })}
      {selected && (
        <Html position={[selected.pos[0], (selEntry?.height ?? 0.6) + 0.2, selected.pos[2]]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-lg border border-sky-300/30 bg-sky-600/85 px-2 py-1 text-[11px] text-white backdrop-blur">
            {selEntry?.label ?? selected.catalogId}
            {selEntry ? ` · ${selEntry.footprint[0]}×${selEntry.footprint[1]}m` : ""}
          </div>
        </Html>
      )}
    </>
  );
}
