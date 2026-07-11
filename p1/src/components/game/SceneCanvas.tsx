"use client";

import { useEffect, useRef, useState } from "react";
import type { Mood } from "@/lib/storyEngine/types";
import "./overlays.css";

interface SceneCanvasProps {
  imageUrl: string | null;
  caption: string;
  // who is talking right now: null/undefined = the narrator, else a
  // character name rendered as a chip above the line
  speaker?: string | null;
  mood?: Mood;
  generating?: boolean;
}

interface Layer {
  url: string;
  key: number;
  kenBurns: "a" | "b"; // alternate pan direction per image
}

/** Translucent color grade per mood, layered over the image. */
const MOOD_TINT: Record<Mood, string> = {
  intro: "linear-gradient(to top, rgba(20,16,30,0.25), transparent 60%)",
  explore: "linear-gradient(to top, rgba(16,22,20,0.2), transparent 60%)",
  calm: "linear-gradient(to top, rgba(12,24,38,0.28), transparent 55%)",
  tense: "radial-gradient(ellipse at 50% 60%, transparent 40%, rgba(90,10,10,0.3) 100%)",
  combat: "radial-gradient(ellipse at 50% 55%, transparent 30%, rgba(120,12,8,0.4) 100%)",
  tragic: "linear-gradient(to top, rgba(10,10,14,0.5), rgba(30,30,38,0.18) 70%)",
  triumphant: "linear-gradient(to top, rgba(70,48,10,0.28), transparent 55%)",
  item_closeup: "radial-gradient(ellipse at 50% 45%, transparent 35%, rgba(50,35,8,0.45) 100%)",
};

export default function SceneCanvas({ imageUrl, caption, speaker, mood, generating }: SceneCanvasProps) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const counterRef = useRef(0);

  // push a new layer whenever a fresh imageUrl arrives; keep the previous
  // one mounted underneath so the new image crossfades in over it.
  useEffect(() => {
    if (!imageUrl) return;
    setLayers((prev) => {
      if (prev.length && prev[prev.length - 1].url === imageUrl) return prev;
      counterRef.current += 1;
      const next: Layer = {
        url: imageUrl,
        key: counterRef.current,
        kenBurns: counterRef.current % 2 === 0 ? "a" : "b",
      };
      return [...prev.slice(-1), next]; // at most 2 mounted at once
    });
  }, [imageUrl]);

  const waiting = Boolean(generating); // shimmer while the next shot renders

  return (
    <div className="vn relative h-full w-full overflow-hidden bg-[#080706]" style={{ minHeight: "100dvh" }}>
      {/* empty-stage placeholder */}
      {layers.length === 0 && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, #1a1610 0%, #0b0a08 70%)",
          }}
        />
      )}

      {/* image stack: previous stays put, newest fades in over 700ms */}
      {layers.map((layer, i) => (
        <div
          key={layer.key}
          className="absolute inset-0"
          style={{
            animation:
              i === layers.length - 1 && layers.length > 1
                ? "vn-fade-in 700ms ease-out both"
                : undefined,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={layer.url}
            alt=""
            className="h-full w-full object-cover"
            style={{
              animation: `${layer.kenBurns === "a" ? "vn-kb-a" : "vn-kb-b"} 24s linear both`,
              willChange: "transform",
            }}
            draggable={false}
          />
        </div>
      ))}

      {/* subtle pulse over the held frame while the next one generates */}
      {waiting && (
        <div
          className="absolute inset-0"
          style={{
            background: "rgba(11,10,8,0.25)",
            animation: "vn-breathe 1.8s ease-in-out infinite",
          }}
        />
      )}

      {/* mood grade */}
      {mood && <div className="absolute inset-0 pointer-events-none" style={{ background: MOOD_TINT[mood] }} />}

      <div className="vn-vignette" />
      <div className="vn-grain" />

      {/* shimmer bar — "the artist is painting" */}
      {waiting && (
        <div className="absolute left-1/2 top-5 h-[3px] w-40 -translate-x-1/2 overflow-hidden rounded-full bg-[rgba(242,232,213,0.12)]">
          <div
            className="h-full w-1/3 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--vn-gold-bright), transparent)",
              animation: "vn-shimmer 1.1s ease-in-out infinite",
              willChange: "transform",
            }}
          />
        </div>
      )}

      {/* lower-third subtitles — fixed-height, bottom-anchored so the newest
          words are always visible and growing text never shifts the layout.
          No key on the text node: it must update in place, not remount. */}
      {caption && (
        <div
          className="absolute inset-x-0 bottom-0 flex justify-center px-5 pb-8 pt-24 pointer-events-none"
          style={{
            background:
              "linear-gradient(to top, rgba(6,5,4,0.82) 0%, rgba(6,5,4,0.5) 55%, transparent 100%)",
            animation: "vn-rise-in 450ms ease-out both",
          }}
        >
          <div
            className="max-w-xl w-full flex flex-col justify-end items-center overflow-hidden"
            style={{ height: "7.6em" }}
          >
            {speaker && (
              <span
                className="mb-1 rounded-full border px-3 py-0.5 text-[11px] tracking-[0.2em] uppercase"
                style={{
                  color: "var(--vn-gold-bright, #f0d090)",
                  borderColor: "rgba(217,179,108,0.5)",
                  background: "rgba(0,0,0,0.55)",
                }}
              >
                {speaker}
              </span>
            )}
            <p
              className="text-center text-[17px] leading-relaxed sm:text-lg"
              style={{
                fontFamily: "var(--vn-font-display)",
                color: "var(--vn-paper)",
                textShadow: "0 1px 8px rgba(0,0,0,0.9)",
                fontStyle: speaker ? "italic" : "normal",
              }}
            >
              {caption}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
