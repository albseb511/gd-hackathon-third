// vendored from p1/src/db/index.ts @ 2026-07-11 — owned by p2, do not re-sync.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __db: ReturnType<typeof makeDb> | undefined;
}

function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const client = postgres(url, { max: 8, prepare: false });
  return drizzle(client, { schema });
}

// Nullable on purpose: the app must run (voice + renders) even before
// Postgres is wired up locally; persistence callers null-check.
export const db = (globalThis.__db ??= makeDb());

export function requireDb() {
  if (!db) throw new Error("DATABASE_URL not configured");
  return db;
}
