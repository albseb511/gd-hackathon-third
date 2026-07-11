"use client";

import { useMemo } from "react";
import type { RoomDesign, Wall } from "@/scene/types";

function materialColor(design: RoomDesign, id: string | undefined, fallback: string): string {
  if (!id) return fallback;
  return design.materials.find((m) => m.id === id)?.color ?? fallback;
}

function materialRoughness(design: RoomDesign, id: string | undefined, fallback: number): number {
  if (!id) return fallback;
  return design.materials.find((m) => m.id === id)?.roughness ?? fallback;
}

// Openings are rendered as inset panels on the interior wall face (M0 does not
// yet CSG-cut holes — that lands with the Architect agent).
function WallGroup({ design, wall }: { design: RoomDesign; wall: Wall }) {
  const dx = wall.to[0] - wall.from[0];
  const dz = wall.to[1] - wall.from[1];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx); // rotation about Y is -angle (local +X → world dir)
  const mx = (wall.from[0] + wall.to[0]) / 2;
  const mz = (wall.from[1] + wall.to[1]) / 2;

  const color = materialColor(design, wall.material, "#e8e4dc");
  const roughness = materialRoughness(design, wall.material, 0.95);

  const openings = design.openings.filter((o) => o.wallId === wall.id);

  return (
    <group position={[mx, wall.height / 2, mz]} rotation={[0, -angle, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[len, wall.height, wall.thickness]} />
        <meshStandardMaterial color={color} roughness={roughness} />
      </mesh>
      {openings.map((o) => {
        const alongCentre = o.offset + o.size[0] / 2 - len / 2;
        const centreY = (o.type === "door" ? o.size[1] / 2 : (o.sill ?? 0.9) + o.size[1] / 2) - wall.height / 2;
        const isDoor = o.type === "door";
        return (
          <mesh key={o.id} position={[alongCentre, centreY, wall.thickness / 2 + 0.006]}>
            <planeGeometry args={[o.size[0], o.size[1]]} />
            <meshStandardMaterial
              color={isDoor ? "#3a2f28" : "#bcd6e6"}
              roughness={isDoor ? 0.6 : 0.1}
              metalness={isDoor ? 0 : 0.1}
              emissive={isDoor ? "#000000" : "#8fb4c9"}
              emissiveIntensity={isDoor ? 0 : 0.25}
              transparent={!isDoor}
              opacity={isDoor ? 1 : 0.55}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export function RoomMesh({ design }: { design: RoomDesign }) {
  const { w, d } = design.room.dims;
  const floorColor = materialColor(design, design.room.floor.materialId, "#b98a58");
  const floorRoughness = materialRoughness(design, design.room.floor.materialId, 0.7);
  const walls = useMemo(() => design.walls, [design.walls]);

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, d / 2]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={floorColor} roughness={floorRoughness} />
      </mesh>
      {walls.map((wall) => (
        <WallGroup key={wall.id} design={design} wall={wall} />
      ))}
    </group>
  );
}
