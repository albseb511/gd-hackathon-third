"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshStandardMaterial } from "three";
import type { RoomDesign, Wall, Opening } from "@/scene/types";

function matColor(design: RoomDesign, id: string | undefined, fallback: string): string {
  if (!id) return fallback;
  return design.materials.find((m) => m.id === id)?.color ?? fallback;
}
function matRough(design: RoomDesign, id: string | undefined, fallback: number): number {
  if (!id) return fallback;
  return design.materials.find((m) => m.id === id)?.roughness ?? fallback;
}

// A wall solid piece in wall-local coords: x along length, y up.
interface Seg { cx: number; cy: number; w: number; h: number }

// Split a wall into solid segments around its openings (real cut doors/windows).
function wallSegments(len: number, height: number, openings: Opening[]): Seg[] {
  const holes = openings
    .map((o) => ({
      x0: Math.max(0, o.offset),
      x1: Math.min(len, o.offset + o.size[0]),
      yBottom: o.type === "door" ? 0 : o.sill ?? 0.9,
      yTop: (o.type === "door" ? 0 : o.sill ?? 0.9) + o.size[1],
    }))
    .filter((h) => h.x1 > h.x0)
    .sort((a, b) => a.x0 - b.x0);

  const segs: Seg[] = [];
  let cursor = 0;
  for (const h of holes) {
    if (h.x0 > cursor) {
      // full-height solid run before this hole
      const w = h.x0 - cursor;
      segs.push({ cx: cursor + w / 2 - len / 2, cy: height / 2, w, h: height });
    }
    // pieces around the opening (over the length span of the hole)
    const hw = h.x1 - h.x0;
    const cx = h.x0 + hw / 2 - len / 2;
    if (h.yBottom > 0.001) segs.push({ cx, cy: h.yBottom / 2, w: hw, h: h.yBottom }); // under window
    if (h.yTop < height - 0.001) segs.push({ cx, cy: (h.yTop + height) / 2, w: hw, h: height - h.yTop }); // lintel
    cursor = Math.max(cursor, h.x1);
  }
  if (cursor < len) {
    const w = len - cursor;
    segs.push({ cx: cursor + w / 2 - len / 2, cy: height / 2, w, h: height });
  }
  return segs;
}

function WallMesh({
  design,
  wall,
  center,
  xray,
}: {
  design: RoomDesign;
  wall: Wall;
  center: [number, number];
  xray: boolean;
}) {
  const dx = wall.to[0] - wall.from[0];
  const dz = wall.to[1] - wall.from[1];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const mx = (wall.from[0] + wall.to[0]) / 2;
  const mz = (wall.from[1] + wall.to[1]) / 2;
  const color = matColor(design, wall.material, "#e7e3db");
  const roughness = matRough(design, wall.material, 0.95);
  const openings = design.openings.filter((o) => o.wallId === wall.id);
  const segs = useMemo(() => wallSegments(len, wall.height, openings), [len, wall.height, openings]);

  const isRailing = wall.kind === "railing" || wall.height < 1.2;
  const mat = useMemo(
    () => new MeshStandardMaterial({ color, roughness, transparent: true, opacity: 1 }),
    [color, roughness],
  );
  const opacityRef = useRef(1);

  // Auto-fade walls that sit between the camera and the room interior.
  useFrame((state) => {
    let target = 1;
    if (!isRailing) {
      if (xray) target = 0.12;
      else {
        const n = { x: -dz / (len || 1), z: dx / (len || 1) };
        const p = state.camera.position;
        const sideCam = Math.sign((p.x - mx) * n.x + (p.z - mz) * n.z);
        const sideRoom = Math.sign((center[0] - mx) * n.x + (center[1] - mz) * n.z);
        if (sideCam !== 0 && sideRoom !== 0 && sideCam !== sideRoom) target = 0.12;
      }
    }
    opacityRef.current += (target - opacityRef.current) * 0.18;
    mat.opacity = opacityRef.current;
    mat.transparent = opacityRef.current < 0.98;
    mat.depthWrite = opacityRef.current > 0.5;
  });

  return (
    <group position={[mx, 0, mz]} rotation={[0, -angle, 0]}>
      {segs.map((s, i) => (
        <mesh key={i} position={[s.cx, s.cy, 0]} castShadow receiveShadow material={mat}>
          <boxGeometry args={[s.w, s.h, wall.thickness]} />
        </mesh>
      ))}
    </group>
  );
}

export function RoomMesh({ design, xray = false }: { design: RoomDesign; xray?: boolean }) {
  const { w, d } = design.room.dims;
  const center: [number, number] = [w / 2, d / 2];
  const walls = design.walls;
  const rooms = design.rooms ?? [];

  return (
    <group>
      {/* Floors: per-room when a multi-room plan exists, else a single floor. */}
      {rooms.length > 0 ? (
        rooms.map((r) => {
          const fw = r.bounds.max[0] - r.bounds.min[0];
          const fd = r.bounds.max[1] - r.bounds.min[1];
          const cx = (r.bounds.min[0] + r.bounds.max[0]) / 2;
          const cz = (r.bounds.min[1] + r.bounds.max[1]) / 2;
          const color = matColor(design, r.floorMaterial, "#c2a878");
          const rough = matRough(design, r.floorMaterial, 0.7);
          return (
            <mesh key={r.id} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.01, cz]} receiveShadow>
              <planeGeometry args={[fw, fd]} />
              <meshStandardMaterial color={color} roughness={rough} />
            </mesh>
          );
        })
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, d / 2]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial
            color={matColor(design, design.room.floor.materialId, "#b98a58")}
            roughness={matRough(design, design.room.floor.materialId, 0.7)}
          />
        </mesh>
      )}
      {walls.map((wall) => (
        <WallMesh key={wall.id} design={design} wall={wall} center={center} xray={xray} />
      ))}
    </group>
  );
}
