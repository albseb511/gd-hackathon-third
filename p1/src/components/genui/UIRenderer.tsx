"use client";

// UIRenderer — renders UI-Smith specs as an in-game sheet: right-side panel
// on desktop, bottom sheet on mobile. Zod-validates the spec on the way in
// and degrades to an elegant fallback card when the payload is malformed.

import { uiSpecSchema, type UiSpec } from "@/lib/uiSmith";
import "@/components/game/overlays.css";
import "./genui.css";

interface UIRendererProps {
  kind: string;
  spec: unknown;
  onClose: () => void;
}

// ---- shared bits -------------------------------------------------------------

function Pips({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <div className="flex gap-1.5" role="meter" aria-valuemin={0} aria-valuemax={5} aria-valuenow={filled}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`gu-pip${i < filled ? " on" : ""}`} />
      ))}
    </div>
  );
}

function Glyph({ text }: { text: string }) {
  return <span className="gu-glyph">{(text.trim()[0] ?? "?").toUpperCase()}</span>;
}

function Row({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="gu-row" style={{ animationDelay: `${80 + index * 55}ms` }}>
      {children}
    </div>
  );
}

const DIM = "rgba(242, 232, 213, 0.55)";
const HAIRLINE = "1px solid rgba(217, 179, 108, 0.18)";

// ---- per-kind renderers --------------------------------------------------------

function StatBlock({ spec }: { spec: Extract<UiSpec, { kind: "stat_block" }> }) {
  return (
    <div className="flex flex-col gap-5">
      {spec.stats.map((s, i) => (
        <Row key={s.label + i} index={i}>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm uppercase" style={{ letterSpacing: "0.22em" }}>
              {s.label}
            </span>
            <Pips value={s.value} />
          </div>
        </Row>
      ))}
      {spec.traits.length > 0 && (
        <Row index={spec.stats.length}>
          <div className="flex flex-wrap gap-2 pt-1">
            {spec.traits.map((t) => (
              <span
                key={t}
                className="rounded-full px-3 py-1 text-xs italic"
                style={{ border: HAIRLINE, color: "var(--vn-gold-bright)", background: "rgba(217,179,108,0.06)" }}
              >
                {t}
              </span>
            ))}
          </div>
        </Row>
      )}
      {spec.reputation && (
        <Row index={spec.stats.length + 1}>
          <p className="pt-2 text-sm italic leading-relaxed" style={{ color: DIM, borderTop: HAIRLINE, paddingTop: 14 }}>
            “{spec.reputation}”
          </p>
        </Row>
      )}
    </div>
  );
}

function InventoryGrid({ spec }: { spec: Extract<UiSpec, { kind: "inventory_grid" }> }) {
  if (spec.items.length === 0) {
    return <p className="text-sm italic" style={{ color: DIM }}>Your pockets are empty.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {spec.items.map((item, i) => (
        <Row key={item.name + i} index={i}>
          <div
            className="flex h-full flex-col items-center gap-2 rounded-lg px-3 py-4 text-center"
            style={{ border: HAIRLINE, background: "rgba(20, 16, 10, 0.6)" }}
            title={item.iconHint}
          >
            <Glyph text={item.name} />
            <span className="text-sm leading-tight">{item.name}</span>
            {item.note && (
              <span className="text-xs italic leading-snug" style={{ color: DIM }}>
                {item.note}
              </span>
            )}
          </div>
        </Row>
      ))}
    </div>
  );
}

function DialogueCard({ spec }: { spec: Extract<UiSpec, { kind: "dialogue_card" }> }) {
  return (
    <div className="flex flex-col gap-4">
      <Row index={0}>
        <div className="flex items-center gap-3">
          <Glyph text={spec.speaker} />
          <div>
            <p className="text-base">{spec.speaker}</p>
            {spec.portraitHint && (
              <p className="text-xs italic" style={{ color: DIM }}>
                {spec.portraitHint}
              </p>
            )}
          </div>
        </div>
      </Row>
      <div className="flex flex-col gap-3">
        {spec.lines.map((line, i) => (
          <Row key={i} index={i + 1}>
            <p
              className="rounded-lg px-4 py-3 text-[15px] leading-relaxed"
              style={{
                border: HAIRLINE,
                background: "rgba(20, 16, 10, 0.55)",
                borderTopLeftRadius: 2,
              }}
            >
              “{line}”
            </p>
          </Row>
        ))}
      </div>
    </div>
  );
}

function Journal({ spec }: { spec: Extract<UiSpec, { kind: "journal" }> }) {
  return (
    <div className="flex flex-col">
      {spec.entries.map((e, i) => (
        <Row key={e.heading + i} index={i}>
          <div className="py-4" style={{ borderTop: i === 0 ? "none" : HAIRLINE }}>
            <p className="vn-kicker">{e.heading}</p>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "rgba(242,232,213,0.85)" }}>
              {e.body}
            </p>
          </div>
        </Row>
      ))}
    </div>
  );
}

