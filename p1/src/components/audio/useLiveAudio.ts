"use client";

import { useCallback, useRef, useState } from "react";

// Owns both directions of audio for a Live session:
//  in:  mic → AudioWorklet → 16kHz PCM16 chunks → onChunk (base64)
//  out: 24kHz PCM16 chunks → scheduled AudioBuffer queue (flushable on barge-in)
export function useLiveAudio() {
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playCursorRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const musicDuckRef = useRef<(speaking: boolean) => void>(() => {});
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Must be called from a user gesture (iOS requirement).
  const startMic = useCallback(
    async (onChunk: (base64Pcm16k: string) => void) => {
      if (inCtxRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      inCtxRef.current = ctx;
      await ctx.audioWorklet.addModule("/worklets/pcm-processor.js");
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pcm-processor");
      workletRef.current = node;
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const bytes = new Uint8Array(e.data);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        onChunk(btoa(bin));
      };
      src.connect(node);
      // worklet needs no audible output; keep the graph alive silently
      const silent = ctx.createGain();
      silent.gain.value = 0;
      node.connect(silent).connect(ctx.destination);
      setMicActive(true);
    },
    [],
  );

  const ensureOutCtx = useCallback(() => {
    if (!outCtxRef.current) {
      outCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    if (outCtxRef.current.state === "suspended") {
      void outCtxRef.current.resume();
    }
    return outCtxRef.current;
  }, []);

  // Queue a 24kHz PCM16 chunk from the model for gapless scheduled playback.
  const playChunk = useCallback(
    (base64Pcm24k: string) => {
      const ctx = ensureOutCtx();
      const bin = atob(base64Pcm24k);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const samples = new Int16Array(bytes.buffer);
      const floats = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 0x8000;

      const buf = ctx.createBuffer(1, floats.length, 24000);
      buf.copyToChannel(floats, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);

      const now = ctx.currentTime;
      // 150ms jitter buffer when the queue is empty/behind
      const startAt = Math.max(playCursorRef.current, now + 0.15);
      src.start(startAt);
      playCursorRef.current = startAt + buf.duration;
      sourcesRef.current.add(src);
      src.onended = () => sourcesRef.current.delete(src);

      setSpeaking(true);
      musicDuckRef.current(true);
      if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = setTimeout(
        () => {
          setSpeaking(false);
          musicDuckRef.current(false);
        },
        Math.max(0, (playCursorRef.current - ctx.currentTime) * 1000) + 250,
      );
    },
    [ensureOutCtx],
  );

  // Barge-in: kill everything scheduled, instantly.
  const flushPlayback = useCallback(() => {
    for (const src of sourcesRef.current) {
      try {
        src.stop();
      } catch {}
    }
    sourcesRef.current.clear();
    playCursorRef.current = 0;
    setSpeaking(false);
    musicDuckRef.current(false);
  }, []);

  const stop = useCallback(() => {
    flushPlayback();
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void inCtxRef.current?.close();
    inCtxRef.current = null;
    void outCtxRef.current?.close();
    outCtxRef.current = null;
    setMicActive(false);
  }, [flushPlayback]);

  // Music mixer registers here to duck under narration.
  const setDuckHandler = useCallback((fn: (speaking: boolean) => void) => {
    musicDuckRef.current = fn;
  }, []);

  return {
    startMic,
    playChunk,
    flushPlayback,
    stop,
    micActive,
    speaking,
    setDuckHandler,
    ensureOutCtx,
  };
}
