"use client";

// Synthesized one-shot SFX — zero assets, WebAudio only. Small, dry, cheap.
type SfxName =
  | "tap" // choice pressed
  | "whoosh" // scene transition
  | "dice" // dice roll clatter
  | "hit" // QTE tap registered
  | "win" // QTE / check success
  | "lose" // QTE / check fail
  | "pop"; // UI panel opens

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function env(c: AudioContext, t0: number, a: number, d: number, peak = 1): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + a + d);
  g.connect(master!);
  return g;
}

function tone(c: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType, peak = 0.8) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.connect(env(c, t0, 0.005, dur, peak));
  o.start(t0);
  o.stop(t0 + dur + 0.1);
}

export function playSfx(name: SfxName) {
  try {
    const c = ensure();
    const t = c.currentTime + 0.01;
    switch (name) {
      case "tap":
        tone(c, t, 660, 0.07, "triangle", 0.6);
        tone(c, t + 0.02, 990, 0.05, "sine", 0.3);
        break;
      case "pop":
        tone(c, t, 440, 0.09, "sine", 0.5);
        break;
      case "whoosh": {
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c, 0.5);
        const f = c.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 1.2;
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
        src.connect(f).connect(env(c, t, 0.06, 0.4, 0.35));
        src.start(t);
        break;
      }
      case "dice": {
        for (let i = 0; i < 5; i++) {
          const st = t + i * 0.055 + Math.random() * 0.02;
          const src = c.createBufferSource();
          src.buffer = noiseBuffer(c, 0.03);
          const f = c.createBiquadFilter();
          f.type = "highpass";
          f.frequency.value = 2500;
          src.connect(f).connect(env(c, st, 0.002, 0.04, 0.5 - i * 0.07));
          src.start(st);
        }
        break;
      }
      case "hit":
        tone(c, t, 880, 0.04, "square", 0.25);
        break;
      case "win":
        tone(c, t, 523, 0.12, "triangle", 0.5);
        tone(c, t + 0.1, 659, 0.12, "triangle", 0.5);
        tone(c, t + 0.2, 784, 0.22, "triangle", 0.6);
        break;
      case "lose":
        tone(c, t, 392, 0.16, "sawtooth", 0.35);
        tone(c, t + 0.15, 311, 0.16, "sawtooth", 0.35);
        tone(c, t + 0.3, 233, 0.3, "sawtooth", 0.4);
        break;
    }
  } catch {
    // sfx are garnish; never break the game
  }
}
