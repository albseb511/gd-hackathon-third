"use client";

import { useState } from "react";
import { useScene } from "@/scene/store";
import { captureViewport } from "@/components/viewport/capture";
import { LiveConsultant } from "@/components/live/LiveConsultant";
import { buildApartment, type ApartmentConfig } from "@/lib/apartment";

interface Task { agent: string; status: string; applied: number; dropped: number; ms: number; startOffsetMs: number; reasoning: string; error?: string }
interface Conflict { scope: string; winner: string; loser: string }
interface RenderItem { style: string; dataUrl?: string; error?: string }
interface CostLine { id: string; item: string; qty: number; unit: string; unitPrice: number; subtotal: number; source: string }
interface LabourLine { id: string; trade: string; hours: number; rate: number; subtotal: number }
interface Estimate { currency: string; region: string; materials: CostLine[]; labour: LabourLine[]; total: number; timeEstimateDays: number; subtotals: { materials: number; labour: number }; contingencyPct: number }

const QUICK = [
  "Cozy Scandinavian living room, 4×5m, reading nook",
  "Modern minimalist bedroom, warm oak, 3.5×4m",
  "Japandi home office with plants, 3×3m",
];
const RENDER_STYLES = [
  "warm scandinavian, natural daylight, photorealistic",
  "modern minimal, cool tones, soft shadows",
  "cozy evening, warm lamp light, photorealistic",
];
const REGIONS = ["Generic", "San Francisco, US", "London, UK", "Bangalore, IN", "Berlin, DE"];

function Stepper({
  label,
  value,
  suffix,
  onDec,
  onInc,
}: {
  label: string;
  value: number;
  suffix?: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 px-1.5 py-0.5 text-zinc-300">
      <span className="text-zinc-500">{label}</span>
      <button onClick={onDec} className="px-1 text-zinc-400 hover:text-white">−</button>
      <span className="min-w-4 text-center tabular-nums">{value}{suffix}</span>
      <button onClick={onInc} className="px-1 text-zinc-400 hover:text-white">+</button>
    </div>
  );
}

