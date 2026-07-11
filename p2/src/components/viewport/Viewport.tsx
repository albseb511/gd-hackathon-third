"use client";

// Scene shell adapted from cake-studio/src/components/editor/Viewport.tsx @ 2026-07-11
// — owned by p2. Renders a RoomDesign with fitted orbit camera, soft lighting and
// shadows. preserveDrawingBuffer stays on: the NB2 reskin capture depends on it.

import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { useEffect, useRef, type ComponentRef } from "react";
import { PCFSoftShadowMap } from "three";
import type { RoomDesign } from "@/scene/types";
import { roomBounds } from "@/scene/defaults";
import { CAMERA_FOV_DEG, viewPose, type Bounds } from "./camera-rig";
import { RoomMesh } from "./RoomMesh";

function FitCamera({ bounds }: { bounds: Bounds }) {
  const controls = useRef<ComponentRef<typeof CameraControls>>(null);
  const { size } = useThree();
  useEffect(() => {
    const aspect = size.height ? size.width / size.height : 1.6;
    const pose = viewPose("main", bounds, aspect);
    controls.current?.setLookAt(
      pose.position[0], pose.position[1], pose.position[2],
      pose.target[0], pose.target[1], pose.target[2],
      false,
    );
  }, [bounds, size.width, size.height]);
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.6}
      maxDistance={60}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  );
}

export default function Viewport({ design }: { design: RoomDesign }) {
  const bounds = roomBounds(design);
  return (
    <Canvas
      shadows={{ type: PCFSoftShadowMap }}
      camera={{ fov: CAMERA_FOV_DEG, position: [8, 6, 9], near: 0.1, far: 200 }}
      gl={{ preserveDrawingBuffer: true, toneMappingExposure: 1.05 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#0e0f12"]} />
      <hemisphereLight args={["#ffffff", "#3a3a44", 0.6]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[6, 9, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-12, 12, 12, -12, 0.1, 40]} />
      </directionalLight>
      <directionalLight position={[-5, 4, -3]} intensity={0.3} />

      <RoomMesh design={design} />

      {/* Ground shadow catcher just below the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.28} transparent />
      </mesh>

      <FitCamera bounds={bounds} />
    </Canvas>
  );
}
