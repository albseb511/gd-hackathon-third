# VOICEBOUND

*A story that listens back.*

A live, voice-first interactive fiction game in the spirit of **Bandersnatch** and **As Dusk Falls** — except nothing is pre-rendered. The narrator is a live AI game-master you can interrupt mid-sentence, every scene's artwork is painted in real time, and the story's social fabric bends to *how* you speak, not just what you choose.

**Play:** https://web-production-f59b2.up.railway.app (installable as a PWA — Add to Home Screen)

## What makes it different

- **The narrator is alive** (Gemini Live API, `gemini-3.1-flash-live-preview`): continuous audio over a direct browser↔Google WebSocket, native barge-in (interrupt it mid-sentence and it reacts in character), and vocal-tone awareness — deliver a bluff in your bluffing voice and the game grants your d20 roll *advantage*.
- **Every scene is painted live** (Nano Banana 2 Lite, `gemini-3.1-flash-lite-image`): scene art in ~4s with the player's photo-derived portrait as a reference image for likeness consistency; same-location changes use *edit mode* on the previous frame; and when choices appear, **all branches pre-render speculatively in parallel** while you decide — pick one and its scene is already there.
- **You are in the story**: upload a selfie → a portrait in the story's hand-painted graphic-novel style + a character sheet with Might/Wit/Charm stats read from your photo and one line about yourself.
- **Fights and fate**: tap-mash / timed-tap / swipe-sequence QTEs for combat, animated d20 skill checks for everything else risky. Losing is never game over — it's the darker branch.
- **Generative UI**: ask "what's in my bag?" and a generated inventory panel slides in; find a wanted poster and the model writes a full HTML artifact rendered in a sandboxed iframe.
- **A synthetic player population**: before anyone plays a story, simulator agents play it — five personas (cautious, heroic, chaotic, hostile, speedrunner) traverse the branch graph. That powers the post-chapter story map: *"68% went quietly — you fought."*
- **Save anywhere, resume anywhere**: every beat persists to Postgres; cold resume rebuilds the narrator's memory from a compressed summary + recent scenes and recaps you back in.

## The agent orchestra

| Agent | Model | Job |
|---|---|---|
| Narrator | `gemini-3.1-flash-live-preview` | Voice GM: narration, tone reading, tool calls |
| Director | `gemini-3.5-flash` | Continuity guard vs story bible + state, missed-tool fill, social read (relationship/aura deltas from your speech) |
| Artist | `gemini-3.1-flash-lite-image` | Scenes, portraits, edit-mode continuity, app icons |
| UI-Smith | `gemini-3.5-flash` | Generative UI specs + sandboxed HTML artifacts |
| Archivist | `gemini-3.5-flash` | Summary compression, save/resume rehydration |
| Simulator | `gemini-3.5-flash` | Persona players → branch analytics + latency benchmarks |
| Composer | `lyria-3-clip-preview` | Pre-generated mood music bank (7 moods × 3 stories), ducked under narration |

The Narrator drives the game through 7 function-calling tools (`render_scene`, `present_choices`, `start_qte`, `skill_check`, `show_ui`, `update_state`, `end_story`); the client executes them and reports results back — QTE and dice outcomes return with `INTERRUPT` scheduling so the narrator reacts the instant a fight resolves.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · Drizzle + Postgres · `@google/genai` · Railway · PWA

Security note: the browser talks to the Live API directly using **single-use ephemeral tokens** minted server-side with the full session config locked in `liveConnectConstraints` — the real API key never leaves the server, and the client can't alter the system prompt.

## Run it

```bash
npm install
echo "GEMINI_API_KEY=..." > .env        # required
echo "DATABASE_URL=postgres://..." >> .env  # optional; stories play without it
npx drizzle-kit push                     # if using a database
npm run dev
```

Useful scripts:

```bash
npx tsx scripts/simulate.ts --story noir --n 8   # simulate playthroughs → analytics
npx tsx scripts/gen-outlines.ts                  # regenerate the 3 prebuilt stories
npx tsx scripts/gen-music.ts                     # regenerate the Lyria mood bank
npx tsx scripts/gen-app-assets.ts                # regenerate app icons
npx tsx scripts/test-live-token.ts               # verify the Live token pipeline
```

`/test-live` is a bare-bones harness for verifying mic capture, audio playback, and barge-in on real hardware. `/analytics/noir` (or `fantasy`, `starship`) shows the full story cartography + pipeline latency percentiles.
