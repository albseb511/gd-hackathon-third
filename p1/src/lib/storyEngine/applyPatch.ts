import { PlayState, Relationship } from "./types";

// Shape the narrator sends in update_state's `patch` (as a JSON string).
export interface NarratorPatch {
  flags?: Record<string, boolean | string | number>;
  hp?: number;
  inventoryAdd?: ({ name: string; note?: string } | string)[];
  inventoryRemove?: string[];
  relationships?: Record<string, Partial<Relationship>>;
  auraTraitsAdd?: string[];
  reputation?: string;
}

export function applyNarratorPatch(
  state: PlayState,
  patch: NarratorPatch,
  beatId?: string,
): PlayState {
  const next: PlayState = structuredClone(state);
  if (beatId && beatId !== next.beatId) {
    next.beatId = beatId;
    if (next.path[next.path.length - 1] !== beatId) next.path.push(beatId);
  }
  if (patch.flags) Object.assign(next.flags, patch.flags);
  if (typeof patch.hp === "number") {
    next.hp = Math.max(0, Math.min(10, patch.hp));
  }
  for (const item of patch.inventoryAdd ?? []) {
    const entry = typeof item === "string" ? { name: item } : item;
    if (!next.inventory.some((i) => i.name === entry.name)) {
      next.inventory.push(entry);
    }
  }
  if (patch.inventoryRemove) {
    next.inventory = next.inventory.filter(
      (i) => !patch.inventoryRemove!.includes(i.name),
    );
  }
  for (const [npc, rel] of Object.entries(patch.relationships ?? {})) {
    const prev: Relationship =
      next.relationships[npc] ?? { score: 0, feeling: "neutral", lastCause: "" };
    next.relationships[npc] = {
      score: Math.max(-5, Math.min(5, rel.score ?? prev.score)),
      feeling: rel.feeling ?? prev.feeling,
      lastCause: rel.lastCause ?? prev.lastCause,
    };
  }
  for (const trait of patch.auraTraitsAdd ?? []) {
    if (!next.aura.traits.includes(trait)) next.aura.traits.push(trait);
  }
  if (patch.reputation) next.aura.reputation = patch.reputation;
  return next;
}

export function parseNarratorPatch(raw: unknown): NarratorPatch {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as NarratorPatch;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as NarratorPatch;
  return {};
}
