"use client";

import type { ThreeEvent } from "@react-three/fiber";
import type { Furniture } from "@/scene/types";
import { catalogEntry } from "@/scene/catalog";

// Procedural furniture from parametric primitives. Base sits at local y=0; the
// parent group is placed at furniture.pos and yawed by furniture.rot[1].
export function FurnitureMesh({
  item,
  selected,
  onSelect,
}: {
  item: Furniture;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const e = catalogEntry(item.catalogId ?? "");
  if (!e) return null;
  const [w, d] = e.footprint;
  const h = e.height;
  const color = item.material ?? e.color;
  const emissive = selected ? "#3b82f6" : "#000000";
  const emissiveIntensity = selected ? 0.35 : 0;

  const mat = (c: string, rough = 0.8) => (
    <meshStandardMaterial color={c} roughness={rough} emissive={emissive} emissiveIntensity={emissiveIntensity} />
  );

  const legR = 0.03;
  const legs = (topY: number) =>
    [
      [w / 2 - 0.06, d / 2 - 0.06],
      [-w / 2 + 0.06, d / 2 - 0.06],
      [w / 2 - 0.06, -d / 2 + 0.06],
      [-w / 2 + 0.06, -d / 2 + 0.06],
    ].map(([lx, lz], i) => (
      <mesh key={i} position={[lx, topY / 2, lz]} castShadow>
        <cylinderGeometry args={[legR, legR, topY, 8]} />
        {mat("#4a3a2a", 0.6)}
      </mesh>
    ));

  let body: React.ReactNode;
  switch (e.category) {
    case "seating": {
      const seatH = h * 0.45;
      body = (
        <>
          <mesh position={[0, seatH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, seatH, d]} />
            {mat(color)}
          </mesh>
          <mesh position={[0, h * 0.5, -d / 2 + d * 0.09]} castShadow>
            <boxGeometry args={[w, h * 0.55, d * 0.18]} />
            {mat(color)}
          </mesh>
        </>
      );
      break;
    }
    case "table": {
      const topH = Math.max(0.05, h * 0.08);
      body = (
        <>
          <mesh position={[0, h - topH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, topH, d]} />
            {mat(color, 0.5)}
          </mesh>
          {legs(h - topH)}
        </>
      );
      break;
    }
    case "bed": {
      body = (
        <>
          <mesh position={[0, h * 0.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h * 0.6, d]} />
            {mat(color)}
          </mesh>
          <mesh position={[0, h * 0.62, -d / 2 + d * 0.13]} castShadow>
            <boxGeometry args={[w * 0.8, h * 0.16, d * 0.2]} />
            {mat("#ffffff", 0.9)}
          </mesh>
        </>
      );
      break;
    }
    case "lighting": {
      body = (
        <>
          <mesh position={[0, h * 0.42, 0]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, h * 0.84, 10]} />
            {mat("#8a7f5a", 0.4)}
          </mesh>
          <mesh position={[0, h * 0.9, 0]}>
            <coneGeometry args={[0.2, 0.24, 16, 1, true]} />
            <meshStandardMaterial color={color} emissive="#fff2cc" emissiveIntensity={0.8} roughness={0.6} side={2} />
          </mesh>
          <pointLight position={[0, h * 0.85, 0]} intensity={0.4} distance={4} color="#ffe6b0" />
        </>
      );
      break;
    }
    case "decor": {
      if (e.id === "rug") {
        body = (
          <mesh position={[0, 0.012, 0]} receiveShadow>
            <boxGeometry args={[w, 0.02, d]} />
            {mat(color, 0.95)}
          </mesh>
        );
      } else {
        // plant
        body = (
          <>
            <mesh position={[0, 0.18, 0]} castShadow>
              <cylinderGeometry args={[0.16, 0.2, 0.36, 12]} />
              {mat("#9a6a4a", 0.7)}
            </mesh>
            <mesh position={[0, h * 0.65, 0]} castShadow>
              <sphereGeometry args={[Math.min(w, d) * 0.55, 12, 12]} />
              {mat(color, 0.8)}
            </mesh>
          </>
        );
      }
      break;
    }
    default: {
      body = (
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          {mat(color)}
        </mesh>
      );
    }
  }

  return (
    <group
      position={item.pos}
      rotation={item.rot}
      onClick={(ev: ThreeEvent<MouseEvent>) => {
        ev.stopPropagation();
        onSelect(item.id);
      }}
    >
      {body}
    </group>
  );
}
