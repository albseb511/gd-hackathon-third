// Cost estimator. Derives material quantities from the scene GEOMETRY, prices
// them from a seeded table (a real build would augment via web search + cite),
// adds region-based labour and a time estimate. Every figure carries a sourceId.
import type { RoomDesign } from "@/scene/types";
import { catalogEntry } from "@/scene/catalog";

export interface CostLine {
  id: string;
  item: string;
  qty: number;
  unit: string;
  unitPrice: number;
  subtotal: number;
  sourceId: string;
  source: "seed" | "user" | "web";
}
export interface LabourLine {
  id: string;
  trade: string;
  hours: number;
  rate: number;
  subtotal: number;
  sourceId: string;
  source: "seed" | "user" | "web";
}
export interface Source {
  id: string;
  url: string;
  fetchedAt: string;
  note?: string;
}
export interface CostEstimate {
  currency: string;
  region: string;
  materials: CostLine[];
  labour: LabourLine[];
  timeEstimateDays: number;
  subtotals: { materials: number; labour: number };
  contingencyPct: number;
  total: number;
  sources: Source[];
}

// Seed unit prices (USD baseline). sourceId → sources[].
const SEED = {
  paint: { item: "Interior emulsion paint", unit: "m2", price: 3.5, sourceId: "seed_paint" },
  flooring: { item: "Engineered wood flooring", unit: "m2", price: 42, sourceId: "seed_floor" },
  ceiling: { item: "Ceiling paint", unit: "m2", price: 3, sourceId: "seed_ceiling" },
};

const FURNITURE_PRICE: Record<string, number> = {
  sofa_3seat: 950, loveseat: 700, armchair: 450, coffee_table: 220, side_table: 120,
  dining_table: 640, dining_chair: 110, bed_double: 900, nightstand: 140, bookshelf: 260,
  tv_unit: 300, rug: 180, floor_lamp: 130, plant: 45, desk: 280,
};

const LABOUR = {
  painting: { trade: "Painting", rate: 28, m2PerHour: 10, sourceId: "seed_labour_paint" },
  flooring: { trade: "Flooring install", rate: 34, m2PerHour: 6, sourceId: "seed_labour_floor" },
  assembly: { trade: "Furniture assembly", rate: 25, hoursPerItem: 0.5, sourceId: "seed_labour_assembly" },
};

// Region cost-of-labour multipliers (rough) + currency.
const REGIONS: Record<string, { mult: number; currency: string }> = {
  Generic: { mult: 1, currency: "USD" },
  "San Francisco, US": { mult: 1.8, currency: "USD" },
  "London, UK": { mult: 1.4, currency: "GBP" },
  "Bangalore, IN": { mult: 0.35, currency: "INR" },
  "Berlin, DE": { mult: 1.2, currency: "EUR" },
};
const INR_PER_USD = 83; // only applied when region currency is INR, for readability

export interface EstimateOpts {
  region?: string;
  currency?: string;
  contingencyPct?: number;
  // Per-line unit-price overrides (user-fed), keyed by line id.
  overrides?: Record<string, number>;
  fetchedAt?: string; // pass a timestamp in (avoids Date in shared code paths)
}

function wallAreaMinusOpenings(design: RoomDesign): number {
  const wall = design.walls.reduce((a, w) => {
    const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
    return a + len * w.height;
  }, 0);
  const openings = design.openings.reduce((a, o) => a + o.size[0] * o.size[1], 0);
  return Math.max(0, wall - openings);
}

