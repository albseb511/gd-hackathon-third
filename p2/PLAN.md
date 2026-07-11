# Atelier — Agentic Voice-Driven 3D Interior Design Studio

> Build spec for an AI builder (e.g. Gemini). Read the **Isolation & Guardrails** and
> **Engineering rules** sections before writing any code — they are hard constraints.
> Scope: all work happens inside this `p2/` folder. `../p1` and `../../lme/cake-studio`
> are read-only code donors you copy from once, never depend on.

## Context

Goal: a web app where you **speak** to an AI, and it designs / renders / analyzes an
interior 3D space in real time — build a room shell, walls, materials, paint, paneling,
floor/ceiling, place furniture, make it photoreal, walk a camera through it, and get
consultant-grade design advice. Everything runs as **agent orchestration**. Must work on
phone + desktop, low-latency, parallelized, with generative spatial UI.

Google DeepMind hackathon build. Decision: **touch all 5 tracks**, with a coherent demo
spine (voice → design → photoreal → walkthrough).

### The unlock: we are NOT starting from zero

Two sibling projects on the **same stack** (Next.js 16.2.10 / React 19.2.4 / TS 5) provide
~70% of the plumbing. p2 is a *merge*, not a greenfield. **Copy their code in once** (see
guardrail #2); do not reference them at build/runtime.

**From `p1` (`../p1`) — the Gemini spine:**
- `src/lib/gemini.ts` — GenAI singleton + `withTiming()` telemetry wrapper.
- `src/lib/models.ts` — model-id registry.
- `src/app/api/live-token/route.ts` + `src/lib/storyEngine/liveConfig.ts` — **Live API**
  ephemeral-token minting (server-locked config, session resume, barge-in, tool decls).
- `src/components/audio/useLiveAudio.ts` + `public/worklets/pcm-processor.js` — mic 16kHz
  in / 24kHz out, jitter buffer, `flushPlayback()` barge-in.
- `src/lib/artist.ts` — **NB2 Lite** pipeline (`gemini-3.1-flash-lite-image`,
  image-to-image with reference/previous frames, 16:9 1K, retry-without-refs fallback).
- `src/app/api/scene-image/route.ts`, `src/lib/storyEngine/applyPatch.ts` (JSON-patch state
  mutation), Drizzle/Postgres schema + `assets`/`telemetry` tables, gen-UI renderer
  (`src/components/genui/UIRenderer.tsx`).

**From `cake-studio` (`../../lme/cake-studio`) — the 3D shell (three 0.185 / R3F 9 / drei 10):**
- `src/components/editor/Viewport.tsx` — `<Canvas preserveDrawingBuffer>`, HDRI
  `<Environment>`, key/fill directional + shadow-catcher, `EffectComposer` (N8AO/SMAA/
  ToneMapping-Neutral). Drop-in scene template.
- `src/components/editor/camera-rig.ts` — `fitDistanceM()`, `viewPose()`, `refitPose()`;
  smooth `CameraControls.setLookAt` flights + reduced-motion snap.
- GLB loading via drei `useGLTF` + preload (`decorations/catalog.tsx`); graceful
  suspense-free asset loading with ghost fallbacks (`src/lib/asset-decorations.ts`).
- Raycast select + **drag/place** (`Viewport.tsx` `toAnchor`, `dragHandlers`).
- **Canvas capture** — `Editor.tsx captureThumbnail()`, `capture-supersample.ts` (2× SSAA),
  `MarqueeOverlay.tsx captureViewportCrop()`. This is the exact NB2-reskin input.
- zustand store w/ undo/redo + view-vs-document state split (`src/document/store.ts`,
  `types.ts`); path-tracer "photo mode" (`PhotoModeRunner.tsx`) as optional premium render.

## Architecture

```
 VOICE (Gemini Live, PS1) ──► thin tools enqueue INTENTS
                                     │
                          ORCHESTRATOR (Gemini 3.5 Flash, PS2)
                          plan → delegate → merge → resolve
             ┌──────────┬──────────┬───────────┬──────────┬─────────────┐
        Architect   Materials   Stylist/    Furnishing   Render      Cinematographer
        (shell,     (paint,     Consultant  (catalog +   (NB2 reskin  (camera flights,
        openings,   paneling,   (philosophy, spatial      variants,   walkthrough webm,
        OpenSCAD    PBR/NB2     websearch)   placement)   PS3)         Omni video, PS4)
        custom)     textures)                             
             │          Estimator/Sourcing (real prices + labour + time, web-search + cited)
             └──────────┴──────────┴─── all read/write ──┴──────────┴─────────────┘
                          SHARED BLACKBOARD = RoomDesign JSON (zustand + Postgres)
                                     │
                          React Three Fiber viewport (live, mobile)
```

**Single source of truth = `RoomDesign` JSON scene-graph.** Every agent proposes
JSON-patch ops (reuse `applyPatch.ts`); the orchestrator merges + resolves conflicts;
the store applies them; the viewport re-renders. This shared, mutating blackboard is what
makes the multi-agent collaboration *genuine* (the PS2 bar) rather than a straight arrow.

### Scene DSL (`src/scene/types.ts` — new)
```ts
RoomDesign {
  room:     { dims:{w,d,h}, floor:MaterialRef, ceiling:MaterialRef }
  walls:    Wall[]        // {id, from:[x,z], to:[x,z], height, thickness, material}
  openings: Opening[]     // {id, type:'door'|'window', wallId, offset, size}
  furniture:Furniture[]   // {id, catalogId|customMeshId, pos, rot, scale, material}
  materials:MaterialDef[] // PBR params + optional nb2TextureAssetId
  lights:   Light[]
  cameras:  CameraShot[]  // {id, name, pose:{position,target,fov}}
  style:    { philosophy, palette[], mood }
}
```
Zustand store mirrors cake-studio's document/view split (undo/redo, dirty flag);
view-only flags = photoMode, walkthrough, selection.

### Scene-mutation tools (`src/scene/tools.ts` — new; shared by Live + agents)
`create_room · add_wall · add_opening · set_material · add_furniture · move_furniture ·
set_palette · add_light · set_camera · render_photoreal · analyze · generate_asset ·
import_from_photos · price_material · add_price_source · estimate_project_cost`. Each =
a Zod-typed function declaration → a store action + JSON patch. Live declares the *thin*
subset (enqueue intent, ack fast); the orchestrator owns the heavy ones.

### Cost, Sourcing & Estimation (new subsystem)
Grounds the whole design in **real-world prices, products, and labour** — and doubles as
NB2 grounding data so generated images reference real materials, not generic ones.

- **Global knowledge store** (Postgres): `material_catalog` (name, category, PBR/texture
  ref, unit, typical price range, real-life product reference + image), `price_refs`
  (material, region/currency, unit price, source URL, fetched-at), `sources` (cited URLs
  used by any agent). **Seeded in advance** with common materials/finishes/furniture so
  costing works instantly offline; **augmented on demand** via `WebSearch`/`WebFetch` for
  local pricing, always writing back the cited source. User can **feed/override** any price
  or reference by voice or upload (`add_price_source`, user-supplied always wins + is
  marked as such).
- **Real-life references feed image gen:** when NB2 renders a material/furniture, the
  matched `material_catalog` reference image + product name is passed as an additional
  guide → photoreal output matches actual purchasable products, and cost is traceable to
  what's shown.
- **Estimator (`estimate_project_cost`):** produces a **detailed, line-item** estimate —
  materials (qty × unit price from `price_refs`, area/volume derived from the scene
  geometry), labour (region-based hourly/day rates via web search, per trade: painting,
  flooring, carpentry, electrical), and a **time estimate** (task durations → schedule).
  Returns a structured breakdown with subtotals, contingency, currency, and every figure
  linked to its source. Region + currency are runtime inputs (voice or settings).

## Track coverage (all 5)

- **PS1 Live (spine):** voice is the primary UI — interrupt mid-design (barge-in already in
  `useLiveAudio`), continuous **live camera** of the user's real room feeding the vision
  agent, tone-aware responses. The consultant proactively flags things it *sees* in the
  feed the user didn't point out.
- **PS2 Orchestration:** orchestrator + 6 specialist agents, shared RoomDesign blackboard,
  parallel delegation, conflict resolution, a visible **agent task ledger** (Postgres
  `agent_tasks`) surfaced in the UI so judges see labor split live.
- **PS3 NB2 Lite:** load-bearing throughput — every material swap / camera angle fires
  **N parallel** viewport→NB2 reskins (<4s, ~$0.034/1k). "Show me 6 palettes" → instant grid.
- **PS4 Omni:** chain NB2 key-render → **Omni Flash** for conversational cinematic
  walkthrough video (element swaps, motion), the encouraged NB2→Omni pipeline.
- **Gemma (stretch):** on-device Gemma 4 (E2B/E4B via MediaPipe/WebGPU) = offline "quick
  consultant" — local intent parse + simple scene edits with a real sense→decide→act→check
  loop, defers to cloud agents when online.

### Generative UI (Vercel AI SDK UI)
Non-Live agent output (orchestrator plans, cost breakdowns, estimate schedules, sourcing
cards, palette grids) streams as **interactive generative UI** via the Vercel AI SDK
(`ai` + `@ai-sdk/react` `useChat`/`streamUI` + `@ai-sdk/google` for Gemini). The
orchestrator/agents call the same Zod tools; the AI SDK renders each tool result to a React
component (e.g. a `<CostEstimate>` card with editable line items, a `<SourceCard>` with the
cited link, a `<PaletteGrid>`). Everything is also voice-drivable — the Live session can
trigger the same tools, and results render both as spatial cards (drei `Html` in 3D) and as
AI-SDK panels in the 2D chrome. **Live stays on the raw `@google/genai` WebSocket** (audio +
barge-in); AI SDK UI handles the streamed textual/structured turns around it.

### Photorealism (chosen: NB2 image-to-image reskin)
Capture R3F viewport PNG (reuse `capture-supersample.ts`) → NB2 with the screenshot as
**structural guide** + style/palette prompt → photoreal 1K in <4s, exact layout preserved.
Fire parallel variants. Generalize `artist.ts` (rename intent: `render.ts`) to accept a
guide image + interior style presets.

### Photo → 3D (chosen: Gemini-vision layout estimation)
User uploads photos (or shares live camera). Gemini 3.5 Flash vision → structured JSON
(room dims estimate, wall layout, detected furniture + rough positions, materials) → map to
`RoomDesign` → editable 3D room.

### Hybrid R3F + OpenSCAD (chosen)
R3F is the live runtime. OpenSCAD-WASM used **only** for bespoke parametric parts the
catalog lacks (e.g. a custom-width shelf) → compile → glTF → drop into the scene as a
`customMeshId`. Architect agent owns this; keep behind a feature flag to de-risk the timebox.

## Build plan (milestones)

- **M0 — Merge scaffold.** New Next.js app in `p2/`. Copy p1's `lib/gemini.ts`, `models.ts`,
  `artist.ts`→`render.ts`, `live-token` route, `useLiveAudio` + worklet, Drizzle setup.
  Copy cake-studio's `Viewport`, `camera-rig`, capture utils, store scaffold, `useGLTF`
  loader. **Exit:** empty room renders in R3F; Live token mints; NB2 test script passes.
- **M1 — Scene DSL + voice edits.** `RoomDesign` types, store, mutation tools. Live tool-loop:
  "make a 4×5 m living room, warm oak floor, add a sofa" → walls/floor/catalog furniture
  appear. Catalog = curated CC0 glTF (Kenney/Poly-Haven), reuse cake-studio loader.
- **M2 — Orchestrator + agents.** Gemini 3.5 Flash orchestrator; Architect/Materials/
  Stylist/Furnishing agents; shared blackboard + JSON-patch merge; parallel delegation;
  `agent_tasks` ledger + spatial task-card UI (drei `Html`).
- **M3 — NB2 photoreal.** Render agent; viewport→NB2 reskin; parallel palette/style grid;
  optional path-tracer "premium" render from cake-studio.
- **M4 — Photo→3D + Consultant + Cost/Sourcing.** Gemini-vision room reconstruction;
  websearch-backed design consultant (philosophies, references, upgrades); Live-camera
  proactive notes. Seed `material_catalog`; Estimator/Sourcing agent — web-search local
  prices + labour rates with cited sources, detailed line-item `estimate_project_cost`
  (materials from scene geometry + region labour + time). Render AI-SDK `<CostEstimate>` /
  `<SourceCard>` generative UI; matched product refs feed NB2 grounding.
- **M5 — Cinematography + OpenSCAD.** Camera flights (reuse `camera-rig`), walkthrough
  `MediaRecorder` webm, Omni cinematic video; OpenSCAD custom parts behind flag.
- **M6 — Stretch/polish.** Gemma offline fallback; generative spatial UI cards; mobile pass;
  deploy (Vercel + Neon/managed Postgres).

## Key files (new in `p2/src`)
- `scene/types.ts`, `scene/store.ts`, `scene/tools.ts`, `scene/applyPatch.ts`
- `agents/orchestrator.ts`, `agents/{architect,materials,stylist,furnishing,render,cinematographer,estimator}.ts`, `agents/blackboard.ts`
- `components/viewport/*` (adapted from cake-studio), `components/live/*` (from p1)
- `components/genui/{CostEstimate,SourceCard,PaletteGrid,RenderGrid}.tsx` (AI SDK UI)
- `app/api/{live-token,orchestrate,render,photo-to-3d,agent-task,cost}/route.ts` (`cost` + `orchestrate` stream via AI SDK)
- `lib/cost.ts` (estimator math: geometry→quantities, labour, schedule), `lib/sourcing.ts` (web-search price lookup + source citation)
- `db/schema.ts` — extend p1 with `designs`, `design_versions`, `agent_tasks`, `material_catalog`, `price_refs`, `sources`, `cost_estimates`; reuse `assets`, `telemetry`
- `lib/openscad.ts` (WASM, flagged), `lib/render.ts` (generalized `artist.ts`, accepts product-reference guide)
- Deps to add: `ai`, `@ai-sdk/react`, `@ai-sdk/google`

## Reused utilities (do not rewrite — copy & adapt)
- Live: p1 `live-token/route.ts`, `liveConfig.ts`, `useLiveAudio.ts`, `pcm-processor.js`
- NB2: p1 `artist.ts` (guide-image + retry-without-refs pattern)
- JSON patch: p1 `applyPatch.ts`; telemetry: p1 `withTiming()`
- 3D shell: cake-studio `Viewport.tsx`, `camera-rig.ts`, `capture-supersample.ts`, `MarqueeOverlay.tsx`, `useGLTF` catalog, `store.ts` undo/redo pattern, `PhotoModeRunner.tsx`

## Latency / parallelism
Ephemeral-token Live (no proxy hop) · optimistic store updates before agent confirms ·
`Promise.all` fan-out for specialist agents and NB2 variant grids · stream orchestrator
plan tokens · warm `useGLTF.preload` on the catalog · `withTiming` telemetry on every model
call to spot regressions.

## Isolation & Guardrails (HARD RULES — the builder must obey)

These exist so building p2 **cannot** damage `p1` or `cake-studio`.

1. **Write scope = `p2/` only.** Every file created/edited/deleted lives under
   `.../google-deepmind-hackathon/p2/`. `../p1` and `../../lme/cake-studio` are
   **READ-ONLY reference sources** — you may open and *copy* from them, never modify,
   move, rename, or delete anything inside them.
2. **Vendor a frozen snapshot — copy, never reference.** `p1` and `cake-studio` are
   *donors of code you copy once*, not dependencies. Bring every reused file **into**
   `p2/src/...` as a self-contained copy and adapt it there. After M0, p2 must build, run,
   and pass tests with `../p1` and `../../lme/cake-studio` **deleted or changed** — there is
   **zero** runtime or build-time link to them. Forbidden: relative imports reaching outside
   `p2/`, tsconfig path aliases pointing at them, symlinks, `file:` deps, or `workspace:`
   deps on those folders. Rationale: those projects will keep changing; p2 must never break
   or conflict because of edits over there. Record provenance as a one-line comment at the
   top of each copied file (e.g. `// vendored from p1/src/lib/artist.ts @ 2026-07-11`) so we
   know its origin, but do **not** re-sync automatically — treat the copy as owned by p2.
   `test-isolation.ts` enforces this (no import path escapes `p2/`).
3. **Separate database.** Use a **new** Postgres DB `p2_atelier` (own `DATABASE_URL`).
   Never connect to, migrate, or drop `p1_story`. Run `drizzle-kit` only with p2's config
   pointing at `p2_atelier`.
4. **Own env file.** Create `p2/.env.local`. You may *read* the key value from the parent
   `.env`, but never edit or overwrite the parent `.env` or p1's `.env`.
5. **Own dev port.** p1 runs on 3000; p2 dev server runs on **3001** (`next dev -p 3001`)
   so both run side by side.
6. **Git hygiene.** The git repo root is the parent (`google-deepmind-hackathon/`, tracking
   p1 + p2). Only `git add` paths under `p2/`. Never `git add -A` from the root, never
   `git checkout`/`reset`/`clean` paths outside `p2/`, never force-push, never rewrite
   history. If asked to commit, stage `p2/` explicitly.
7. **No global installs / no shared node_modules.** `npm install` runs inside `p2/` only.
8. **Destructive ops require confirmation.** No `rm -rf`, no DB drops, no overwriting an
   existing non-empty file you didn't create, without explicit sign-off.

## Engineering rules (for correctness & to keep the build coherent)

- **Coordinates & units:** three.js convention — right-handed, **Y-up, meters**. Floor at
  y=0. Angles in radians internally, degrees only at UI/voice edges. Money always carries an
  explicit **ISO currency code**; geometry-derived quantities carry explicit units (m², m³,
  count).
- **The scene graph is the only source of truth.** Never mutate three.js objects directly.
  All changes flow: tool call → validated args → **JSON patch** → `applyPatch` reducer →
  zustand store → R3F re-render. This keeps undo/redo and multiplayer-safe.
- **Every agent I/O is Zod-validated structured output.** Agents must return objects
  matching their schema (use Gemini structured output / `responseSchema`). On validation
  failure: one repair retry with the validation error appended, then drop the patch and log
  — never apply unvalidated data.
- **Serialized reducer, parallel agents.** Specialist agents run concurrently
  (`Promise.all`), but their patches are applied through a **single serialized reducer**.
  Conflict rule: patches target disjoint field paths where possible; if two touch the same
  path, the orchestrator arbitrates (later-planned wins, and it logs the override to
  `agent_tasks`). Never let two agents write the same field silently.
- **Idempotency & ids.** Every entity (`wall`, `furniture`, `light`, `camera`, estimate
  line) has a stable string id. Tools that "add" accept an optional id so retries don't
  duplicate. Optimistic apply in the store, reconcile when the agent confirms.
- **No un-sourced numbers.** Every price and labour rate in an estimate carries a `sourceId`
  → `sources` row (URL + fetched-at). Exception: user-fed values, which set
  `source:'user'` and are visually marked; user values always override web values.
- **NB2 discipline (from p1):** always pass the current viewport screenshot as the
  structural guide; on timeout/refusal, retry once **without** reference images (p1's proven
  fallback). Cap at the documented timeout. Fire variants with `Promise.all`, not a loop.
- **Live vs AI-SDK boundary:** audio + barge-in on the raw `@google/genai` WebSocket
  (never route audio through the AI SDK). AI SDK handles streamed text/structured turns and
  generative-UI tool rendering. Both call the *same* Zod tool registry — one tool set, two
  transports.
- **Fail soft in 3D:** assets that error render as a grey ghost box (cake-studio pattern),
  never crash the canvas. `preserveDrawingBuffer:true` stays on (capture depends on it).
- **Telemetry on every model call** via `withTiming()` — model id, task, ms, into
  `telemetry`. No silent model calls.

## Worked examples (patterns the builder should copy)

**1 — A tool = Zod schema + Gemini function declaration + reducer action.**
```ts
// src/scene/tools.ts
export const addFurniture = {
  name: "add_furniture",
  schema: z.object({
    id: z.string().optional(),
    catalogId: z.string(),                 // must exist in furniture catalog
    position: z.tuple([z.number(), z.number(), z.number()]), // meters, Y-up
    rotationY: z.number().default(0),      // radians
    material: z.string().optional(),
  }),
  toPatch: (a): Patch => [{ op: "add", path: `/furniture/-`, value: {
    id: a.id ?? nid("furn"), catalogId: a.catalogId, pos: a.position,
    rot: [0, a.rotationY, 0], scale: [1,1,1], material: a.material,
  }}],
};
// Gemini function declaration is derived from .schema via zodToGemini(addFurniture.schema)
```

**2 — What an agent returns (structured, validated) — the Furnishing agent:**
```json
{ "reasoning": "3.5m sofa wall free; add sofa + rug + floor lamp with 0.9m clearance",
  "patches": [
    { "tool": "add_furniture", "args": { "catalogId": "sofa_3seat_linen",
      "position": [1.2, 0, 3.4], "rotationY": 1.5708 } },
    { "tool": "add_furniture", "args": { "catalogId": "rug_wool_200x300",
      "position": [1.2, 0.01, 2.6], "rotationY": 0 } } ],
  "needsSourcing": ["sofa_3seat_linen", "rug_wool_200x300"] }
```

**3 — Orchestrator loop (one voice goal → parallel agents → merged scene):**
```
intent = "cozy scandinavian living room, ~4x5m, reading nook"
plan   = orchestrator.plan(intent, currentScene)   // Gemini 3.5 Flash, structured
tasks  = [architect, materials, stylist, furnishing]   // plan picks the subset
results = await Promise.all(tasks.map(a => a.run(plan, currentScene)))  // parallel
for (r of orderByPlan(results)) applyPatchSerialized(store, r.patches)  // serialized
sourcing = await estimator.priceAll(scene.needsSourcing)   // web search + cite
render   = await Promise.all(palettes.map(p => nb2Reskin(viewportPNG, p)))  // variants
// each step also writes a row to agent_tasks (agent, status, ms, patchSummary)
```

**4 — `estimate_project_cost` structured output (line items + sources):**
```json
{ "currency": "INR", "region": "Bangalore, IN",
  "materials": [
    { "id":"m1","item":"Interior emulsion paint","qty":48,"unit":"m2",
      "unitPrice":22,"subtotal":1056,"sourceId":"s_paint_01" },
    { "id":"m2","item":"Engineered oak flooring","qty":20,"unit":"m2",
      "unitPrice":420,"subtotal":8400,"sourceId":"s_floor_03" } ],
  "labour": [
    { "id":"l1","trade":"Painting","hours":16,"rate":180,"subtotal":2880,
      "sourceId":"s_labour_paint" },
    { "id":"l2","trade":"Flooring install","hours":24,"rate":250,"subtotal":6000,
      "sourceId":"s_labour_floor" } ],
  "timeEstimateDays": 4,
  "subtotals": { "materials": 9456, "labour": 8880 },
  "contingencyPct": 10, "total": 20169.6,
  "sources": [ { "id":"s_floor_03","url":"https://...","fetchedAt":"2026-07-11" } ] }
// qty for m1 = sum of wall areas minus openings; for m2 = floor area — both from scene geometry.
```

**5 — RoomDesign instance (minimal, for a fixture/test seed):**
```json
{ "room": { "dims": {"w":4,"d":5,"h":2.7}, "floor": {"materialId":"oak_eng"},
            "ceiling": {"materialId":"white_matte"} },
  "walls": [ {"id":"w1","from":[0,0],"to":[4,0],"height":2.7,"thickness":0.1,"material":"paint_sage"} ],
  "openings": [ {"id":"o1","type":"window","wallId":"w1","offset":1.5,"size":[1.2,1.2]} ],
  "furniture": [], "materials": [], "lights": [], "cameras": [], "style": {"philosophy":"scandinavian","palette":[],"mood":"cozy"} }
```

## Verification
All scripts follow p1's `npx tsx scripts/<name>.ts` pattern and **must assert**, not just
print. Each lists the exact pass condition. Run against `p2_atelier` only.

- **`test-schema.ts`** — validate every fixture `RoomDesign` (example 5) against the Zod
  scene schema; validate each tool's args + output schema round-trips. Pass: 0 validation
  errors; an intentionally-bad fixture is rejected.
- **`test-tools.ts`** — for every tool, `args → toPatch → applyPatch(emptyScene)` yields the
  expected scene delta and is **idempotent** (same id applied twice = one entity). Pass:
  entity counts + field values match expected; undo() then redo() restores exactly.
- **`test-live-tools.ts`** — mint a Live token, connect, speak/inject a canned transcript
  ("add a sofa on the left wall") → assert the matching tool call fires and the store gains
  one furniture node. Pass: tool call received < 2s; barge-in (`flushPlayback`) empties the
  playback queue mid-utterance.
- **`test-orchestrator.ts`** — one goal → ≥3 agents run **in parallel** (assert overlapping
  timestamps in `agent_tasks`), patches merge with **no field collisions**, final scene
  validates. Inject a deliberate conflict (two agents set `walls/w1/material`) → assert the
  orchestrator arbitration picks one and logs the override. Pass: scene valid, conflict
  logged, wall-clock < sum-of-agent-times (proves parallelism).
- **`test-render.ts`** — render a fixture scene, capture viewport PNG, fire 4 NB2 variants
  via `Promise.all`. Pass: 4 non-empty 1K images; each ≤ ~4s; a forced-timeout path proves
  the retry-without-refs fallback still returns an image.
- **`test-photo-to-3d.ts`** — 2–3 sample room photos → Gemini vision → `RoomDesign`. Pass:
  output validates; dims within plausible bounds (1–12 m); ≥1 wall and ≥1 detected furniture
  item; result renders without a canvas error.
- **`test-cost.ts`** — known fixture room → `estimate_project_cost`. Pass: paint qty ==
  computed wall-area-minus-openings (±1%), floor qty == floor area (±1%); **every** material
  & labour line has a resolvable `sourceId`; feeding a user override for one unit price
  re-totals correctly and marks that line `source:'user'`; region change swaps labour rates.
- **`test-isolation.ts`** — assert `DATABASE_URL` host/db == `p2_atelier` (fail hard if it
  contains `p1_story`); assert no source file under `p2/src` imports from `../p1` or the
  cake-studio path; assert dev port config == 3001.
- **Manual demo pass:** `npm run dev` (port 3001); walk the spine by **voice on desktop and
  phone** — create room → materials → furnish → "make it photoreal" (NB2 grid) → estimate
  cost (AI-SDK `<CostEstimate>`, edit a price by voice) → camera walkthrough webm. Confirm
  the `agent_tasks` ledger + spatial cards populate live and `p1` is untouched
  (`git status` shows changes only under `p2/`).