export function ControlPanel() {
  const design = useScene((s) => s.design);
  const load = useScene((s) => s.load);
  const undo = useScene((s) => s.undo);
  const redo = useScene((s) => s.redo);
  const reset = useScene((s) => s.reset);

  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState<null | "design" | "render" | "cost" | "photo">(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [apt, setApt] = useState<ApartmentConfig | null>(null);
  const [renders, setRenders] = useState<RenderItem[]>([]);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [region, setRegion] = useState("Generic");

  async function runDesign(g: string) {
    if (!g.trim() || busy) return;
    setBusy("design");
    setTasks([]); setConflicts([]);
    try {
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: g, design }),
      });
      const data = await res.json();
      if (data.design) load(data.design);
      setTasks(data.tasks ?? []);
      setConflicts(data.conflicts ?? []);
      setApt(data.apartmentConfig ?? null);
    } finally {
      setBusy(null);
    }
  }

  // Editing an assumption rebuilds the apartment instantly (buildApartment is pure).
  function updateApt(patch: Partial<ApartmentConfig>) {
    if (!apt) return;
    const next = { ...apt, ...patch };
    setApt(next);
    load(buildApartment(next));
  }

  function fileToDataUrl(f: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(f);
    });
  }

  async function onPhotos(files: FileList | null) {
    if (!files || !files.length || busy) return;
    setBusy("photo");
    try {
      const images = await Promise.all(Array.from(files).slice(0, 4).map(fileToDataUrl));
      const res = await fetch("/api/photo-to-3d", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (data.design) load(data.design);
    } finally {
      setBusy(null);
    }
  }

  async function makePhotoreal() {
    if (busy) return;
    const image = captureViewport();
    setBusy("render"); setRenders([]);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image, styles: RENDER_STYLES, prompt: `A ${design.style.philosophy} interior. ${design.style.mood} mood.` }),
      });
      const data = await res.json();
      setRenders(data.renders ?? []);
    } finally {
      setBusy(null);
    }
  }

  async function estimateCost(r = region) {
    if (busy) return;
    setBusy("cost");
    try {
      const res = await fetch("/api/cost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ design, region: r }),
      });
      setEstimate(await res.json());
    } finally {
      setBusy(null);
    }
  }

  const money = (n: number, ccy: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);

  return (
    <div className="flex h-full w-[360px] flex-col gap-3 overflow-y-auto border-l border-white/10 bg-[#111318]/95 p-4 text-zinc-200 backdrop-blur">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Atelier</h2>
        <p className="text-xs text-zinc-500">
          {design.room.dims.w}×{design.room.dims.d}m · {design.furniture.length} items · {design.style.philosophy}
        </p>
      </div>

      <LiveConsultant />

      {/* Text-driven multi-agent design */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <label className="text-xs font-medium text-zinc-300">Describe the room</label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={2}
          placeholder="e.g. cozy scandinavian living room, 4×5m…"
          className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-2 text-sm outline-none focus:border-emerald-500/50"
        />
        <button
          onClick={() => runDesign(goal)}
          disabled={busy != null || !goal.trim()}
          className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy === "design" ? "agents working…" : "✦ Design it (multi-agent)"}
        </button>
        <div className="mt-2 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => { setGoal(q); runDesign(q); }}
              disabled={busy != null}
              className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-zinc-400 hover:border-emerald-500/40 hover:text-zinc-200 disabled:opacity-50"
            >
              {q.split(",")[0]}
            </button>
          ))}
        </div>
        <label className="mt-2 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-white/15 px-3 py-2 text-xs text-zinc-400 hover:border-emerald-500/40 hover:text-zinc-200">
          {busy === "photo" ? "reconstructing…" : "🖼 Photo → 3D (upload room photos)"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={busy != null}
            onChange={(e) => onPhotos(e.target.files)}
          />
        </label>
      </div>

      {/* Editable assumption chips (apartment briefs) */}
      {apt && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
          <div className="mb-2 font-medium text-zinc-300">Assumptions — tap to edit</div>
          <div className="flex flex-wrap gap-1.5">
            <Stepper label="Beds" value={apt.bedrooms} onDec={() => updateApt({ bedrooms: Math.max(1, apt.bedrooms - 1) })} onInc={() => updateApt({ bedrooms: Math.min(5, apt.bedrooms + 1) })} />
            <Stepper label="Baths" value={apt.bathrooms} onDec={() => updateApt({ bathrooms: Math.max(1, apt.bathrooms - 1) })} onInc={() => updateApt({ bathrooms: Math.min(4, apt.bathrooms + 1) })} />
            <button
              onClick={() => updateApt({ balcony: !apt.balcony })}
              className={`rounded-full border px-2.5 py-1 ${apt.balcony ? "border-emerald-500/50 text-emerald-300" : "border-white/10 text-zinc-400"}`}
            >
              Balcony {apt.balcony ? "✓" : "✕"}
            </button>
            <Stepper label="Plot W" value={apt.plotW} suffix="m" onDec={() => updateApt({ plotW: Math.max(5, apt.plotW - 1) })} onInc={() => updateApt({ plotW: Math.min(30, apt.plotW + 1) })} />
            <Stepper label="Plot D" value={apt.plotD} suffix="m" onDec={() => updateApt({ plotD: Math.max(5, apt.plotD - 1) })} onInc={() => updateApt({ plotD: Math.min(30, apt.plotD + 1) })} />
          </div>
        </div>
      )}

      {/* Agent task ledger */}
      {tasks.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
          <div className="mb-1 font-medium text-zinc-300">Agent ledger</div>
          {tasks.map((t) => (
            <div key={t.agent} className="flex items-center justify-between py-0.5">
              <span className={t.status === "ok" ? "text-emerald-300" : "text-rose-400"}>{t.agent}</span>
              <span className="text-zinc-500">
                {t.status === "ok" ? `${t.applied} applied` : "failed"} · {t.ms}ms
              </span>
            </div>
          ))}
          {conflicts.length > 0 && (
            <div className="mt-1 text-amber-400">
              {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""} resolved (later agent won)
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={undo} className="flex-1 rounded-lg border border-white/10 py-2 text-xs hover:bg-white/5">undo</button>
        <button onClick={redo} className="flex-1 rounded-lg border border-white/10 py-2 text-xs hover:bg-white/5">redo</button>
        <button onClick={reset} className="flex-1 rounded-lg border border-white/10 py-2 text-xs hover:bg-white/5">reset</button>
      </div>

      <button
        onClick={makePhotoreal}
        disabled={busy != null}
        className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy === "render" ? "rendering… (NB2)" : "📸 Make it photoreal (NB2)"}
      </button>
      {renders.length > 0 && (
        <div className="grid grid-cols-1 gap-2">
          {renders.map((r, i) =>
            r.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={r.dataUrl} alt={r.style} className="w-full rounded-lg border border-white/10" />
            ) : (
              <div key={i} className="rounded-lg border border-rose-500/30 p-2 text-xs text-rose-400">
                {r.style}: {r.error}
              </div>
            ),
          )}
        </div>
      )}

      {/* Cost */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center gap-2">
          <select
            value={region}
            onChange={(e) => { setRegion(e.target.value); if (estimate) estimateCost(e.target.value); }}
            className="flex-1 rounded-lg border border-white/10 bg-black/30 p-1.5 text-xs outline-none"
          >
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => estimateCost()}
            disabled={busy != null}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {busy === "cost" ? "…" : "Estimate"}
          </button>
        </div>
        {estimate && (
          <div className="mt-2 text-xs">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-lg font-semibold text-zinc-100">{money(estimate.total, estimate.currency)}</span>
              <span className="text-zinc-500">~{estimate.timeEstimateDays} days</span>
            </div>
            {[...estimate.materials, ...estimate.labour].map((l) => {
              const label = "item" in l ? (l as CostLine).item : (l as LabourLine).trade;
              return (
                <div key={l.id} className="flex justify-between py-0.5 text-zinc-400">
                  <span className="truncate">{label}{"source" in l && (l as CostLine).source === "user" ? " *" : ""}</span>
                  <span>{money(l.subtotal, estimate.currency)}</span>
                </div>
              );
            })}
            <div className="mt-1 border-t border-white/10 pt-1 text-zinc-500">
              +{estimate.contingencyPct}% contingency · materials {money(estimate.subtotals.materials, estimate.currency)} · labour {money(estimate.subtotals.labour, estimate.currency)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
