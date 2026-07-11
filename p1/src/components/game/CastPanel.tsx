"use client";

// CastPanel — a "who's who" roster the player glances at mid-scene. A left-side
// slide-in on desktop, a bottom sheet on phones. Characters currently in the
// scene float to the top, brighter and amber-ringed; the rest sit dimmed below.
// Pure presentation: everything is derived from props, no fetching beyond <img>.

import "./overlays.css";

interface CastMember {
  name: string;
  role: string;
  visualDescription?: string;
}

interface CastPanelProps {
  characters: CastMember[]; // full story cast
  portraits: Record<string, string>; // character name -> asset id (may be missing entries)
  inView: string[]; // names of characters currently in the scene
  open: boolean;
  onClose: () => void;
}

const GOLD_LINE = "rgba(217,179,108,0.22)";

function initialOf(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : "?";
}

function CastRow({
  member,
  assetId,
  active,
}: {
  member: CastMember;
  assetId: string | undefined;
  active: boolean;
}) {
  return (
    <li
      className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
      style={{
        borderColor: active ? "rgba(240,208,144,0.5)" : "rgba(242,232,213,0.1)",
        background: active ? "rgba(217,179,108,0.08)" : "rgba(242,232,213,0.03)",
        boxShadow: active ? "0 0 18px rgba(217,179,108,0.22)" : "none",
        opacity: active ? 1 : 0.62,
        transition: "opacity 200ms ease, border-color 200ms ease, background 200ms ease",
      }}
    >
      {/* portrait or letter-medallion fallback */}
      <div
        className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border"
        style={{
          borderColor: active ? "rgba(240,208,144,0.7)" : GOLD_LINE,
          background: "linear-gradient(180deg, #1c1610 0%, #0e0b07 100%)",
          boxShadow: active ? "0 0 0 2px rgba(240,208,144,0.35)" : "none",
        }}
      >
        {assetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/assets/${assetId}`}
            alt={member.name}
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="text-lg"
            style={{
              fontFamily: "var(--vn-font-display)",
              color: "var(--vn-gold-bright)",
            }}
          >
            {initialOf(member.name)}
          </span>
        )}
      </div>

      {/* name / role / description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="truncate text-[15px] leading-tight"
            style={{ fontFamily: "var(--vn-font-display)", color: "var(--vn-paper)" }}
          >
            {member.name}
          </span>
          {active && (
            <span
              className="shrink-0 rounded-full border px-1.5 py-[1px] text-[9px] uppercase tracking-[0.14em]"
              style={{
                borderColor: "rgba(240,208,144,0.55)",
                color: "var(--vn-gold-bright)",
                background: "rgba(217,179,108,0.12)",
              }}
            >
              in scene
            </span>
          )}
        </div>
        <p
          className="truncate text-[12px] leading-tight"
          style={{ color: "var(--vn-gold)", opacity: 0.85 }}
        >
          {member.role}
        </p>
        {member.visualDescription && (
          <p
            className="truncate text-[11px] italic leading-tight"
            style={{ color: "rgba(242,232,213,0.45)" }}
          >
            {member.visualDescription}
          </p>
        )}
      </div>
    </li>
  );
}

export default function CastPanel({
  characters,
  portraits,
  inView,
  open,
  onClose,
}: CastPanelProps) {
  // derived-only: partition into in-scene (first, bright) and the rest (dimmed),
  // preserving the story's cast order within each tier.
  const present = new Set(inView);
  const active = characters.filter((c) => present.has(c.name));
  const resting = characters.filter((c) => !present.has(c.name));

  const isEmpty = characters.length === 0;

  return (
    <div className="vn" aria-hidden={!open}>
      {/* backdrop dim — click to close */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[55]"
        style={{
          background: "var(--vn-scrim)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 240ms ease",
        }}
      />

      {/* the panel: left drawer on desktop, bottom sheet on <640px */}
      <aside
        role="dialog"
        aria-label="The cast"
        className={[
          "fixed z-[56] flex flex-col",
          // mobile: bottom sheet, capped height, never full-screen
          "inset-x-0 bottom-0 max-h-[62vh] rounded-t-2xl",
          // desktop: left drawer
          "sm:inset-y-0 sm:right-auto sm:left-0 sm:bottom-auto sm:h-full sm:max-h-none sm:w-[300px] sm:rounded-none sm:rounded-r-2xl",
        ].join(" ")}
        style={{
          background: "linear-gradient(180deg, rgba(14,12,9,0.96), rgba(10,9,7,0.98))",
          borderRight: "1px solid " + GOLD_LINE,
          borderTop: "1px solid " + GOLD_LINE,
          boxShadow: "0 0 60px rgba(0,0,0,0.6)",
          transform: open ? "translate3d(0,0,0)" : "var(--cast-closed, translate3d(-100%,0,0))",
          transition: "transform 340ms cubic-bezier(0.3,1.05,0.4,1)",
          willChange: "transform",
          paddingBottom: "env(safe-area-inset-bottom,0px)",
        }}
      >
        {/* per-breakpoint closed offset: slide down on mobile, left on desktop */}
        <style>{`
          @media (max-width: 639px) { aside[aria-label="The cast"] { --cast-closed: translate3d(0,110%,0); } }
        `}</style>

        {/* header */}
        <header
          className="flex items-center justify-between gap-3 px-4 pt-4 pb-3"
          style={{ borderBottom: "1px solid " + GOLD_LINE }}
        >
          <div className="min-w-0">
            <p className="vn-kicker">The Cast</p>
            <p
              className="mt-0.5 text-[12px]"
              style={{ color: "rgba(242,232,213,0.5)", fontVariantNumeric: "tabular-nums" }}
            >
              {isEmpty
                ? "—"
                : `${characters.length} ${characters.length === 1 ? "soul" : "souls"}` +
                  (active.length > 0 ? ` · ${active.length} in scene` : "")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cast"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-3xl leading-none active:scale-95"
            style={{
              borderColor: "rgba(217,179,108,0.35)",
              background: "rgba(16,13,8,0.8)",
              color: "rgba(242,232,213,0.75)",
              transition: "transform 100ms",
            }}
          >
            ×
          </button>
        </header>

        {/* roster */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {isEmpty ? (
            <p
              className="px-2 py-10 text-center text-[13px] italic"
              style={{ color: "rgba(242,232,213,0.45)" }}
            >
              the cast has yet to be forged
            </p>
          ) : (
            <>
              {active.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {active.map((m) => (
                    <CastRow key={m.name} member={m} assetId={portraits[m.name]} active />
                  ))}
                </ul>
              )}

              {active.length > 0 && resting.length > 0 && (
                <div className="my-3 flex items-center gap-2 px-1">
                  <span className="h-px flex-1" style={{ background: GOLD_LINE }} />
                  <span
                    className="text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: "rgba(242,232,213,0.35)" }}
                  >
                    elsewhere
                  </span>
                  <span className="h-px flex-1" style={{ background: GOLD_LINE }} />
                </div>
              )}

              {resting.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {resting.map((m) => (
                    <CastRow
                      key={m.name}
                      member={m}
                      assetId={portraits[m.name]}
                      active={false}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
