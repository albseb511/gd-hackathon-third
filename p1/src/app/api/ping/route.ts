import { NextResponse } from "next/server";

// Featherweight endpoint for the client's network-latency indicator.
export async function GET() {
  return new NextResponse("ok", {
    headers: { "cache-control": "no-store" },
  });
}
