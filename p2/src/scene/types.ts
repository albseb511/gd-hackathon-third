// RoomDesign — the single source of truth for a scene. Agents read/write this
// via JSON patches; the store applies them; the R3F viewport renders it.
// Units: meters, Y-up, right-handed. Angles in radians. Floor plane at y=0.

export type Vec2 = [number, number]; // [x, z] on the floor plane
export type Vec3 = [number, number, number];

export interface MaterialRef {
  materialId: string;
}

export interface Wall {
  id: string;
  from: Vec2;
  to: Vec2;
  height: number;
  thickness: number;
  material?: string; // MaterialDef id
}

export interface Opening {
  id: string;
  type: "door" | "window";
  wallId: string;
  offset: number; // meters along the wall, measured from `from`
  size: Vec2; // [width, height]
  sill?: number; // window sill height above floor
}

export interface Furniture {
  id: string;
  catalogId?: string;
  customMeshId?: string;
  pos: Vec3;
  rot: Vec3; // radians
  scale: Vec3;
  material?: string;
}

export interface MaterialDef {
  id: string;
  color?: string;
  roughness?: number;
  metalness?: number;
  nb2TextureAssetId?: string;
}

export interface Light {
  id: string;
  type: "ambient" | "directional" | "point";
  pos?: Vec3;
  intensity: number;
  color?: string;
}

export interface CameraShot {
  id: string;
  name: string;
  pose: { position: Vec3; target: Vec3; fov: number };
}

export interface RoomDesign {
  room: {
    dims: { w: number; d: number; h: number };
    floor: MaterialRef;
    ceiling: MaterialRef;
  };
  walls: Wall[];
  openings: Opening[];
  furniture: Furniture[];
  materials: MaterialDef[];
  lights: Light[];
  cameras: CameraShot[];
  style: { philosophy: string; palette: string[]; mood: string };
}
