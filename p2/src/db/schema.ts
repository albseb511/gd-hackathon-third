// p2 Atelier schema. Extends p1's telemetry/assets pattern for the interior-design domain.
import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  customType,
} from "drizzle-orm/pg-core";

// Postgres BYTEA for stored image/asset bytes.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// Uniform latency telemetry around every model call.
export const telemetry = pgTable("telemetry", {
  id: serial("id").primaryKey(),
  step: text("step").notNull(),
  ms: integer("ms").notNull(),
  model: text("model"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// The RoomDesign scene-graph (single source of truth), persisted as JSON.
export const designs = pgTable("designs", {
  id: text("id").primaryKey(),
  name: text("name"),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Generated assets: NB2 renders, textures, glTF, photos, videos.
export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  designId: text("design_id"),
  kind: text("kind").notNull(), // render | texture | mesh | photo | video
  mime: text("mime").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
