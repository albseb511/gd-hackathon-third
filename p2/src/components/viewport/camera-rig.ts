// adapted from cake-studio/src/components/editor/camera-rig.ts @ 2026-07-11 — owned by p2.
// Pure camera maths: presets are DIRECTIONS, not positions. Every pose targets
// the scene's bbox centre and dollies to the distance where the whole bounding
// sphere fits the frustum, so any room size fills the frame.

export const CAMERA_FOV_DEG = 45;

// Breathing room around the fitted sphere (1 = touching the frustum).
const FIT_MARGIN = 1.08;

export interface Bounds {
  centre: [number, number, number];
  sphereRadiusM: number;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

type Vec3 = readonly [number, number, number];

const VIEW_DIRECTIONS = {
  main: [0.75, 0.55, 0.9], // three-quarter hero
  top: [0, 1, 0.0005],
  front: [0, 0.15, 1],
  left: [-1, 0.15, 0],
  right: [1, 0.15, 0],
} as const satisfies Record<string, Vec3>;

export type ViewId = keyof typeof VIEW_DIRECTIONS;
export const VIEW_IDS = Object.keys(VIEW_DIRECTIONS) as ViewId[];

// Standard sphere-fit: d = r / sin(halfAngle), tighter of vertical/horizontal fov.
export function fitDistanceM(
  sphereRadiusM: number,
  fovDeg: number,
  aspect: number,
  margin = FIT_MARGIN,
): number {
  const halfV = ((fovDeg / 2) * Math.PI) / 180;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  return (sphereRadiusM * margin) / Math.sin(Math.min(halfV, halfH));
}

function poseAlong(dir: Vec3, bounds: Bounds, aspect: number, margin?: number): CameraPose {
  const d = fitDistanceM(bounds.sphereRadiusM, CAMERA_FOV_DEG, aspect, margin);
  const l = Math.hypot(...dir) || 1;
  const [cx, cy, cz] = bounds.centre;
  return {
    position: [cx + (dir[0] / l) * d, cy + (dir[1] / l) * d, cz + (dir[2] / l) * d],
    target: [cx, cy, cz],
  };
}

export function viewPose(view: ViewId, bounds: Bounds, aspect: number, margin?: number): CameraPose {
  return poseAlong(VIEW_DIRECTIONS[view], bounds, aspect, margin);
}

// Re-fit without changing the user's orbit direction (used when bounds change).
export function refitPose(
  currentPosition: Vec3,
  currentTarget: Vec3,
  bounds: Bounds,
  aspect: number,
): CameraPose {
  const dir: Vec3 = [
    currentPosition[0] - currentTarget[0],
    currentPosition[1] - currentTarget[1],
    currentPosition[2] - currentTarget[2],
  ];
  const usable = Math.hypot(...dir) > 1e-6 ? dir : VIEW_DIRECTIONS.main;
  return poseAlong(usable, bounds, aspect);
}
