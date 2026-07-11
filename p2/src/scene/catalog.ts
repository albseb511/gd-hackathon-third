// Procedural furniture catalog. Offline & self-contained: each entry is rendered
// from parametric primitives (see FurnitureMesh), so no glTF assets are bundled.
// footprint = [width(x), depth(z)] in meters; height in meters; color default.

export interface CatalogEntry {
  id: string;
  label: string;
  footprint: [number, number];
  height: number;
  color: string;
  category: "seating" | "table" | "bed" | "storage" | "lighting" | "decor";
}

export const CATALOG: CatalogEntry[] = [
  { id: "sofa_3seat", label: "3-seat sofa", footprint: [2.1, 0.9], height: 0.8, color: "#8a8f98", category: "seating" },
  { id: "loveseat", label: "Loveseat", footprint: [1.5, 0.9], height: 0.8, color: "#9aa0a8", category: "seating" },
  { id: "armchair", label: "Armchair", footprint: [0.8, 0.85], height: 0.8, color: "#b0785a", category: "seating" },
  { id: "coffee_table", label: "Coffee table", footprint: [1.1, 0.6], height: 0.42, color: "#6b4f3a", category: "table" },
  { id: "side_table", label: "Side table", footprint: [0.45, 0.45], height: 0.5, color: "#6b4f3a", category: "table" },
  { id: "dining_table", label: "Dining table", footprint: [1.6, 0.9], height: 0.75, color: "#5c4433", category: "table" },
  { id: "dining_chair", label: "Dining chair", footprint: [0.45, 0.5], height: 0.9, color: "#7a6a56", category: "seating" },
  { id: "bed_double", label: "Double bed", footprint: [1.6, 2.0], height: 0.6, color: "#c9c2b6", category: "bed" },
  { id: "nightstand", label: "Nightstand", footprint: [0.45, 0.4], height: 0.55, color: "#6b4f3a", category: "storage" },
  { id: "bookshelf", label: "Bookshelf", footprint: [0.9, 0.35], height: 1.8, color: "#5c4433", category: "storage" },
  { id: "tv_unit", label: "TV unit", footprint: [1.6, 0.4], height: 0.5, color: "#3a3a40", category: "storage" },
  { id: "rug", label: "Rug", footprint: [2.0, 3.0], height: 0.02, color: "#a5563f", category: "decor" },
  { id: "floor_lamp", label: "Floor lamp", footprint: [0.35, 0.35], height: 1.6, color: "#d8cfa8", category: "lighting" },
  { id: "plant", label: "Potted plant", footprint: [0.5, 0.5], height: 1.2, color: "#3f7a4a", category: "decor" },
  { id: "desk", label: "Desk", footprint: [1.2, 0.6], height: 0.74, color: "#6b4f3a", category: "table" },
];

export const CATALOG_IDS = CATALOG.map((c) => c.id);

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.id === id);
}
