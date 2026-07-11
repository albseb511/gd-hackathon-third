// ─────────────────────────────────────────────────────────────────────────────
// STARSHIP AUDIO CONTRACT — single source of truth for the Starship music bed.
//
// One entry per mood drives ALL of:
//   • generation      → `sonic`         (the Lyria prose prompt, Starship-tinted)
//   • runtime pick     → `useWhen/avoidWhen` (guidance the narrator agent reads)
//   • post-processing  → `loudnessLUFS`  (mood-relative loudness target)
//   • validation       → `energyRank` + `brightness` (expected acoustic signature)
//
// TRIGGER PATHS (how a mood is chosen live):
//   "scene" — the narrator emits it via render_scene(mood); Director trueMood backs it up.
//   "phase" — a game event forces it with no LLM in the loop:
//              decision → present_choices, combat → start_qte, triumphant/tense → qte/dice result.
//
// Sonic recipes + energy/brightness rankings are grounded in sci-fi-thriller
// scoring research (Goldsmith/Alien, Jóhannsson/Arrival, Zimmer/Interstellar +
// Shepard tones, Graves/Dead Space Penderecki-Ligeti clusters, BR2049 analog+granular).
// ─────────────────────────────────────────────────────────────────────────────

export type MoodTrigger = "scene" | "phase";
export type Brightness = "dark" | "dark-mid" | "mid" | "mid-bright" | "bright";

export interface MoodSpec {
  /** how this mood is selected at runtime */
  trigger: MoodTrigger;
  /** runtime selection guidance the narrator agent reads (goes into systemPrompt) */
  useWhen: string;
  avoidWhen: string;
  /** Lyria prose descriptor — dropped into the wrapping template at generation */
  sonic: string;
  /** 1 = quietest/sparsest … 9 = loudest/densest. Validates arousal ordering.
   *  Research ordering (quiet→loud): tragic≈calm < item < explore≈decision < intro≈triumphant < tense < combat */
  energyRank: number;
  /** mood-relative integrated-loudness target (LUFS) applied in post — tracks energyRank */
  loudnessLUFS: number;
  /** expected spectral brightness — flags mislabelled/inverted clips.
   *  Research ordering (dark→bright): tragic < intro < calm < decision≈explore≈tense < triumphant < item < combat */
  brightness: Brightness;
}

// The claustrophobic dying-ship palette (prepended to every Starship clip).
export const STARSHIP_PALETTE =
  "a cold, minimalist sci-fi thriller score in the tradition of Alien, Interstellar and Blade Runner 2049 — deep sub-bass drones, detuned analog synth pads, metallic ship-hull resonances, granular textures, distant alarm tones, sonar-like blips and tape warble, with the airless dread of a dying spaceship";