function MapPanel({ spec }: { spec: Extract<UiSpec, { kind: "map" }> }) {
  return (
    <div className="flex flex-col">
      {spec.places.map((p, i) => (
        <Row key={p.name + i} index={i}>
          <div className="flex gap-4">
            {/* route spine */}
            <div className="flex flex-col items-center">
              <span
                className="w-px flex-none"
                style={{
                  height: 10,
                  background: i === 0 ? "transparent" : "rgba(217,179,108,0.35)",
                }}
              />
              <span
                className={`gu-map-node${p.current ? " current" : p.visited ? " visited" : ""}`}
              />
              <span
                className="w-px flex-1"
                style={{
                  background:
                    i === spec.places.length - 1 ? "transparent" : "rgba(217,179,108,0.35)",
                }}
              />
            </div>
            <div className="pb-5 pt-1">
              <p
                className="text-[15px]"
                style={{
                  color: p.current ? "var(--vn-gold-bright)" : p.visited ? "var(--vn-paper)" : DIM,
                  letterSpacing: p.current ? "0.04em" : undefined,
                }}
              >
                {p.name}
                {p.current && (
                  <span className="ml-2 text-[10px] uppercase" style={{ letterSpacing: "0.25em", color: "var(--vn-gold)" }}>
                    you are here
                  </span>
                )}
              </p>
              {p.note && (
                <p className="mt-1 text-xs italic leading-snug" style={{ color: DIM }}>
                  {p.note}
                </p>
              )}
            </div>
          </div>
        </Row>
      ))}
    </div>
  );
}

function Shop({ spec }: { spec: Extract<UiSpec, { kind: "shop" }> }) {
  return (
    <div className="flex flex-col">
      <Row index={0}>
        <p className="pb-3 text-xs uppercase" style={{ letterSpacing: "0.25em", color: DIM }}>
          prices in {spec.currency}
        </p>
      </Row>
      {spec.items.map((item, i) => (
        <Row key={item.name + i} index={i + 1}>
          <div className="flex items-baseline gap-3 py-3.5" style={{ borderTop: HAIRLINE }}>
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">{item.name}</p>
              {item.note && (
                <p className="mt-0.5 text-xs italic leading-snug" style={{ color: DIM }}>
                  {item.note}
                </p>
              )}
            </div>
            <span
              className="flex-none text-base"
              style={{ color: "var(--vn-gold-bright)", fontVariantNumeric: "tabular-nums" }}
            >
              {item.price.toLocaleString()}
            </span>
          </div>
        </Row>
      ))}
    </div>
  );
}

// ---- fallback ------------------------------------------------------------------

function FallbackCard({ kind }: { kind: string }) {
  return (
    <div
      className="gu-row flex flex-col items-center gap-3 rounded-lg px-6 py-10 text-center"
      style={{ border: HAIRLINE, background: "rgba(20, 16, 10, 0.6)" }}
    >
      <span style={{ color: "var(--vn-gold)", fontSize: 22 }}>✦</span>
      <p className="text-base">The ink refuses to settle.</p>
      <p className="text-xs italic leading-relaxed" style={{ color: DIM }}>
        This {kind.replace(/_/g, " ")} could not be conjured. Close the panel and ask the storyteller again.
      </p>
    </div>
  );
}

// ---- shell -----------------------------------------------------------------------

const KIND_LABEL: Record<UiSpec["kind"], string> = {
  stat_block: "Character",
  inventory_grid: "Inventory",
  dialogue_card: "Dialogue",
  journal: "Journal",
  map: "The Road So Far",
  shop: "Wares",
};

export default function UIRenderer({ kind, spec, onClose }: UIRendererProps) {
  const parsed = uiSpecSchema.safeParse(
    spec && typeof spec === "object" ? { kind, ...(spec as object) } : spec,
  );

  let title: string;
  let body: React.ReactNode;

  if (!parsed.success) {
    title = "A torn page";
    body = <FallbackCard kind={kind} />;
  } else {
    const s = parsed.data;
    title =
      s.kind === "dialogue_card" ? s.speaker : s.title || KIND_LABEL[s.kind];
    body =
      s.kind === "stat_block" ? <StatBlock spec={s} /> :
      s.kind === "inventory_grid" ? <InventoryGrid spec={s} /> :
      s.kind === "dialogue_card" ? <DialogueCard spec={s} /> :
      s.kind === "journal" ? <Journal spec={s} /> :
      s.kind === "map" ? <MapPanel spec={s} /> :
      <Shop spec={s} />;
  }

  const kicker = parsed.success ? KIND_LABEL[parsed.data.kind] : "interlude";

  return (
    <div className="vn">
      <div className="gu-backdrop" onClick={onClose} aria-hidden />
      <aside className="gu-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-start justify-between gap-4 px-[22px] pb-4 pt-6">
          <div className="min-w-0">
            <p className="vn-kicker">{kicker}</p>
            <h2 className="mt-1.5 truncate text-2xl" style={{ color: "var(--vn-paper)" }}>
              {title}
            </h2>
          </div>
          <button type="button" className="gu-close" onClick={onClose} aria-label="Close panel">
            ✕
          </button>
        </header>
        <div
          aria-hidden
          className="mx-[22px] mb-5 h-px flex-none"
          style={{ background: "linear-gradient(to right, rgba(217,179,108,0.5), transparent)" }}
        />
        <div className="gu-panel-body">{body}</div>
      </aside>
    </div>
  );
}
