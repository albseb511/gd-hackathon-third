"use client";

// Records an in-engine walkthrough: captures the WebGL canvas stream while the
// camera orbits the room once, returning a webm Blob. No external API.
import { getCanvas } from "./capture";
import { getControls } from "./cameraBus";

function pickMime(): string {
  const opts = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const m of opts) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  return "video/webm";
}

export async function recordWalkthrough(ms = 6000): Promise<Blob | null> {
  const canvas = getCanvas();
  const controls = getControls();
  if (!canvas || !controls) return null;

  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: pickMime() });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  return new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
    rec.start();

    let last = performance.now();
    const start = last;
    const step = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // Orbit a full turn over the duration.
      controls.rotate((2 * Math.PI * dt) / ms, 0, false);
      if (now - start < ms) requestAnimationFrame(step);
      else rec.stop();
    };
    requestAnimationFrame(step);
  });
}