export function estimateCost(design: RoomDesign, opts: EstimateOpts = {}): CostEstimate {
  const regionName = opts.region ?? "Generic";
  const region = REGIONS[regionName] ?? REGIONS.Generic;
  const currency = opts.currency ?? region.currency;
  const fx = currency === "INR" ? INR_PER_USD : 1;
  const overrides = opts.overrides ?? {};
  const fetchedAt = opts.fetchedAt ?? "seed";

  const { w, d } = design.room.dims;
  const paintArea = wallAreaMinusOpenings(design);
  const floorArea = w * d;
  const ceilingArea = w * d;

  const price = (base: number) => Math.round(base * fx * 100) / 100;

  const mkMat = (
    id: string,
    item: string,
    qty: number,
    unit: string,
    seedPrice: number,
    sourceId: string,
  ): CostLine => {
    const overridden = overrides[id] != null;
    const unitPrice = overridden ? overrides[id] : price(seedPrice);
    return {
      id, item, qty: Math.round(qty * 100) / 100, unit, unitPrice,
      subtotal: Math.round(qty * unitPrice * 100) / 100,
      sourceId: overridden ? "user" : sourceId,
      source: overridden ? "user" : "seed",
    };
  };

  const materials: CostLine[] = [
    mkMat("mat_paint", SEED.paint.item, paintArea, SEED.paint.unit, SEED.paint.price, SEED.paint.sourceId),
    mkMat("mat_floor", SEED.flooring.item, floorArea, SEED.flooring.unit, SEED.flooring.price, SEED.flooring.sourceId),
    mkMat("mat_ceiling", SEED.ceiling.item, ceilingArea, SEED.ceiling.unit, SEED.ceiling.price, SEED.ceiling.sourceId),
  ];

  // Furniture aggregated by catalogId.
  const counts = new Map<string, number>();
  for (const f of design.furniture) {
    if (f.catalogId) counts.set(f.catalogId, (counts.get(f.catalogId) ?? 0) + 1);
  }
  for (const [catId, qty] of counts) {
    const e = catalogEntry(catId);
    const id = `mat_furn_${catId}`;
    const overridden = overrides[id] != null;
    const unitPrice = overridden ? overrides[id] : price(FURNITURE_PRICE[catId] ?? 150);
    materials.push({
      id, item: e?.label ?? catId, qty, unit: "unit", unitPrice,
      subtotal: Math.round(qty * unitPrice * 100) / 100,
      sourceId: overridden ? "user" : "seed_furniture",
      source: overridden ? "user" : "seed",
    });
  }

  // Labour, region-scaled.
  const mkLab = (
    id: string,
    trade: string,
    hours: number,
    seedRate: number,
    sourceId: string,
  ): LabourLine => {
    const overridden = overrides[id] != null;
    const rate = overridden ? overrides[id] : price(seedRate * region.mult);
    const h = Math.round(hours * 10) / 10;
    return {
      id, trade, hours: h, rate, subtotal: Math.round(h * rate * 100) / 100,
      sourceId: overridden ? "user" : sourceId, source: overridden ? "user" : "seed",
    };
  };
  const paintHours = paintArea / LABOUR.painting.m2PerHour;
  const floorHours = floorArea / LABOUR.flooring.m2PerHour;
  const assemblyHours = design.furniture.length * LABOUR.assembly.hoursPerItem;
  const labour: LabourLine[] = [
    mkLab("lab_paint", LABOUR.painting.trade, paintHours, LABOUR.painting.rate, LABOUR.painting.sourceId),
    mkLab("lab_floor", LABOUR.flooring.trade, floorHours, LABOUR.flooring.rate, LABOUR.flooring.sourceId),
    mkLab("lab_assembly", LABOUR.assembly.trade, assemblyHours, LABOUR.assembly.rate, LABOUR.assembly.sourceId),
  ];

  const matSub = materials.reduce((a, l) => a + l.subtotal, 0);
  const labSub = labour.reduce((a, l) => a + l.subtotal, 0);
  const contingencyPct = opts.contingencyPct ?? 10;
  const total = Math.round((matSub + labSub) * (1 + contingencyPct / 100) * 100) / 100;

  const totalHours = paintHours + floorHours + assemblyHours;
  const timeEstimateDays = Math.max(1, Math.ceil(totalHours / 7));

  const sources: Source[] = [
    { id: "seed_paint", url: "seed://materials/paint", fetchedAt, note: "seed price" },
    { id: "seed_floor", url: "seed://materials/flooring", fetchedAt, note: "seed price" },
    { id: "seed_ceiling", url: "seed://materials/ceiling", fetchedAt, note: "seed price" },
    { id: "seed_furniture", url: "seed://catalog/furniture", fetchedAt, note: "seed price" },
    { id: "seed_labour_paint", url: "seed://labour/painting", fetchedAt, note: `region ×${region.mult}` },
    { id: "seed_labour_floor", url: "seed://labour/flooring", fetchedAt, note: `region ×${region.mult}` },
    { id: "seed_labour_assembly", url: "seed://labour/assembly", fetchedAt, note: `region ×${region.mult}` },
    { id: "user", url: "user://provided", fetchedAt, note: "user-supplied override" },
  ];

  return {
    currency, region: regionName, materials, labour, timeEstimateDays,
    subtotals: { materials: Math.round(matSub * 100) / 100, labour: Math.round(labSub * 100) / 100 },
    contingencyPct, total, sources,
  };
}

export const REGION_NAMES = Object.keys(REGIONS);
