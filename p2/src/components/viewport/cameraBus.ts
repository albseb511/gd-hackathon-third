"use client";

// Bridge between the 2D chrome (toolbar) and the R3F CameraControls instance.
import type { ViewId } from "./camera-rig";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Controls = any; // camera-controls instance (rotate / setLookAt)

let controls: Controls | null = null;
let flyFn: ((v: ViewId) => void) | null = null;

export function registerControls(c: Controls | null) {
  controls = c;
}
export function getControls(): Controls | null {
  return controls;
}
export function registerFly(fn: ((v: ViewId) => void) | null) {
  flyFn = fn;
}
export function flyTo(v: ViewId) {
  flyFn?.(v);
}
