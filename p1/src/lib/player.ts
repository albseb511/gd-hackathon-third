// Player identity: one row per device (upsert by deviceKey), plus the default
// character sheet used before a player builds their own.

import { requireDb } from "@/db";
import { players } from "@/db/schema";
import type { CharacterSheet } from "@/lib/storyEngine/types";

export const DEFAULT_CHARACTER: CharacterSheet = {
  name: "The Stranger",
  visualTokens:
    "a determined traveler in a long weathered coat, short dark hair, sharp eyes",
  personalityHints: "curious, guarded, dry wit",
  stats: { might: 3, wit: 3, charm: 3 },
};

export type PlayerRow = typeof players.$inferSelect;

/**
 * Find-or-create a player by deviceKey. Requires a database — callers on the
 * no-db path must not reach this. If `name` is provided it also updates the
 * stored name; otherwise the existing name is left untouched.
 */
export async function getOrCreatePlayer(
  deviceKey: string,
  name?: string,
): Promise<PlayerRow> {
  const db = requireDb();
  const trimmed = name?.trim();

  const [row] = await db
    .insert(players)
    .values({ deviceKey, name: trimmed || "The Stranger" })
    .onConflictDoUpdate({
      target: players.deviceKey,
      // No name given -> no-op update (deviceKey = deviceKey) so RETURNING
      // still yields the existing row without clobbering the stored name.
      set: trimmed ? { name: trimmed } : { deviceKey },
    })
    .returning();

  return row;
}
