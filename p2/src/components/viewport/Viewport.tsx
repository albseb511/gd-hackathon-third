"use client";

// Scene shell adapted from cake-studio/src/components/editor/Viewport.tsx @ 2026-07-11
// — owned by p2. Renders the store's RoomDesign with a fitted orbit camera, soft
// lighting and shadows. preserveDrawingBuffer stays on for NB2 reskin capture.

import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { useEffect, useRef, type ComponentRef } from "react";
import { PCFSoftShadowMap } from "three";
import { useScene } from "@/scene/store";
import { roomBounds } from "@/scene/defaults";
import { CAMERA_FOV_DEG, viewPose, type Bounds } from "./camera-rig";
import { RoomMesh } from "./RoomMesh";
import { FurnitureMesh } from "./FurnitureMesh";
import { registerCanvas } from "./capture";

function FitCamera({ bounds, fitKey }: { bounds: Bounds; fitKey: string }) {
  const controls = useRef<ComponentRef<typeof CameraControls>>(null);
  const { size } = useThree();
  useEffect(() => {
    const aspect = size.height ? size.width / size.height : 1.6;
    const pose = viewPose("main", bounds, aspect);
    controls.current?.setLookAt(
      pose.position[0], pose.position[1], pose.position[2],
      pose.target[0], pose.target[1], pose.target[2],
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.width, size.height]);
  return (
    <CameraControls ref={controls} makeDefault minDistance={0.6} maxDistance={80} maxPolarAngle={Math.PI / 2 - 0.02} />
  );
}

export default function Viewport() {
  const design = useScene((s) => s.design);
  const selectedId = useScene((s) => s.selectedId);
  const select = useScene((s) => s.select);
  const bounds = roomBounds(design);
  const { w, d, h } = design.room.dims;

  return (
    <Canvas
      shadows={{ type: PCFSoftShadowMap }}
      camera={{ fov: CAMERA_FOV_DEG, position: [8, 6, 9], near: 0.1, far: 200 }}
      gl={{ preserveDrawingBuffer: true, toneMappingExposure: 1.05 }}
      dpr={[1, 2]}
      onCreated={({ gl }) => registerCanvas(gl.domElement)}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={["#0e0f12"]} />
      <hemisphereLight args={["#ffffff", "#3a3a44", 0.6]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[w + 2, h + 6, d + 2]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-16, 16, 16, -16, 0.1, 60]} />
      </directionalLight>
      <directionalLight position={[-4, 5, -3]} intensity={0.3} />

      {design.lights
        .filter((l) => l.type === "point" && l.pos)
        .map((l) => (
          <pointLight key={l.id} position={l.pos!} intensity={l.intensity} color={l.color ?? "#fff2d6"} distance={10} />
        ))}

      <RoomMesh design={design} />
      {design.furniture.map((f) => (
        <FurnitureMesh key={f.id} item={f} selected={f.id === selectedId} onSelect={select} />
      ))}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.26} transparent />
      </mesh>

      <FitCamera bounds={bounds} fitKey={`${w}x${d}x${h}`} />
    </Canvas>
  );
}
