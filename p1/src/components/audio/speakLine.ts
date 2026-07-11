"use client";

// Sentence-level streamed dialogue: split a line into sentences and fire one
// STREAMED /api/tts request per sentence EAGERLY (the instant speakLine is
// called, i.e. at speak_as dispatch). Every request generates in parallel and
// overlaps whatever audio is currently playing, so by the time the queue
// reaches this line the chunks are already buffered → the character starts
// speaking with almost no gap instead of a ~2s dead wait.

import { PresentationQueue, SentenceFeed } from "./presentationQueue";

const FIRST_CHUNK_TIMEOUT_MS = 15000;
const STALL_TIMEOUT_MS = 10000;

function splitSentences(line: string): string[] {
  const parts = line
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // merge tiny fragments ("No." after a long sentence stays its own beat,
  // but stray 1-2 char shards glue onto their neighbor)
  const merged: string[] = [];
  for (const p of parts) {
    if (p.length < 4 && merged.length) merged[merged.length - 1] += ` ${p}`;
    else merged.push(p);
  }
  return merged.length ? merged : [line];
}

// EAGER producer: kicks the streamed /api/tts fetch off IMMEDIATELY and
// buffers decoded base64 chunks. The returned `feed` generator just drains
// that buffer (waking on a notifier) so consumption can start whenever the
// queue is ready — generation has already been running in parallel.
function streamSentence(
  text: string,
  voiceName: string,
  style: string,
): { feed: AsyncGenerator<string, void, unknown>; cancel: () => void } {
  const controller = new AbortController();
  const chunks: string[] = [];
  let done = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  // fire the request now — do not wait for the consumer to iterate
  (async () => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voiceName, style, stream: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotFirst = false;
      const started = Date.now();
      let lastChunkAt = Date.now();
      try {
        for (;;) {
          const deadline = gotFirst
            ? lastChunkAt + STALL_TIMEOUT_MS
            : started + FIRST_CHUNK_TIMEOUT_MS;
          const timeLeft = deadline - Date.now();
          if (timeLeft <= 0) break;
          const result = await Promise.race([
            reader.read(),
            new Promise<"timeout">((r) => setTimeout(() => r("timeout"), timeLeft)),
          ]);
          if (result === "timeout" || result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const raw of lines) {
            if (!raw.trim()) continue;
            try {
              const msg = JSON.parse(raw) as { c?: string; done?: boolean; error?: string };
              if (msg.c) {
                gotFirst = true;
                lastChunkAt = Date.now();
                chunks.push(msg.c);
                notify();
              }
              if (msg.done || msg.error) return;
            } catch {
              // partial line noise — skip
            }
          }
        }
      } finally {
        try {
          await reader.cancel();
        } catch {}
      }
    } catch {
      // aborted or network death — feed just ends
    } finally {
      done = true;
      notify();
    }
  })();

  async function* feed(): AsyncGenerator<string, void, unknown> {
    let i = 0;
    for (;;) {
      if (i < chunks.length) {
        yield chunks[i++];
        continue;
      }
      if (done) return;
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 250); // safety poll so we never hang on a lost notify
      });
    }
  }

  return { feed: feed(), cancel: () => controller.abort() };
}

/**
 * Speak one character line through the presentation queue, streamed.
 * All sentence requests start immediately (parallel generation), but the
 * whole line rides as ONE dialogue group — the speaker enters once, the
 * sentences play back-to-back, the speaker exits once. No flicker.
 */
export function speakLine(
  queue: PresentationQueue,
  speaker: string,
  line: string,
  voiceName: string,
  style: string,
) {
  const feeds: SentenceFeed[] = splitSentences(line).map((sentence) =>
    streamSentence(sentence, voiceName, style),
  );
  queue.pushTtsStream(speaker, line, feeds);
}
