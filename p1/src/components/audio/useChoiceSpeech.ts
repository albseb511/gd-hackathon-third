"use client";

// Voice input for the SCRIPTED stage — no Live session, no Gemini cost.
// Uses the browser's built-in Web Speech API (webkitSpeechRecognition) to
// transcribe the player speaking their choice, then matches the transcript
// against the on-screen choice labels and fires it. Falls back silently
// (tap/type still works) on browsers without the API.

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the vendor-prefixed Web Speech API.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "to", "and", "of", "i", "my", "me", "you", "it",
  "is", "on", "in", "at", "for", "with", "go", "lets", "let", "will",
  "want", "choose", "pick", "option", "them", "him", "her", "this", "that",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// ordinal / number words -> 1-based choice index
const ORDINALS: Record<string, number> = {
  one: 1, first: 1, "1st": 1,
  two: 2, second: 2, "2nd": 2,
  three: 3, third: 3, "3rd": 3,
  four: 4, fourth: 4, "4th": 4,
};

// Best-effort match of a spoken phrase to one of the choice labels.
// Returns the matched label, or null if nothing scores well enough.
export function matchChoice(heard: string, options: string[]): string | null {
  if (!options.length) return null;
  const words = heard.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);

  // explicit "option two" / "the second one" / bare number
  for (const w of words) {
    const n = ORDINALS[w] ?? (/^[1-4]$/.test(w) ? Number(w) : 0);
    if (n >= 1 && n <= options.length) return options[n - 1];
  }

  // token-overlap scoring against each label
  const heardTokens = new Set(tokenize(heard));
  if (!heardTokens.size) return null;
  let best = -1;
  let bestScore = 0;
  options.forEach((opt, i) => {
    const optTokens = tokenize(opt);
    if (!optTokens.length) return;
    const hits = optTokens.filter((t) => heardTokens.has(t)).length;
    // normalise by label length so short labels aren't unfairly favoured
    const score = hits / Math.sqrt(optTokens.length);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  // require at least one real keyword overlap
  return bestScore > 0 ? options[best] : null;
}

export function useChoiceSpeech(
  active: boolean,
  options: string[],
  onPick: (label: string) => void,
) {
  const [supported] = useState(() => !!getCtor());
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const optionsRef = useRef(options);
  const onPickRef = useRef(onPick);
  const activeRef = useRef(active);
  useEffect(() => {
    optionsRef.current = options;
    onPickRef.current = onPick;
    activeRef.current = active;
  });

  useEffect(() => {
    const Ctor = getCtor();
    if (!Ctor || !active || !options.length) return;

    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    let done = false;

    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript;
        if (r.isFinal) {
          const hit = matchChoice(t, optionsRef.current);
          if (hit && !done) {
            done = true;
            setHeard(hit);
            onPickRef.current(hit);
            try { rec.stop(); } catch { /* noop */ }
            return;
          }
        } else {
          interim += t;
        }
      }
      if (interim) setHeard(interim.trim());
    };
    rec.onerror = () => { /* mic denied / no-speech — tap still works */ };
    rec.onend = () => {
      setListening(false);
      // keep listening while choices are still up and we haven't picked
      if (!done && activeRef.current && optionsRef.current.length) {
        try { rec.start(); } catch { /* noop */ }
      }
    };

    try {
      rec.start();
    } catch {
      /* onstart won't fire — listening stays false, tap/type still works */
    }

    return () => {
      done = true;
      setListening(false);
      setHeard("");
      try { rec.abort(); } catch { /* noop */ }
      recRef.current = null;
    };
  }, [active, options.length]);

  const stop = useCallback(() => {
    try { recRef.current?.abort(); } catch { /* noop */ }
    setListening(false);
  }, []);

  return { supported, listening, heard, stop };
}