// Ordered lowest-energy → highest so the intended arousal contrast is explicit.
export const STARSHIP_MOODS: Record<string, MoodSpec> = {
  tragic: {
    trigger: "scene",
    useWhen: "a death, a depressurization, freezing in the dark, or grievous irreversible loss",
    avoidWhen: "tension that has not yet turned to loss; use tense instead",
    sonic:
      "Cold grief in the airless dark — death, frost, decompression. A slow, mournful solo cello and a distant church organ drifting over a deep sub-bass drone, a descending lament at a glacial tempo, long cold reverb, no percussion, very sparse and desolate",
    energyRank: 2,
    loudnessLUFS: -18,
    brightness: "dark",
  },
  calm: {
    trigger: "scene",
    useWhen: "a rare, fragile lull between disasters — a moment to breathe, never truly safe",
    avoidWhen: "any active threat, countdown, or confrontation is present",
    sonic:
      "A fragile, uneasy quiet between disasters — hollow, never truly safe. A soft, hollow sustained synth pad in an unresolved minor tonality with a faint life-support fan hum beneath, almost no motion, very sparse and very quiet, no percussion",
    energyRank: 2,
    loudnessLUFS: -18,
    brightness: "dark-mid",
  },
  item_closeup: {
    trigger: "scene",
    useWhen: "the player examines a clue, evidence, a data terminal, or a small object up close",
    avoidWhen: "a full scene or location is in view rather than a single focused object",
    sonic:
      "Close and intent, examining evidence on a cold terminal. A quiet low drone under soft digital data blips, filtered high-frequency sparkle and a single sonar-ping ostinato, intimate and curious, small isolated activity, low energy",
    energyRank: 3,
    loudnessLUFS: -17,
    brightness: "mid-bright",
  },
  explore: {
    trigger: "scene",
    useWhen: "cautiously investigating dark corridors, searching for clues — creeping dread",
    avoidWhen: "a safe lull (calm) or an active threat (tense/combat)",
    sonic:
      "Cautious, creeping investigation of dark corridors, something watching. A low sustained pedal drone with sparse isolated metallic pings, creaks and faint radio static, long silences between sounds, dark and minimal, low energy",
    energyRank: 4,
    loudnessLUFS: -15,
    brightness: "mid",
  },
  decision: {
    trigger: "phase",
    useWhen: "the player is at a decision point and must choose (fired automatically with present_choices)",
    avoidWhen: "action is still resolving, or narration is ongoing without a fork",
    sonic:
      "A held breath at a decision point under a ticking countdown — suspended and unresolved. A sustained, suspended string cluster with a slowly rising Shepard tone and a faint ticking pulse, frozen and airless, no melody and no resolution, tense and still",
    energyRank: 4,
    loudnessLUFS: -16,
    brightness: "mid",
  },
  intro: {
    trigger: "scene",
    useWhen: "the opening establishing shot — the drifting sabotaged ship and the stakes",
    avoidWhen: "any time after the world is established",
    sonic:
      "Establishing the drifting, sabotaged ship under blood-red emergency light. A deep sub-bass drone beneath a slow, detuned analog synth pad and a single unresolved two-note motif, distant metallic hull hum, and a vast cavernous reverb — wide, slow, lonely and foreboding, moderate-low energy",
    energyRank: 5,
    loudnessLUFS: -13,
    brightness: "dark",
  },
  triumphant: {
    trigger: "scene",
    useWhen: "the saboteur is exposed or survival is secured — hard-won, exhausted relief at a terrible cost",
    avoidWhen: "any bright, easy, or heroic victory; this world has none",
    sonic:
      "Hard-won, exhausted relief — survival at a terrible cost, warm but not bright. A warm analog synth pad settling slowly toward consonance with soft sustained strings and a slow swell, reverb-drenched and spent, major-leaning but restrained, no brass fanfare",
    energyRank: 5,
    loudnessLUFS: -13,
    brightness: "mid-bright",
  },
  tense: {
    trigger: "scene",
    useWhen: "the workhorse — paranoia, stealth, a risky gamble, a threat coiling; danger present but not yet erupted",
    avoidWhen: "an actual fight/physical peril (use combat) or a fork (decision)",
    sonic:
      "The coiled paranoia of a dying ship — stealth and rising threat. A pulsing sub-bass ostinato under a granular metallic texture and low tremolo strings, dark and restrained but driving, with an occasional dissonant metallic stab, no melody, steadily tightening",
    energyRank: 7,
    loudnessLUFS: -11,
    brightness: "mid",
  },
  combat: {
    trigger: "phase",
    useWhen: "desperate physical survival — reactor fire, a fight over the core, vacuum dragging you out (fired with start_qte)",
    avoidWhen: "mere suspense without physical peril (use tense)",
    sonic:
      "Desperate, chaotic survival — fire, vacuum, a fight for the ship, not a heroic battle. Dense dissonant string clusters, a blaring alarm klaxon, distorted overdriven sub-bass and fast aleatoric chaotic strings — harsh, loud, panicked sci-fi horror at maximum intensity",
    energyRank: 9,
    loudnessLUFS: -9,
    brightness: "bright",
  },
};

// The nine mood ids in on-disk / enum order.
export const STARSHIP_MOOD_IDS = Object.keys(STARSHIP_MOODS);
