"use client";

import { create } from "zustand";
import type { RoomDesign } from "./types";
import { emptyRoom } from "./defaults";
import { applyPatches, type Patch } from "./patch";

const LIMIT = 50;

interface SceneState {
  design: RoomDesign;
  past: RoomDesign[];
  future: RoomDesign[];
  selectedId: string | null;
  apply: (patches: Patch[]) => void; // tool/Live mutations (one history entry)
  load: (design: RoomDesign) => void; // whole-design swap (orchestrator result)
  select: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

export const useScene = create<SceneState>((set, get) => ({
  design: emptyRoom(),
  past: [],
  future: [],
  selectedId: null,
  apply: (patches) => {
    if (!patches.length) return;
    const { design, past } = get();
    set({ design: applyPatches(design, patches), past: [...past, design].slice(-LIMIT), future: [] });
  },
  load: (design) => {
    const { design: prev, past } = get();
    set({ design, past: [...past, prev].slice(-LIMIT), future: [] });
  },
  select: (id) => set({ selectedId: id }),
  undo: () => {
    const { past, future, design } = get();
    if (!past.length) return;
    set({
      design: past[past.length - 1],
      past: past.slice(0, -1),
      future: [design, ...future].slice(0, LIMIT),
    });
  },
  redo: () => {
    const { past, future, design } = get();
    if (!future.length) return;
    set({ design: future[0], past: [...past, design].slice(-LIMIT), future: future.slice(1) });
  },
  reset: () => set({ design: emptyRoom(), past: [], future: [], selectedId: null }),
}));
