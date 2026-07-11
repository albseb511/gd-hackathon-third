import type { RoomDesign } from "./types";

// Minimal JSON-Patch (RFC-6902 subset) over the RoomDesign scene-graph.
// Supported: add / replace / remove. Array append via a trailing "-" token.
// This is the ONLY way the scene mutates — tools and agents emit these.
export interface Patch {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

function tokens(path: string): string[] {
  if (path === "" || path === "/") return [];
  return path
    .replace(/^\//, "")
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyOne(doc: any, p: Patch): any {
  const toks = tokens(p.path);
  if (toks.length === 0) {
    if (p.op === "remove") throw new Error("cannot remove document root");
    return p.value;
  }
  const key = toks[toks.length - 1];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parent: any = doc;
  for (const t of toks.slice(0, -1)) parent = parent?.[t];
  if (parent == null) throw new Error(`patch path not found: ${p.path}`);

  if (Array.isArray(parent)) {
    if (p.op === "add") {
      if (key === "-") parent.push(p.value);
      else parent.splice(Number(key), 0, p.value);
    } else if (p.op === "replace") {
      parent[Number(key)] = p.value;
    } else {
      parent.splice(Number(key), 1);
    }
  } else {
    if (p.op === "remove") delete parent[key];
    else parent[key] = p.value;
  }
  return doc;
}

export function applyPatches(design: RoomDesign, patches: Patch[]): RoomDesign {
  let doc = structuredClone(design) as RoomDesign;
  for (const p of patches) doc = applyOne(doc, p);
  return doc;
}

// The top-level field a patch touches, for orchestrator conflict detection.
export function patchScope(p: Patch): string {
  return tokens(p.path).slice(0, 2).join("/") || "/";
}
