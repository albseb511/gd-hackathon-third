"use client";

// The presentation semaphore: ONE ordered pipeline for everything the player
// hears. Narrator (live) audio and character (TTS) clips play strictly in
// stream order — narrator chunks that arrive while a character line is being
// synthesized are buffered, never lost, never overlapped.
//
//   [live seg: narrator chunks…] → [tts seg: VANCE line] → [live seg: …] → …
//
// The queue also drives who-is-speaking (caption chips), ducking, and the
// "reveal choices only when the audio has fully drained" gate.

type LiveSegment = { kind: "live"; chunks: string[]; scheduled: number; closed: boolean };
type TtsSegment = {
  kind: "tts";
  speaker: string;
  line: string;
  clip: Promise<string | null>; // base64 24k PCM16, null on failure
};
// A visual marker rides the audio timeline WITHOUT blocking it: its apply()
// fires when playback reaches this point in the stream (and the visual is
// ready) — scene changes sync to the narration being HEARD while generation
// runs fully parallel underneath.
type VisualSegment = {
  kind: "visual";
  seq: number;
  ready: Promise<unknown> | null;
  apply: () => void;
};
// Streamed dialogue: ONE segment per line, carrying ALL its sentence streams.
// Sentences play back-to-back inside the group — the speaker enters once and
// exits once, no flicker between sentences.
export type SentenceFeed = {
  feed: AsyncGenerator<string, void, unknown>; // yields base64 PCM chunks
  cancel: () => void;
};
type TtsStreamSegment = {
  kind: "tts-stream";
  speaker: string;
  line: string;
  feeds: SentenceFeed[];
};
type Segment = LiveSegment | TtsSegment | VisualSegment | TtsStreamSegment;

export interface SpeakerInfo {
  speaker: string; // "narrator" or a character name
  line?: string; // the exact line, for TTS segments
}

// cold serverless TTS can take >10s; a skipped clip is a silent character
const TTS_WAIT_MS = 15000;

export class PresentationQueue {
  private ctx: AudioContext | null = null;
  private segments: Segment[] = [];
  private cursor = 0; // ctx time where the next clip starts
  private sources = new Set<AudioBufferSourceNode>();
  private pumping = false;
  private epoch = 0; // bumped on flush; stale pumps/awaits abandon
  private speakingTimer: ReturnType<typeof setTimeout> | null = null;
  private wake: (() => void) | null = null;
  private visualSeq = 0;
  private lastAppliedVisual = 0;

  onSpeaking: (speaking: boolean) => void = () => {};
  onSpeaker: (info: SpeakerInfo | null) => void = () => {};
  onClipResult: (ok: boolean, speaker: string) => void = () => {};

