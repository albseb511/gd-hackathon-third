"use client";

import { useState } from "react";
import { flyTo } from "./cameraBus";
import { recordWalkthrough } from "./walkthrough";
import { VIEW_IDS } from "./camera-rig";
import { useView } from "./viewStore";

export function ViewportToolbar() {
  const [rec, setRec] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const xray = useView((s) => s.xray);
  const showLabels = useView((s) => s.showLabels);
  const toggleXray = useView((s) => s.toggleXray);
  const toggleLabels = useView((s) => s.toggleLabels);

  async function record() {
    setRec(true);
    setVideoUrl(null);
    try {
      const blob = await recordWalkthrough(6000);
      if (blob) setVideoUrl(URL.createObjectURL(blob));
    } finally {
      setRec(false);
    }
  }

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 flex flex-col items-start gap-2">
      <div className="flex gap-1 rounded-lg border border-white/10 bg-black/50 p-1 backdrop-blur">
        {VIEW_IDS.map((v) => (
          <button
            key={v}
            onClick={() => flyTo(v)}
            className="rounded px-2 py-1 text-[11px] capitalize text-zinc-300 hover:bg-white/10"
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex gap-1 rounded-lg border border-white/10 bg-black/50 p-1 backdrop-blur">
        <button
          onClick={toggleXray}
          className={`rounded px-2 py-1 text-[11px] ${xray ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-white/10"}`}
        >
          X-ray walls
        </button>
        <button
          onClick={toggleLabels}
          className={`rounded px-2 py-1 text-[11px] ${showLabels ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-white/10"}`}
        >
          Labels
        </button>
      </div>
      <button
        onClick={record}
        disabled={rec}
        className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-zinc-200 backdrop-blur hover:bg-white/10 disabled:opacity-60"
      >
        {rec ? "● recording…" : "🎬 Record walkthrough"}
      </button>
      {videoUrl && (
        <a
          href={videoUrl}
          download="atelier-walkthrough.webm"
          className="rounded-lg border border-emerald-500/40 bg-black/50 px-3 py-1.5 text-xs text-emerald-300 backdrop-blur"
        >
          ↓ download walkthrough
        </a>
      )}
    </div>
  );
}
