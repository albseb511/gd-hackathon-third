import type { RoomDesign } from "./types";
import type { Bounds } from "@/components/viewport/camera-rig";

// A default rectangular empty room, built from dimensions. Corners on the floor
// plane: (0,0) → (w,0) → (w,d) → (0,d). Walls wind clockwise so their front
// faces point inward (backfaces cull when orbiting from outside — open-dollhouse).
export function emptyRoom(w = 4, d = 5, h = 2.7): RoomDesign {
  return {
    room: {
      dims: { w, d, h },
      floor: { materialId: "floor_oak" },
      ceiling: { materialId: "ceiling_white" },
    },
    walls: [
      { id: "w_n", from: [0, 0], to: [w, 0], height: h, thickness: 0.1, material: "paint_wall" },
      { id: "w_e", from: [w, 0], to: [w, d], height: h, thickness: 0.1, material: "paint_wall" },
      { id: "w_s", from: [w, d], to: [0, d], height: h, thickness: 0.1, material: "paint_wall" },
      { id: "w_w", from: [0, d], to: [0, 0], height: h, thickness: 0.1, material: "paint_wall" },
    ],
    openings: [
      { id: "o_win", type: "window", wallId: "w_n", offset: w / 2 - 0.7, size: [1.4, 1.2], sill: 0.9 },
      { id: "o_door", type: "door", wallId: "w_w", offset: d / 2 - 0.45, size: [0.9, 2.1] },
    ],
    furniture: [],
    materials: [
      { id: "paint_wall", color: "#e8e4dc", roughness: 0.95 },
      { id: "floor_oak", color: "#b98a58", roughness: 0.7 },
      { id: "ceiling_white", color: "#f5f5f2", roughness: 1 },
    ],
    lights: [],
    cameras: [],
    style: {
      philosophy: "scandinavian",
      palette: ["#e8e4dc", "#b98a58", "#7a8b7a"],
      mood: "cozy",
    },
  };
}

// Bounding sphere of the room, for camera fitting.
export function roomBounds(design: RoomDesign): Bounds {
  const { w, d, h } = design.room.dims;
  return {
    centre: [w / 2, h / 2, d / 2],
    sphereRadiusM: 0.5 * Math.hypot(w, h, d),
  };
}
