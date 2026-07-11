import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  customType,
  index,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  deviceKey: text("device_key").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const stories = pgTable("stories", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  premise: text("premise"),
  outline: jsonb("outline").notNull(),
  isPrebuilt: boolean("is_prebuilt").notNull().default(false),
  artStyle: text("art_style").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playthroughId: uuid("playthrough_id"),
    storyId: uuid("story_id"),
    // portrait | scene | photo | item | ui | music | sfx
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("assets_playthrough_idx").on(t.playthroughId)],
);

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id")
    .notNull()
    .references(() => players.id),
  name: text("name").notNull(),
  // { visualTokens, personalityHints, stats: { might, wit, charm } }
  sheet: jsonb("sheet").notNull(),
  portraitAssetId: uuid("portrait_asset_id").references(() => assets.id),
  sourcePhotoAssetId: uuid("source_photo_asset_id").references(() => assets.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const playthroughs = pgTable("playthroughs", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  // { beatId, path: string[], flags, hp, inventory, relationships, aura }
  state: jsonb("state").notNull().default({}),
  summary: text("summary"),
  sessionHandle: text("session_handle"),
  status: text("status").notNull().default("active"), // active | ended
  endingId: text("ending_id"),
  joinCode: text("join_code"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// multiplayer-ready: 1 row per player in a playthrough
export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playthroughId: uuid("playthrough_id")
      .notNull()
      .references(() => playthroughs.id),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id),
    characterId: uuid("character_id").references(() => characters.id),
    role: text("role").notNull().default("host"), // host | guest
  },
  (t) => [index("participants_playthrough_idx").on(t.playthroughId)],
);

export const scenes = pgTable(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playthroughId: uuid("playthrough_id")
      .notNull()
      .references(() => playthroughs.id),
    idx: integer("idx").notNull(),
    beatId: text("beat_id"),
    narration: text("narration"),
    imageAssetId: uuid("image_asset_id").references(() => assets.id),
    imagePrompt: text("image_prompt"),
    choices: jsonb("choices"),
    chosen: text("chosen"),
    qteResult: jsonb("qte_result"),
    diceResult: jsonb("dice_result"),
    genUi: jsonb("gen_ui"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("scenes_playthrough_idx").on(t.playthroughId)],
);

export const simRuns = pgTable("sim_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  persona: text("persona").notNull(),
  path: jsonb("path").notNull(), // ordered beat ids
  choices: jsonb("choices").notNull(), // [{beatId, options, picked}]
  endingId: text("ending_id"),
  latencies: jsonb("latencies").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const telemetry = pgTable(
  "telemetry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    step: text("step").notNull(),
    ms: integer("ms").notNull(),
    model: text("model"),
    playthroughId: uuid("playthrough_id"),
    simRunId: uuid("sim_run_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("telemetry_step_idx").on(t.step)],
);
