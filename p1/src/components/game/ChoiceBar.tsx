"use client";

import { useEffect, useRef, useState } from "react";
import "./overlays.css";

interface ChoiceBarProps {
  options: string[];
  visible: boolean;
  onChoose(option: string): void;
  onFreeText(text: string): void;
  listening?: boolean;
}

export default function ChoiceBar({
  options,
  visible,
  onChoose,
  onFreeText,
  listening,
}: ChoiceBarProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = options.slice(0, 4);

  const onChooseRef = useRef(onChoose);
  const shownRef = useRef(shown);
  useEffect(() => {
    onChooseRef.current = onChoose;
    shownRef.current = shown;
  });

  // keyboard shortcuts 1-4 (ignored while typing in the free-text field)
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= shownRef.current.length) {
        e.preventDefault();
        onChooseRef.current(shownRef.current[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const submitText = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onFreeText(trimmed);
    setText("");
    inputRef.current?.blur();
  };

  return (
    <div
      className="vn fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]"
      style={{
        transform: visible ? "translate3d(0,0,0)" : "translate3d(0,115%,0)",
        opacity: visible ? 1 : 0,
        transition: "transform 320ms cubic-bezier(0.3,1.1,0.4,1), opacity 260ms ease",
        pointerEvents: visible ? "auto" : "none",
        willChange: "transform, opacity",
      }}
      aria-hidden={!visible}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[rgba(217,179,108,0.22)] p-3"
        style={{
          background: "linear-gradient(to top, rgba(10,9,7,0.92), rgba(14,12,9,0.82))",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* choices, staggered in */}
        <div className="flex flex-col gap-2">
          {visible &&
            shown.map((opt, i) => (
              <button
                key={`${i}-${opt}`}
                type="button"
                onClick={() => onChoose(opt)}
                className="group flex min-h-[52px] items-center gap-3 rounded-xl border border-[rgba(242,232,213,0.14)] px-4 py-2.5 text-left active:scale-[0.985]"
                style={{
                  animation: `vn-rise-in 360ms ease-out both`,
                  animationDelay: `${i * 70}ms`,
                  background: "rgba(242,232,213,0.05)",
                  transition: "transform 120ms, border-color 150ms",
                  touchAction: "manipulation",
                }}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] tabular-nums"
                  style={{ borderColor: "rgba(217,179,108,0.5)", color: "var(--vn-gold)" }}
                >
                  {i + 1}
                </span>
                <span
                  className="text-[15px] leading-snug"
                  style={{ fontFamily: "var(--vn-font-display)", color: "var(--vn-paper)" }}
                >
                  {opt}
                </span>
              </button>
            ))}
        </div>

        {/* free text + mic */}
        <div className="mt-2.5 flex items-center gap-2">
          {listening && (
            <div className="relative ml-1 flex h-8 w-8 shrink-0 items-center justify-center" aria-label="listening">
              <span
                className="absolute h-3 w-3 rounded-full"
                style={{ background: "var(--vn-ember)", animation: "vn-mic-ring 1.3s ease-out infinite" }}
              />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--vn-ember)" }} />
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitText();
              }
            }}
            placeholder={listening ? "listening… or type your move" : "or write your own move…"}
            className="min-h-[44px] w-full rounded-xl border border-[rgba(242,232,213,0.14)] bg-[rgba(242,232,213,0.05)] px-4 text-[15px] outline-none placeholder:text-[rgba(242,232,213,0.35)] focus:border-[rgba(217,179,108,0.55)]"
            style={{ color: "var(--vn-paper)", fontFamily: "var(--vn-font-display)" }}
          />
          <button
            type="button"
            onClick={submitText}
            disabled={!text.trim()}
            aria-label="send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border active:scale-95"
            style={{
              borderColor: text.trim() ? "rgba(217,179,108,0.6)" : "rgba(242,232,213,0.12)",
              color: text.trim() ? "var(--vn-gold-bright)" : "rgba(242,232,213,0.3)",
              background: "rgba(242,232,213,0.05)",
              transition: "color 150ms, border-color 150ms, transform 100ms",
              touchAction: "manipulation",
            }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
