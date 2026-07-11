import { NextRequest, NextResponse } from "next/server";
import { estimateCost } from "@/lib/cost";
import { emptyRoom } from "@/scene/defaults";
import type { RoomDesign } from "@/scene/types";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    design?: RoomDesign;
    region?: string;
    currency?: string;
    overrides?: Record<string, number>;
  };
  const est = estimateCost(body.design ?? emptyRoom(), {
    region: body.region,
    currency: body.currency,
    overrides: body.overrides,
    fetchedAt: new Date().toISOString().slice(0, 10),
  });
  return NextResponse.json(est);
}
