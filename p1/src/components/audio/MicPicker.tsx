"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import "../game/overlays.css";

interface MicPickerProps {
  /** Selected deviceId (null = system default). */
  value: string | null;
  /** Called with the chosen deviceId. "" means "System default". */
  onChange: (deviceId: string) => void;
  /** Live input level, 0..1 RMS (updates ~4x/s). */
  level: number;
  /** Pill + popover for the in-game HUD; full inline card otherwise. */
  compact?: boolean;
}

interface MicDevice {
  deviceId: string;
  label: string;
}

const SILENCE_THRESHOLD = 0.01;
const SILENCE_MS = 4000;
/** Sentinel used in the option list for "System default" (value === null). */
const DEFAULT_ID = "";

const GOLD = "var(--vn-gold)";
const GOLD_BRIGHT = "var(--vn-gold-bright)";
const PAPER = "var(--vn-paper)";
const EMBER = "var(--vn-ember)";
const BORDER = "rgba(217,179,108,0.22)";
const SURFACE =
  "linear-gradient(to top, rgba(10,9,7,0.94), rgba(14,12,9,0.88))";

/** Perceptual boost — speech RMS rarely exceeds ~0.3, so stretch the scale. */
function displayLevel(level: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, level)) * 1.35);
}

/** Enumerate audioinput devices; safe in SSR / insecure contexts (returns []). */
async function enumerateMics(): Promise<MicDevice[]> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return [];
  }
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const seen = new Set<string>();
    const inputs = all.filter((d) => {
      if (d.kind !== "audioinput") return false;
      // Chrome exposes "default" / "communications" pseudo-devices that
      // duplicate a physical mic; we render our own "System default" row.
      if (d.deviceId === "default" || d.deviceId === "communications") return false;
      // Dedupe repeated ids; keep empty-id placeholders (pre-permission).
      if (d.deviceId) {
        if (seen.has(d.deviceId)) return false;
        seen.add(d.deviceId);
      }
      return true;
    });
    return inputs.map((d, i) => ({
      deviceId: d.deviceId,
      // Labels are empty until mic permission is granted.
      label: d.label || `Microphone ${i + 1}`,
    }));
  } catch {
    return [];
  }
}

function MicIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  );
}

/** Full-width horizontal level bar, amber fill, smoothed via CSS transition. */
function LevelMeter({ level }: { level: number }) {
  const pct = displayLevel(level) * 100;
  return (
    <div
      role="img"
      aria-label={`Input level ${Math.round(pct)}%`}
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: "rgba(242,232,213,0.1)" }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: `linear-gradient(to right, ${GOLD}, ${GOLD_BRIGHT})`,
          boxShadow: pct > 4 ? "0 0 6px rgba(217,179,108,0.5)" : "none",
          transition: "width 240ms linear",
        }}
      />
    </div>
  );
}

/** Mini 3-bar meter for the compact pill. */
function MiniMeter({ level }: { level: number }) {
  const d = displayLevel(level);
  const bars = [
    { h: 5, on: d > 0.12 },
    { h: 9, on: d > 0.42 },
    { h: 13, on: d > 0.72 },
  ];
  return (
    <span className="flex items-end gap-[3px]" aria-hidden="true">
      {bars.map((b, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{
            height: b.h,
            background: b.on ? GOLD_BRIGHT : "rgba(242,232,213,0.2)",
            boxShadow: b.on ? "0 0 4px rgba(240,208,144,0.6)" : "none",
            transition: "background 200ms ease, box-shadow 200ms ease",
          }}
        />
      ))}
    </span>
  );
}

function SilenceWarning() {
  return (
    <p
      role="status"
      className="mt-2 flex items-center gap-1.5 text-[12px] leading-snug"
      style={{ color: EMBER, animation: "vn-fade-in 220ms ease-out both" }}
    >
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: EMBER, animation: "vn-breathe 1.4s ease-in-out infinite" }}
      />
      This mic looks silent — try another device.
    </p>
  );
}

interface DeviceListProps {
  devices: MicDevice[];
  value: string | null;
  onPick: (deviceId: string) => void;
  onDismiss: () => void;
  idPrefix: string;
}

