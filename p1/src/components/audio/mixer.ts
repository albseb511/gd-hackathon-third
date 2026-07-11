"use client";

import { Mood } from "@/lib/storyEngine/types";

// Music mixer: loops pre-generated Lyria clips per mood with crossfades,
// and ducks under the narrator's voice. Own AudioContext (44.1k) so music
// quality is independent of the 24k speech path.
const MOOD_FALLBACK: Record<string, string> = {
  item_closeup: "explore",
};

const DUCK_DB = 0.35; // linear gain while narrator speaks
const BASE_GAIN = 0.55;
const XFADE_S = 2;

export class MusicMixer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private current: { src: AudioBufferSourceNode; gain: GainNode; mood: string } | null =
    null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private bank: string;
  private disposed = false;

  constructor(bank: string) {
    this.bank = bank; // e.g. "noir" → /music/noir/<mood>.mp3
  }

  // call from a user gesture
  start() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = BASE_GAIN;
    this.duck = this.ctx.createGain();
    this.duck.gain.value = 1;
    this.master.connect(this.duck).connect(this.ctx.destination);
  }

  setSpeaking(speaking: boolean) {
    if (!this.ctx || !this.duck) return;
    const target = speaking ? DUCK_DB : 1;
    this.duck.gain.cancelScheduledValues(this.ctx.currentTime);
    this.duck.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.4);
  }

  private load(mood: string): Promise<AudioBuffer | null> {
    const key = `${this.bank}/${mood}`;
    let p = this.buffers.get(key);
    if (!p) {
      p = fetch(`/music/${this.bank}/${mood}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((ab) => this.ctx!.decodeAudioData(ab))
        .catch(() => null);
      this.buffers.set(key, p);
    }
    return p;
  }

  async play(rawMood: Mood | string) {
    if (!this.ctx || !this.master || this.disposed) return;
    const mood = MOOD_FALLBACK[rawMood] ?? rawMood;
    if (this.current?.mood === mood) return;
    const buf = await this.load(mood);
    if (!buf || this.disposed || this.current?.mood === mood) return;

    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + XFADE_S);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain).connect(this.master);
    src.start(now);

    if (this.current) {
      const old = this.current;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + XFADE_S);
      setTimeout(() => {
        try {
          old.src.stop();
        } catch {}
      }, XFADE_S * 1000 + 100);
    }
    this.current = { src, gain, mood };
  }

  dispose() {
    this.disposed = true;
    try {
      this.current?.src.stop();
    } catch {}
    void this.ctx?.close();
    this.ctx = null;
    this.current = null;
  }
}

// pick a bank for a story by its genre string
export function bankForGenre(genre: string): string {
  const g = genre.toLowerCase();
  if (/noir|crime|thriller|mystery|detective/.test(g)) return "noir";
  if (/sci|space|star|cyber|future/.test(g)) return "starship";
  return "fantasy";
}
