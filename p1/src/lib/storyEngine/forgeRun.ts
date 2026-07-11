// World Forge runner — the detached pipeline that turns a fresh character
// into a full pre-painted asset library: every beat scene, locations, props,
// protagonist poses, title/ending cards, and NPC portraits, all through a
// concurrency-10 Nano Banana 2 Lite pool, persisted to the assets table and
// indexed in state.assetLibrary. Fire-and-forget from the API; poll status.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, playthroughs } from "@/db/schema";
import { generateImage } from "@/lib/artist";
import { pool } from "@/lib/pool";
import { loadPlaythroughContext } from "./loadContext";
import {
  generateAssetManifest,
  type AssetManifest,
  type Job,
} from "./assetManifest";
import type { PlayState } from "./types";

export interface ForgeStatusItem {
  kind: string;
  key: string;
  label: string;
  assetId: string | null;
  ms: number;
  ok: boolean;
}

export interface ForgeStatus {
  running: boolean;
  total: number;
  done: number;
  startedAt: number;
  wallMs?: number;
  items: ForgeStatusItem[];
}

// Survives Next dev HMR module reloads (same trick as the genai singleton).
declare global {
  var __forgeStatus: Map<string, ForgeStatus> | undefined;
}
const statusMap = (globalThis.__forgeStatus ??= new Map<string, ForgeStatus>());

const CONCURRENCY = 10;
const IMAGE_TIMEOUT_MS = 25_000;

const hasLibrary = (state: PlayState): boolean =>
  !!state.assetLibrary &&
  Object.values(state.assetLibrary).some(
    (group) => Object.keys(group ?? {}).length > 0,
  );

export function getForgeStatus(playthroughId: string): ForgeStatus | null {
  return statusMap.get(playthroughId) ?? null;
}

export function startForge(
  playthroughId: string,
  aspect: "16:9" | "9:16",
): { alreadyRunning: boolean } {
  const existing = statusMap.get(playthroughId);
  if (existing?.running) return { alreadyRunning: true };
  // completed in this process — a re-forge is never wanted
  if (existing && !existing.running && existing.done > 0) {
    return { alreadyRunning: true };
  }

  const status: ForgeStatus = {
    running: true,
    total: 0,
    done: 0,
    startedAt: Date.now(),
    items: [],
  };
  statusMap.set(playthroughId, status);

  runForge(playthroughId, aspect, status).catch((err) => {
    console.error(`[forge] ${playthroughId} crashed:`, err);
    status.running = false;
    status.wallMs = Date.now() - status.startedAt;
  });

  return { alreadyRunning: false };
}

interface JobResult extends ForgeStatusItem {
  group: keyof AssetManifest;
}

async function runForge(
  playthroughId: string,
  aspect: "16:9" | "9:16",
  status: ForgeStatus,
): Promise<void> {
  const ctx = await loadPlaythroughContext(playthroughId);
  if (!ctx || !ctx.persisted || !db) {
    statusMap.delete(playthroughId);
    return;
  }
  if (hasLibrary(ctx.state)) {
    // already forged (e.g. process restarted and someone re-posted) — no-op
    status.running = false;
    status.wallMs = 0;
    return;
  }

  const character = ctx.charactersSheets[0];
  const manifest = await generateAssetManifest(ctx.outline, character, aspect);

  // load the player portrait bytes ONCE; every withProtagonist job reuses them
  let portraitRef: { data: Buffer; mime: string }[] = [];
  const portraitId = (
    ctx.charactersSheets as { portraitAssetId?: string | null }[]
  )
    .map((c) => c.portraitAssetId)
    .find((x): x is string => Boolean(x));
  if (portraitId) {
    const [row] = await db
      .select({ mime: assets.mime, bytes: assets.bytes })
      .from(assets)
      .where(eq(assets.id, portraitId));
    if (row) portraitRef = [{ data: row.bytes, mime: row.mime }];
  }

  const groups = Object.keys(manifest) as (keyof AssetManifest)[];
  const flat: { group: keyof AssetManifest; job: Job }[] = groups.flatMap(
    (group) => manifest[group].map((job) => ({ group, job })),
  );
  status.total = flat.length;

  const paint = (job: Job) =>
    generateImage({
      prompt: job.prompt,
      artStyle: ctx.outline.artStyle,
      referenceImages: job.withProtagonist ? portraitRef : [],
      aspectRatio: job.aspect,
      timeoutMs: IMAGE_TIMEOUT_MS,
    });

  const jobs = flat.map(({ group, job }) => async (): Promise<JobResult> => {
    const t0 = Date.now();
    try {
      // one retry on failure (generateImage itself already retries ref-free)
      const img = await paint(job).catch(() => paint(job));
      const [inserted] = await db!
        .insert(assets)
        .values({
          kind: job.kind,
          playthroughId,
          mime: img.mime,
          bytes: img.data,
        })
        .returning({ id: assets.id });
      return {
        group,
        kind: job.kind,
        key: job.key,
        label: job.label,
        assetId: inserted.id,
        ms: Date.now() - t0,
        ok: true,
      };
    } catch {
      return {
        group,
        kind: job.kind,
        key: job.key,
        label: job.label,
        assetId: null,
        ms: Date.now() - t0,
        ok: false,
      };
    }
  });

  const results = await pool(jobs, CONCURRENCY, (result) => {
    status.done++;
    if (result) {
      const { group, ...item } = result;
      void group; // stripped from the public status payload
      status.items.push(item);
    }
  });

  // index every successful asset by group + key
  const library: NonNullable<PlayState["assetLibrary"]> = {
    scenes: {},
    locations: {},
    props: {},
    poses: {},
    cards: {},
    npcs: {},
  };
  for (const r of results) {
    if (r?.ok && r.assetId) library[r.group][r.key] = r.assetId;
  }

  const state: PlayState = {
    ...ctx.state,
    assetLibrary: library,
    // compatibility: existing stage/beat code reads these two maps directly
    sceneCache: library.scenes,
    npcPortraits: library.npcs,
  };
  await db
    .update(playthroughs)
    .set({ state })
    .where(eq(playthroughs.id, playthroughId));

  status.running = false;
  status.wallMs = Date.now() - status.startedAt;
  const okCount = results.filter((r) => r?.ok).length;
  console.log(
    `[forge] ${playthroughId} complete: ${okCount}/${status.total} assets in ${status.wallMs}ms` +
      (okCount < status.total
        ? ` (failed: ${results
            .filter((r) => r && !r.ok)
            .map((r) => `${r!.group}/${r!.key}`)
            .join(", ")})`
        : ""),
  );
}
