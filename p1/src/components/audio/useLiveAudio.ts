"use client";

import { useCallback, useRef, useState } from "react";

// Mic capture only: getUserMedia (specific device supported) → AudioWorklet →
// 16kHz PCM16 chunks → onChunk (base64). Playback lives in PresentationQueue.
export function useLiveAudio() {
  const inCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const onChunkRef = useRef<((b64: string) => void) | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const acquire = useCallback(async (deviceId: string | null) => {
    const base = {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    };
    // Prefer the saved device, but a stale/removed id makes getUserMedia throw
    // (OverconstrainedError) or hand back a dead track — never let that leave
    // the player with a silent mic. Fall back to the system default.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base,
      });
    } catch (e) {
      if (!deviceId) throw e;
      stream = await navigator.mediaDevices.getUserMedia({ audio: base });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = stream;

    const ctx = inCtxRef.current ?? new AudioContext();
    inCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    if (!workletRef.current) {
      await ctx.audioWorklet.addModule("/worklets/pcm-processor.js");
      const node = new AudioWorkletNode(ctx, "pcm-processor");
      workletRef.current = node;
      node.port.onmessage = (
        e: MessageEvent<ArrayBuffer | { level: number }>,
      ) => {
        if (e.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(e.data);
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          onChunkRef.current?.(btoa(bin));
        } else if (typeof e.data?.level === "number") {
          setMicLevel(e.data.level);
        }
      };
      const silent = ctx.createGain();
      silent.gain.value = 0;
      node.connect(silent).connect(ctx.destination);
    }
    // (re)wire the source — disconnect any previous one first
    const node = workletRef.current;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(node);
    setMicActive(true);
    setMicError(null);
  }, []);

  // Must be called from a user gesture (iOS requirement).
  const startMic = useCallback(
    async (onChunk: (base64Pcm16k: string) => void, deviceId?: string | null) => {
      onChunkRef.current = onChunk;
      deviceIdRef.current = deviceId ?? null;
      try {
        await acquire(deviceIdRef.current);
      } catch (e) {
        setMicError(e instanceof Error ? e.message : "microphone unavailable");
        throw e;
      }
    },
    [acquire],
  );

  // Live-switch input device without dropping the session.
  const switchDevice = useCallback(
    async (deviceId: string | null) => {
      deviceIdRef.current = deviceId;
      if (!micActive) return;
      try {
        await acquire(deviceId);
      } catch (e) {
        setMicError(e instanceof Error ? e.message : "could not switch microphone");
      }
    },
    [acquire, micActive],
  );

  const stop = useCallback(() => {
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void inCtxRef.current?.close();
    inCtxRef.current = null;
    onChunkRef.current = null;
    setMicActive(false);
    setMicLevel(0);
  }, []);

  return { startMic, switchDevice, stop, micActive, micLevel, micError };
}
