"use client";

// ArtifactFrame — displays a UI-Smith HTML artifact (wanted poster, letter,
// terminal screen…) inside a fully sandboxed iframe: sandbox="" means no
// scripts, no same-origin access, no navigation. Paper-drop entrance.

import "@/components/game/overlays.css";
import "./genui.css";

interface ArtifactFrameProps {
  html: string;
  onClose: () => void;
}

export default function ArtifactFrame({ html, onClose }: ArtifactFrameProps) {
  const valid = typeof html === "string" && html.trim().length > 0 && html.includes("<");

  return (
    <div className="vn">
      <div className="gu-backdrop" onClick={onClose} aria-hidden />
      <div className="gu-artifact-wrap" onClick={onClose}>
        <div
          className="gu-artifact"
          role="dialog"
          aria-modal="true"
          aria-label="Story artifact"
          onClick={(e) => e.stopPropagation()}
        >
          {valid ? (
            <iframe sandbox="" srcDoc={html} title="Story artifact" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <span style={{ color: "var(--vn-gold)", fontSize: 24 }}>✦</span>
              <p className="text-lg" style={{ color: "var(--vn-paper)" }}>
                The page is blank.
              </p>
              <p className="text-sm italic" style={{ color: "rgba(242,232,213,0.55)" }}>
                Whatever was written here has faded beyond recovery.
              </p>
            </div>
          )}

          <button
            type="button"
            className="gu-close"
            onClick={onClose}
            aria-label="Close artifact"
            style={{ position: "absolute", top: 12, right: 12 }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
