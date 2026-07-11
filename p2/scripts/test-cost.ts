// Asserts the cost estimator: quantities from geometry, sourced figures, user
// override, region labour swap. Run: npm run test:cost
import { estimateCost } from "@/lib/cost";
import { emptyRoom } from "@/scene/defaults";

function close(a: number, b: number, tol = 0.01) {
  return Math.abs(a - b) <= Math.abs(b) * tol + 1e-6;
}

function main() {
  const design = emptyRoom(4, 5, 2.7);
  const est = estimateCost(design);

  // Floor qty == floor area (4×5 = 20 m²).
  const floor = est.materials.find((m) => m.id === "mat_floor")!;
  if (!close(floor.qty, 20)) throw new Error(`floor qty ${floor.qty} != 20`);

  // Paint qty == wall area − openings.
  const expectedPaint = 2 * (4 + 5) * 2.7 - (1.4 * 1.2 + 0.9 * 2.1);
  const paint = est.materials.find((m) => m.id === "mat_paint")!;
  if (!close(paint.qty, expectedPaint)) throw new Error(`paint qty ${paint.qty} != ${expectedPaint.toFixed(2)}`);

  // Every material & labour line has a resolvable sourceId.
  const sourceIds = new Set(est.sources.map((s) => s.id));
  for (const line of [...est.materials, ...est.labour]) {
    if (!sourceIds.has(line.sourceId)) throw new Error(`line ${line.id} has unresolvable source ${line.sourceId}`);
  }

  // User override replaces a unit price, re-totals, marks source 'user'.
  const est2 = estimateCost(design, { overrides: { mat_paint: 99 } });
  const paint2 = est2.materials.find((m) => m.id === "mat_paint")!;
  if (paint2.unitPrice !== 99 || paint2.source !== "user") throw new Error("override not applied/marked");
  if (!close(paint2.subtotal, paint2.qty * 99)) throw new Error("override subtotal wrong");

  // Region change swaps labour rates.
  const estIN = estimateCost(design, { region: "Bangalore, IN" });
  const rateUS = est.labour.find((l) => l.id === "lab_paint")!.rate;
  const rateIN = estIN.labour.find((l) => l.id === "lab_paint")!.rate;
  if (rateIN === rateUS) throw new Error("region did not change labour rate");
  if (estIN.currency !== "INR") throw new Error("region did not switch currency");

  console.log(
    `OK cost: floor ${floor.qty}m², paint ${paint.qty.toFixed(2)}m², total ${est.total} ${est.currency}, ${est.timeEstimateDays}d; override + region verified.`,
  );
}

main();
