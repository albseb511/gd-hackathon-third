// Client-safe generative-UI contract: zod schemas shared by the UI-Smith
// (server) and <UIRenderer/> (client). No server imports allowed here.

import { z } from "zod";

// ---- zod: the client-side contract ------------------------------------------

// Gemini structured output emits `null` for absent optional fields; normalize.
const optionalString = z
  .string()
  .nullish()
  .transform((v) => (v ? v : undefined));

const statBlockZ = z.object({
  kind: z.literal("stat_block"),
  title: z.string().min(1),
  stats: z
    .array(z.object({ label: z.string().min(1), value: z.number().min(0).max(5) }))
    .min(1),
  traits: z.array(z.string().min(1)),
  reputation: optionalString,
});

const inventoryGridZ = z.object({
  kind: z.literal("inventory_grid"),
  title: z.string().min(1),
  items: z.array(
    z.object({
      name: z.string().min(1),
      note: optionalString,
      iconHint: z.string().min(1),
    }),
  ),
});

const dialogueCardZ = z.object({
  kind: z.literal("dialogue_card"),
  speaker: z.string().min(1),
  portraitHint: optionalString,
  lines: z.array(z.string().min(1)).min(1),
});

const journalZ = z.object({
  kind: z.literal("journal"),
  title: z.string().min(1),
  entries: z
    .array(z.object({ heading: z.string().min(1), body: z.string().min(1) }))
    .min(1),
});

const mapZ = z.object({
  kind: z.literal("map"),
  title: z.string().min(1),
  places: z
    .array(
      z.object({
        name: z.string().min(1),
        note: optionalString,
        visited: z.boolean(),
        current: z.boolean(),
      }),
    )
    .min(1),
});

const shopZ = z.object({
  kind: z.literal("shop"),
  title: z.string().min(1),
  currency: z.string().min(1),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        price: z.number(),
        note: optionalString,
      }),
    )
    .min(1),
});

export const uiSpecSchema = z.discriminatedUnion("kind", [
  statBlockZ,
  inventoryGridZ,
  dialogueCardZ,
  journalZ,
  mapZ,
  shopZ,
]);

export type UiSpec = z.infer<typeof uiSpecSchema>;
export type UiSpecKind = UiSpec["kind"];

export const UI_SPEC_KINDS: UiSpecKind[] = [
  "stat_block",
  "inventory_grid",
  "dialogue_card",
  "journal",
  "map",
  "shop",
];