/** Keyboard-accessible custom listbox (arrows / Home / End / Enter / Escape). */
function DeviceList({ devices, value, onPick, onDismiss, idPrefix }: DeviceListProps) {
  const options = useMemo<MicDevice[]>(
    () => [{ deviceId: DEFAULT_ID, label: "System default" }, ...devices],
    [devices],
  );
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) =>
      value === null || value === DEFAULT_ID
        ? o.deviceId === DEFAULT_ID
        : o.deviceId === value,
    ),
  );
  const [rawActive, setActive] = useState(selectedIndex);
  // Clamp in case the device list shrinks while open (devicechange).
  const active = Math.min(rawActive, options.length - 1);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive(Math.min(options.length - 1, active + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive(Math.max(0, active - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onPick(options[active].deviceId);
        break;
      case "Escape":
      case "Tab":
        e.preventDefault();
        onDismiss();
        break;
    }
  };

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Microphone"
      aria-activedescendant={`${idPrefix}-opt-${active}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="max-h-56 overflow-y-auto outline-none"
    >
      {options.map((opt, i) => {
        const selected = i === selectedIndex;
        const isActive = i === active;
        return (
          <li
            key={opt.deviceId || `default-${i}`}
            id={`${idPrefix}-opt-${i}`}
            role="option"
            aria-selected={selected}
            onPointerMove={() => setActive(i)}
            onClick={() => onPick(opt.deviceId)}
            className="flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] leading-snug"
            style={{
              color: selected ? GOLD_BRIGHT : PAPER,
              background: isActive ? "rgba(217,179,108,0.12)" : "transparent",
              transition: "background 120ms ease",
            }}
          >
            <span
              className="flex w-4 shrink-0 items-center justify-center"
              style={{ color: GOLD, opacity: selected ? 1 : 0 }}
            >
              <CheckIcon />
            </span>
            <span className="truncate">{opt.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function MicPicker({ value, onChange, level, compact = false }: MicPickerProps) {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [open, setOpen] = useState(false);
  const [silent, setSilent] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const levelRef = useRef(level);
  const alive = useRef(true);
  const idPrefix = useId();

  // ---- device enumeration -------------------------------------------------

  const refreshDevices = useCallback(() => {
    void enumerateMics().then((list) => {
      if (alive.current) setDevices(list);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    refreshDevices();
    const md =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    md?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      alive.current = false;
      md?.removeEventListener?.("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  // Re-enumerate when the list opens (labels may have appeared post-permission).
  useEffect(() => {
    if (open) refreshDevices();
  }, [open, refreshDevices]);

  // ---- silence detection --------------------------------------------------

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    let silentMs = 0;
    const tick = window.setInterval(() => {
      if (levelRef.current >= SILENCE_THRESHOLD) {
        silentMs = 0;
        setSilent(false); // no-op re-render when already false
      } else {
        silentMs += 500;
        if (silentMs >= SILENCE_MS) setSilent(true);
      }
    }, 500);
    return () => window.clearInterval(tick);
  }, []);

  // ---- popover dismissal --------------------------------------------------

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const dismiss = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const pick = useCallback(
    (deviceId: string) => {
      onChange(deviceId);
      dismiss();
    },
    [onChange, dismiss],
  );

  const selectedLabel =
    value === null || value === DEFAULT_ID
      ? "System default"
      : devices.find((d) => d.deviceId === value)?.label ?? "Unavailable microphone";

  const popoverStyle: React.CSSProperties = {
    background: SURFACE,
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
    animation: "vn-rise-in 200ms ease-out both",
  };

  // ---- compact: pill + popover ---------------------------------------------

  if (compact) {
    return (
      <div ref={rootRef} className="vn relative inline-block">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Microphone: ${selectedLabel}`}
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 items-center gap-2 rounded-full border px-3 active:scale-95"
          style={{
            borderColor: silent ? "rgba(255,122,74,0.5)" : BORDER,
            background: "rgba(10,9,7,0.75)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            color: GOLD,
            transition: "border-color 200ms ease, transform 100ms",
            touchAction: "manipulation",
          }}
        >
          <MicIcon />
          <MiniMeter level={level} />
        </button>

        {open && (
          <div
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border p-2"
            style={{ ...popoverStyle, borderColor: BORDER }}
          >
            <div className="vn-kicker px-2 pb-1.5 pt-1">Microphone</div>
            <DeviceList
              devices={devices}
              value={value}
              onPick={pick}
              onDismiss={dismiss}
              idPrefix={idPrefix}
            />
            <div className="px-2 pb-1.5 pt-2.5">
              <LevelMeter level={level} />
              {silent && <SilenceWarning />}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- full: inline card ----------------------------------------------------

  return (
    <div
      ref={rootRef}
      className="vn relative w-full max-w-sm rounded-2xl border p-4"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <div className="vn-kicker pb-2.5">Microphone</div>

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border px-3.5 py-2 text-left text-[14px] active:scale-[0.99]"
        style={{
          borderColor: open ? "rgba(217,179,108,0.55)" : "rgba(242,232,213,0.14)",
          background: "rgba(242,232,213,0.05)",
          color: PAPER,
          transition: "border-color 150ms ease, transform 100ms",
          touchAction: "manipulation",
        }}
      >
        <span className="shrink-0" style={{ color: GOLD }}>
          <MicIcon />
        </span>
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <span
          aria-hidden="true"
          className="shrink-0 text-[10px]"
          style={{
            color: GOLD,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 180ms ease",
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          className="absolute left-4 right-4 z-50 mt-1.5 rounded-xl border p-1.5"
          style={{ ...popoverStyle, borderColor: "rgba(217,179,108,0.35)" }}
        >
          <DeviceList
            devices={devices}
            value={value}
            onPick={pick}
            onDismiss={dismiss}
            idPrefix={idPrefix}
          />
        </div>
      )}

      <div className="pt-3.5">
        <LevelMeter level={level} />
      </div>
      {silent && <SilenceWarning />}
    </div>
  );
}
