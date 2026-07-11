// POST: start a playthrough (prebuilt story or custom premise).
// GET:  list a device's playthroughs for the resume screen.
// Both degrade gracefully when db is null (local dev without Postgres):
// prebuilt stories become pseudo playthroughs with ids like `local-noir`.

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  participants,
  players,
  playthroughs,
  scenes,
  stories,
} from "@/db/schema";
import { prebuiltById, type PrebuiltStoryId } from "@/lib/prebuilt";
import { generateOutline } from "@/lib/storyEngine/outline";
import { initialPlayState, type StoryOutline } from "@/lib/storyEngine/types";
import { getOrCreatePlayer } from "@/lib/player";

const PREBUILT_IDS: PrebuiltStoryId[] = ["noir", "fantasy", "starship"];

interface PostBody {
  storyId?: PrebuiltStoryId;
  premise?: string;
  deviceKey?: string;
  playerName?: string;
}

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { storyId, playerName } = body;
  const deviceKey = body.deviceKey?.trim();
  const premise = body.premise?.trim();

  if (!deviceKey) {
    return NextResponse.json({ error: "deviceKey is required" }, { status: 400 });
  }
  if (storyId && !PREBUILT_IDS.includes(storyId)) {
    return NextResponse.json({ error: `Unknown storyId: ${storyId}` }, { status: 400 });
  }

  // ---- No database: prebuilt stories play via pseudo ids, no persistence ----
  if (!db) {
    if (!storyId && premise) {
      return NextResponse.json(
        {
          error:
            "Custom stories require a database. Set DATABASE_URL to create your own tale — the three prebuilt stories work without one.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ playthroughId: `local-${storyId ?? "noir"}` });
  }

  // ---- Database path ----
  const player = await getOrCreatePlayer(deviceKey, playerName);

  let storyRowId: string;
  let outline: StoryOutline;

  if (storyId) {
    outline = prebuiltById[storyId];
    const [existing] = await db
      .select({ id: stories.id })
      .from(stories)
      .where(and(eq(stories.isPrebuilt, true), eq(stories.title, outline.title)))
      .limit(1);
    if (existing) {
      storyRowId = existing.id;
    } else {
      const [inserted] = await db
        .insert(stories)
        .values({
          title: outline.title,
          outline,
          isPrebuilt: true,
          artStyle: outline.artStyle,
        })
        .returning({ id: stories.id });
      storyRowId = inserted.id;
    }
  } else if (premise) {
    outline = await generateOutline(premise);
    const [inserted] = await db
      .insert(stories)
      .values({
        title: outline.title,
        premise,
        outline,
        isPrebuilt: false,
        artStyle: outline.artStyle,
      })
      .returning({ id: stories.id });
    storyRowId = inserted.id;
  } else {
    return NextResponse.json(
      { error: "Provide a storyId or a premise" },
      { status: 400 },
    );
  }

  const firstBeatId = outline.acts[0].beats[0].id;
  const [playthrough] = await db
    .insert(playthroughs)
    .values({ storyId: storyRowId, state: initialPlayState(firstBeatId) })
    .returning({ id: playthroughs.id });

  await db.insert(participants).values({
    playthroughId: playthrough.id,
    playerId: player.id,
    role: "host",
    characterId: null,
  });

  return NextResponse.json({ playthroughId: playthrough.id, storyId: storyRowId });
}

export async function GET(req: Request) {
  const deviceKey = new URL(req.url).searchParams.get("deviceKey")?.trim();

  if (!db || !deviceKey) {
    return NextResponse.json({ playthroughs: [] });
  }

  const rows = await db
    .select({
      id: playthroughs.id,
      title: stories.title,
      status: playthroughs.status,
      updatedAt: playthroughs.updatedAt,
    })
    .from(playthroughs)
    .innerJoin(participants, eq(participants.playthroughId, playthroughs.id))
    .innerJoin(players, eq(players.id, participants.playerId))
    .innerJoin(stories, eq(stories.id, playthroughs.storyId))
    .where(eq(players.deviceKey, deviceKey))
    .orderBy(desc(playthroughs.updatedAt));

  // Dedupe (defensive: a player could appear twice in one playthrough).
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = [...byId.keys()];

  const sceneCounts = new Map<string, number>();
  const lastImage = new Map<string, string>();
  if (ids.length) {
    const sceneRows = await db
      .select({
        playthroughId: scenes.playthroughId,
        idx: scenes.idx,
        imageAssetId: scenes.imageAssetId,
      })
      .from(scenes)
      .where(inArray(scenes.playthroughId, ids))
      .orderBy(desc(scenes.idx));
    for (const s of sceneRows) {
      sceneCounts.set(s.playthroughId, (sceneCounts.get(s.playthroughId) ?? 0) + 1);
      // rows arrive idx-desc, so the first non-null image per playthrough wins
      if (s.imageAssetId && !lastImage.has(s.playthroughId)) {
        lastImage.set(s.playthroughId, s.imageAssetId);
      }
    }
  }

  return NextResponse.json({
    playthroughs: [...byId.values()].map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      updatedAt: r.updatedAt,
      sceneCount: sceneCounts.get(r.id) ?? 0,
      lastImageAssetId: lastImage.get(r.id) ?? null,
    })),
  });
}
