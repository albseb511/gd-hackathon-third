"use client";

// Bridge to read the live WebGL canvas as an image (NB2 reskin structural guide).
// Works because the Canvas is created with preserveDrawingBuffer: true.
let canvasEl: HTMLCanvasElement | null = null;

export function registerCanvas(el: HTMLCanvasElement | null) {
  canvasEl = el;
}

export function captureViewport(maxEdge = 1280): string | null {
  if (!canvasEl || canvasEl.width === 0) return null;
  const scale = Math.min(1, maxEdge / Math.max(canvasEl.width, canvasEl.height));
  const off = document.createElement("canvas");
  off.width = Math.round(canvasEl.width * scale);
  off.height = Math.round(canvasEl.height * scale);
  const ctx = off.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvasEl, 0, 0, off.width, off.height);
  return off.toDataURL("image/jpeg", 0.92);
}
