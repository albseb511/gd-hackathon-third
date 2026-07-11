"use client";

// Webcam capture for the character forge — desktop-first: pick any connected
// camera (like Meet), live preview, snap a frame. Returns a JPEG blob.

import { useCallback, useEffect, useRef, useState } from "react";
import "@/components/game/overlays.css";

interface CameraDevice {
  deviceId: string;
  label: string;
}

export default function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const start = useCallback(async (id: string | null) => {
    setReady(false);
    setError(null);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(id ? { deviceId: { exact: id } } : { facingMode: "user" }),
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
      // labels only populate after permission — refresh the list now
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((d) => d.kind === "videoinput" && d.deviceId && d.deviceId !== "default")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
          })),
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Camera permission was blocked — allow it in your browser settings."
          : "Could not open that camera. Try another device.",
      );
    }
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => void start(null));
    return () => {
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [start]);

  const snap = useCallback(() => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d")!;
    // center-crop square, mirrored back to natural orientation
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      video,
      (video.videoWidth - size) / 2,
      (video.videoHeight - size) / 2,
      size,
      size,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
      },
      "image/jpeg",
      0.88,
    );
  }, [onCapture, ready]);

  return (
    <div
      className="vn fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm p-6"
      style={{ animation: "vn-fade-in 200ms ease-out both" }}
    >
      <div className="w-full max-w-md">
        <div
          className="relative overflow-hidden rounded-2xl border"
          style={{ borderColor: "rgba(217,179,108,0.4)", aspectRatio: "1 / 1" }}
        >
          {/* mirrored preview feels natural, capture un-mirrors */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 animate-pulse">
              opening camera…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-rose-300 text-sm">
              {error}
            </div>
          )}
        </div>

        {devices.length > 1 && (
          <select
            className="mt-3 w-full rounded-lg border bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200"
            style={{ borderColor: "rgba(217,179,108,0.3)" }}
            value={deviceId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              setDeviceId(id);
              void start(id);
            }}
          >
            <option value="">Default camera</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}

        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            onClick={onClose}
            className="rounded-full border border-zinc-700 px-6 py-3 text-zinc-300 hover:text-zinc-100"
          >
            cancel
          </button>
          <button
            onClick={snap}
            disabled={!ready}
            className="rounded-full border px-8 py-3 text-lg disabled:opacity-40"
            style={{
              borderColor: "rgba(217,179,108,0.6)",
              color: "var(--vn-gold-bright, #f0d090)",
            }}
          >
            ◉ capture
          </button>
        </div>
      </div>
    </div>
  );
}
