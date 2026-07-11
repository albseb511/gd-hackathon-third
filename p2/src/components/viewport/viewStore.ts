"use client";

// View-only UI state for the 3D viewport (never part of the scene model).
import { create } from "zustand";

interface ViewState {
  xray: boolean; // force all walls see-through
  showLabels: boolean; // floating room/furniture labels
  toggleXray: () => void;
  toggleLabels: () => void;
}

export const useView = create<ViewState>((set) => ({
  xray: false,
  showLabels: true,
  toggleXray: () => set((s) => ({ xray: !s.xray })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
}));