  // must be called from a user gesture at least once
  ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: 24000 });
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  get speaking(): boolean {
    return !!this.ctx && this.cursor > this.ctx.currentTime;
  }

  get drained(): boolean {
    return this.segments.length === 0 && !this.speaking;
  }

  /** Narrator audio chunk from the live stream. */
  pushLive(base64Pcm: string) {
    let tail = this.segments[this.segments.length - 1];
    if (!tail || tail.kind !== "live" || tail.closed) {
      tail = { kind: "live", chunks: [], scheduled: 0, closed: false };
      this.segments.push(tail);
    }
    tail.chunks.push(base64Pcm);
    this.poke();
  }

  /** A character line: closes the current narrator segment, synthesis rides in order. */
  pushTts(speaker: string, line: string, clip: Promise<string | null>) {
    const tail = this.segments[this.segments.length - 1];
    if (tail?.kind === "live") tail.closed = true;
    this.segments.push({ kind: "tts", speaker, line, clip });
    this.poke();
  }

  /** A streamed character line: all its sentences as ONE dialogue group. */
  pushTtsStream(speaker: string, line: string, feeds: SentenceFeed[]) {
    const tail = this.segments[this.segments.length - 1];
    if (tail?.kind === "live") tail.closed = true;
    this.segments.push({ kind: "tts-stream", speaker, line, feeds });
    this.poke();
  }

  /** A scene/visual change that should land in sync with the narration. */
  pushVisual(apply: () => void, ready: Promise<unknown> | null = null) {
    const tail = this.segments[this.segments.length - 1];
    if (tail?.kind === "live") tail.closed = true;
    this.segments.push({ kind: "visual", seq: ++this.visualSeq, ready, apply });
    this.poke();
  }

  /** Barge-in: kill everything, everywhere, now. */
  flush() {
    this.epoch++;
    for (const s of this.segments) {
      if (s.kind === "tts-stream") {
        for (const f of s.feeds) {
          try {
            f.cancel();
          } catch {}
        }
      }
    }
    this.segments = [];
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    this.cursor = 0;
    this.setSpeakingSoon(0);
    this.onSpeaker(null);
  }

  /** Pause/resume ALL output audio — suspending the context freezes every
      scheduled source in place, so resume continues exactly where it stopped. */
  setPaused(paused: boolean) {
    if (!this.ctx) return;
    if (paused && this.ctx.state === "running") void this.ctx.suspend();
    if (!paused && this.ctx.state === "suspended") void this.ctx.resume();
  }

  dispose() {
    this.flush();
    void this.ctx?.close();
    this.ctx = null;
  }

  /** Resolves when everything queued so far has finished playing. */
  async waitForDrain(pollMs = 200): Promise<void> {
    const epoch = this.epoch;
    while (this.epoch === epoch && !this.drained) {
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  // ---- internals -----------------------------------------------------------

  private poke() {
    this.wake?.();
    if (!this.pumping) void this.pump();
  }

  private schedule(base64: string): number {
    const ctx = this.ensureCtx();
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 0x8000;
    const buf = ctx.createBuffer(1, Math.max(1, floats.length), 24000);
    buf.copyToChannel(floats, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(this.cursor, ctx.currentTime + 0.12);
    src.start(startAt);
    this.cursor = startAt + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
    this.setSpeakingSoon((this.cursor - ctx.currentTime) * 1000 + 250);
    return this.cursor;
  }

  private setSpeakingSoon(remainingMs: number) {
    this.onSpeaking(remainingMs > 300);
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    if (remainingMs > 300) {
      this.speakingTimer = setTimeout(() => this.onSpeaking(false), remainingMs);
    }
  }

  private async waitUntilCursor(epoch: number) {
    while (this.epoch === epoch && this.ctx && this.cursor > this.ctx.currentTime + 0.05) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    const epoch = this.epoch;
    try {
      while (this.epoch === epoch) {
        const seg = this.segments[0];
        if (!seg) break;

        if (seg.kind === "live") {
          // schedule whatever has arrived
          while (seg.scheduled < seg.chunks.length) {
            this.schedule(seg.chunks[seg.scheduled++]);
          }
          if (seg.closed) {
            this.segments.shift();
            continue;
          }
          // open tail: wait for more chunks or a closer
          await new Promise<void>((r) => {
            this.wake = r;
            setTimeout(r, 400); // heartbeat so turn-end drains promptly
          });
          this.wake = null;
          // if nothing new and nothing after us, and audio drained → idle out.
          // The segment MUST leave the queue here: a fully-played segment
          // lingering keeps `drained` false forever, which deadlocks the
          // choice reveal and suppresses the watchdog.
          if (
            this.segments[0] === seg &&
            seg.scheduled >= seg.chunks.length &&
            !seg.closed &&
            this.segments.length === 1 &&
            !this.speaking
          ) {
            this.segments.shift();
            break;
          }
          continue;
        }

        if (seg.kind === "visual") {
          // NON-BLOCKING for audio: stamp this marker at the current end of
          // scheduled audio and move on; apply fires when playback reaches
          // that stamp AND the visual is ready. Later markers supersede
          // earlier ones that lag behind their slot.
          this.segments.shift();
          const ctx = this.ensureCtx();
          const applyAt = Math.max(this.cursor, ctx.currentTime);
          const marker = seg;
          const fire = () => {
            if (this.epoch !== epoch) return;
            if (marker.seq < this.lastAppliedVisual) return; // superseded
            this.lastAppliedVisual = marker.seq;
            try {
              marker.apply();
            } catch {}
          };
          const slotMs = Math.max(0, (applyAt - ctx.currentTime) * 1000);
          const slot = new Promise((r) => setTimeout(r, slotMs));
          void Promise.all([slot, marker.ready ?? Promise.resolve()]).then(fire);
          continue;
        }

        if (seg.kind === "tts-stream") {
          // let prior audio finish, then play the WHOLE dialogue group —
          // every sentence stream in order, one speaker enter/exit, chunks
          // scheduled as they download (later sentences generate in parallel)
          await this.waitUntilCursor(epoch);
          if (this.epoch !== epoch) break;
          this.onSpeaker({ speaker: seg.speaker, line: seg.line });
          let got = false;
          for (const sentence of seg.feeds) {
            if (this.epoch !== epoch) break;
            try {
              // first-chunk timeout lives inside the feed (speakLine wraps it)
              for await (const chunk of sentence.feed) {
                if (this.epoch !== epoch) {
                  sentence.cancel();
                  break;
                }
                got = true;
                this.schedule(chunk);
                // keep the speaking flag hot across sentence boundaries
                this.onSpeaking(true);
              }
            } catch {
              // this sentence's stream died; carry on to the next
            }
          }
          this.onClipResult(got, seg.speaker);
          if (this.epoch !== epoch) break;
          if (got) {
            await this.waitUntilCursor(epoch);
          } else {
            // silent line: hold the caption a beat so it still lands
            await new Promise((r) =>
              setTimeout(r, Math.min(3500, 900 + seg.line.length * 45)),
            );
          }
          if (this.epoch !== epoch) break;
          this.onSpeaker(null);
          this.segments.shift();
          continue;
        }

        // TTS segment: let prior audio finish, then play the clip
        await this.waitUntilCursor(epoch);
        if (this.epoch !== epoch) break;
        const clip = await Promise.race([
          seg.clip,
          new Promise<null>((r) => setTimeout(() => r(null), TTS_WAIT_MS)),
        ]);
        if (this.epoch !== epoch) break;
        this.onSpeaker({ speaker: seg.speaker, line: seg.line });
        this.onClipResult(!!clip, seg.speaker);
        if (clip) {
          this.schedule(clip);
          await this.waitUntilCursor(epoch);
        } else {
          // synthesis failed: hold the caption a beat so the line still lands
          await new Promise((r) => setTimeout(r, Math.min(3500, 900 + seg.line.length * 45)));
        }
        if (this.epoch !== epoch) break;
        this.onSpeaker(null);
        this.segments.shift();
      }
    } finally {
      this.pumping = false;
      // new pushes while we were exiting?
      if (
        this.epoch === epoch &&
        this.segments.some(
          (s) =>
            s.kind === "tts" ||
            s.kind === "tts-stream" ||
            s.kind === "visual" ||
            (s.kind === "live" && s.scheduled < s.chunks.length),
        )
      ) {
        void this.pump();
      }
    }
  }
}
