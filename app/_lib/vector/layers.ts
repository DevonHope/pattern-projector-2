// Piece layers: every detected piece (and any layer the user makes) is its
// own layer that can be shown, hidden, ticked off as cut, moved, rotated,
// mirrored and unfolded along a fold line without touching the others.

import { LineWeight } from "@/_lib/line-weight";
import {
  Affine,
  apply,
  invert,
  mul,
  reflection,
  rotation,
  round,
  scaling,
  toSvg,
  translation,
} from "./affine";
import { PieceGrid, Segmentation, pieceAt } from "./segment";
import { ExtractResult, Rect, VectorItem, unionRect } from "./types";

export const MARKINGS = "markings";

export interface PieceLayer {
  id: string;
  name: string;
  visible: boolean;
  cut: boolean;
  // Where the layer's own items sit before moving; rotation is about this.
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  rotation: number;
  flipped: boolean;
  // Fold line in the layer's own (unmoved) coordinates.
  fold: [number, number, number, number] | null;
  // Index of the detected piece (for tap tests), -1 for user layers.
  piece: number;
}

export interface LayerDoc {
  layers: PieceLayer[];
  // item id -> layer id (piece layer id or MARKINGS)
  owner: Record<number, string>;
}

export function pieceLayerId(key: string) {
  return `piece:${key}`;
}

export function initialDoc(
  extract: ExtractResult,
  seg: Segmentation,
  pieceLabel: (n: number) => string,
): LayerDoc {
  const layers: PieceLayer[] = seg.pieces.map((p) => ({
    id: pieceLayerId(p.key),
    name: p.name ?? pieceLabel(p.index + 1),
    visible: true,
    cut: false,
    cx: (p.bbox[0] + p.bbox[2]) / 2,
    cy: (p.bbox[1] + p.bbox[3]) / 2,
    dx: 0,
    dy: 0,
    rotation: 0,
    flipped: false,
    fold: null,
    piece: p.index,
  }));
  const owner: Record<number, string> = {};
  for (const item of extract.items) {
    const p = seg.pieceOf[item.id];
    owner[item.id] = p >= 0 ? layers[p].id : MARKINGS;
  }
  return { layers, owner };
}

// Saved state is matched back to freshly detected pieces by key, so ticks and
// moves survive reloads as long as the pattern is laid out the same way.
export interface SavedDoc {
  sig: string;
  layers: Omit<PieceLayer, "piece">[];
  moved: Record<number, string>;
}

export function restoreDoc(
  fresh: LayerDoc,
  saved: SavedDoc | null,
  sig: string,
): LayerDoc {
  if (!saved || saved.sig !== sig) return fresh;
  const byId = new Map(fresh.layers.map((l) => [l.id, l]));
  const layers: PieceLayer[] = [];
  for (const s of saved.layers) {
    const f = byId.get(s.id);
    if (f) {
      layers.push({ ...f, ...s, piece: f.piece });
      byId.delete(s.id);
    } else if (!s.id.startsWith("piece:")) {
      layers.push({ ...s, piece: -1 });
    }
  }
  byId.forEach((l) => layers.push(l));
  const ids = new Set(layers.map((l) => l.id));
  const owner = { ...fresh.owner };
  for (const [item, layer] of Object.entries(saved.moved)) {
    if ((ids.has(layer) || layer === MARKINGS) && owner[Number(item)]) {
      owner[Number(item)] = layer;
    }
  }
  return { layers, owner };
}

export function toSaved(doc: LayerDoc, fresh: LayerDoc, sig: string): SavedDoc {
  const moved: Record<number, string> = {};
  for (const [item, layer] of Object.entries(doc.owner)) {
    if (fresh.owner[Number(item)] !== layer) moved[Number(item)] = layer;
  }
  return {
    sig,
    layers: doc.layers.map((l) => {
      const saved: Partial<PieceLayer> = { ...l };
      delete saved.piece; // re-derived from detection on load
      return saved as Omit<PieceLayer, "piece">;
    }),
    moved,
  };
}

export function layerMatrix(l: PieceLayer): Affine {
  return mul(
    translation(l.cx + l.dx, l.cy + l.dy),
    mul(
      rotation(l.rotation),
      mul(scaling(l.flipped ? -1 : 1, 1), translation(-l.cx, -l.cy)),
    ),
  );
}

export function foldMatrix(l: PieceLayer): Affine | null {
  if (!l.fold) return null;
  return mul(layerMatrix(l), reflection(...l.fold));
}

// The ways a layer is drawn: itself, plus its mirror image when unfolded.
export function layerCopies(l: PieceLayer): Affine[] {
  const fm = foldMatrix(l);
  return fm ? [layerMatrix(l), fm] : [layerMatrix(l)];
}

export function itemsByLayer(
  layerIds: string[],
  owners: Record<number, string>,
  items: VectorItem[],
): Map<string, VectorItem[]> {
  const map = new Map<string, VectorItem[]>();
  map.set(MARKINGS, []);
  for (const id of layerIds) map.set(id, []);
  for (const item of items) {
    const owner = owners[item.id] ?? MARKINGS;
    (map.get(owner) ?? map.get(MARKINGS)!).push(item);
  }
  return map;
}

export function layerBounds(items: VectorItem[]): Rect | null {
  let r: Rect | null = null;
  for (const i of items) r = unionRect(r, i.bbox);
  return r;
}

export function isVisible(item: VectorItem, hidden: Set<string>): boolean {
  if (!item.ocg) return true;
  return !item.ocg.some((id) => hidden.has(id));
}

const PX_PER_MM = 96 / 25.4;

// SVG markup for a list of items, with the line-weight setting applied.
export function itemsMarkup(
  items: VectorItem[],
  lw: LineWeight,
  hidden: Set<string>,
): string {
  const out: string[] = [];
  const minPx = lw.minMm * PX_PER_MM;
  for (const item of items) {
    if (!isVisible(item, hidden)) continue;
    if (item.kind === "path") {
      const base = item.width && item.width > 0 ? item.width : 0.75;
      const w = round(Math.max(base * lw.scale, minPx), 3);
      out.push(
        `<path d="${item.d}" fill="${item.fill ?? "none"}"${item.fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""} stroke="${item.stroke ?? "none"}" stroke-width="${w}"${item.dash ? ` stroke-dasharray="${item.dash.join(" ")}"` : ""} stroke-linecap="round" stroke-linejoin="round"${item.clip ? ` clip-path="url(#${item.clip})"` : ""}/>`,
      );
    } else if (item.svg) {
      const unit = item.unitScale || 1;
      const base = item.width ?? 1;
      const w = round(Math.max(base * lw.scale, minPx / unit), 4);
      out.push(item.svg.replace("__SW__", `${w}px`));
    } else if (item.text) {
      out.push(
        `<text transform="${toSvg(item.text.m)}" font-size="1" font-family="sans-serif" fill="#000"${item.text.length > 0 ? ` textLength="${round(item.text.length, 4)}" lengthAdjust="spacingAndGlyphs"` : ""}>${escapeXml(item.text.str)}</text>`,
      );
    }
  }
  return out.join("");
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- tapping ----------------------------------------------------------

function distanceToItem(item: VectorItem, x: number, y: number): number {
  const [x0, y0, x1, y1] = item.bbox;
  if (isBoxItem(item)) {
    return x >= x0 && x <= x1 && y >= y0 && y <= y1 ? 0 : Infinity;
  }
  const p = item.pts;
  let best = Infinity;
  let px = NaN;
  let py = NaN;
  for (let i = 0; i < p.length; i += 2) {
    const qx = p[i];
    const qy = p[i + 1];
    if (Number.isNaN(qx)) {
      px = NaN;
      continue;
    }
    const d = Number.isNaN(px)
      ? Math.hypot(x - qx, y - qy)
      : segmentDistance(x, y, px, py, qx, qy);
    if (d < best) best = d;
    px = qx;
    py = qy;
  }
  return best;
}

function segmentDistance(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2
    ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
    : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

export interface ViewState {
  isolate: boolean;
  selected: string | null;
  showMarkings: boolean;
}

export function shownLayers(doc: LayerDoc, view: ViewState): PieceLayer[] {
  const shown = doc.layers.filter(
    (l) => l.visible && (!view.isolate || l.id === view.selected),
  );
  // Draw the selected layer last so it sits on top.
  shown.sort((a, b) =>
    a.id === view.selected ? 1 : b.id === view.selected ? -1 : 0,
  );
  return shown;
}

// Topmost layer under a layout point.
export function layerAt(
  doc: LayerDoc,
  view: ViewState,
  grid: PieceGrid | null,
  byLayer: Map<string, VectorItem[]>,
  x: number,
  y: number,
  tolerance: number,
): string | null {
  const shown = shownLayers(doc, view);
  for (let i = shown.length - 1; i >= 0; i--) {
    const l = shown[i];
    for (const m of layerCopies(l)) {
      const [lx, ly] = apply(invert(m), x, y);
      if (grid && l.piece >= 0 && pieceAt(grid, lx, ly) === l.piece) {
        return l.id;
      }
      for (const item of byLayer.get(l.id) ?? []) {
        if (distanceToItem(item, lx, ly) <= tolerance) return l.id;
      }
    }
  }
  return null;
}

// Nearest single item (line, label...) to a layout point.
export function itemAt(
  doc: LayerDoc,
  view: ViewState,
  byLayer: Map<string, VectorItem[]>,
  hidden: Set<string>,
  x: number,
  y: number,
  tolerance: number,
): number | null {
  // A line within reach beats a label or symbol whose box the tap is inside.
  let best: number | null = null;
  let bestDistance = tolerance;
  let bestBox: number | null = null;
  const check = (items: VectorItem[], lx: number, ly: number) => {
    for (const item of items) {
      if (!isVisible(item, hidden)) continue;
      const d = distanceToItem(item, lx, ly);
      if (isBoxItem(item)) {
        if (d === 0 && bestBox === null) bestBox = item.id;
      } else if (d <= bestDistance) {
        best = item.id;
        bestDistance = d;
      }
    }
  };
  for (const l of shownLayers(doc, view)) {
    for (const m of layerCopies(l)) {
      const [lx, ly] = apply(invert(m), x, y);
      check(byLayer.get(l.id) ?? [], lx, ly);
    }
  }
  if (view.showMarkings && !view.isolate) {
    check(byLayer.get(MARKINGS) ?? [], x, y);
  }
  return best ?? bestBox;
}

// Labels and placed symbols: tapped anywhere inside their box, never used as
// a line (their samples are just box corners).
export function isBoxItem(item: VectorItem): boolean {
  return item.kind === "text" || item.box === true;
}

// The straight run of line nearest a tap on a layer, extended to a fold line.
export function foldLineAt(
  layer: PieceLayer,
  items: VectorItem[],
  x: number,
  y: number,
  tolerance: number,
): [number, number, number, number] | null {
  const [lx, ly] = apply(invert(layerMatrix(layer)), x, y);
  let best: [number, number, number, number] | null = null;
  let bestDistance = tolerance;
  for (const item of items) {
    if (isBoxItem(item)) continue;
    const p = item.pts;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2];
      const ay = p[i - 1];
      const bx = p[i];
      const by = p[i + 1];
      if (Number.isNaN(ax) || Number.isNaN(bx)) continue;
      if (Math.hypot(bx - ax, by - ay) < 0.5) continue;
      const d = segmentDistance(lx, ly, ax, ay, bx, by);
      if (d <= bestDistance) {
        bestDistance = d;
        best = [ax, ay, bx, by];
      }
    }
  }
  return best;
}

// Outline (four corners) of a layer's items after its transform.
export function layerOutline(l: PieceLayer, items: VectorItem[]): number[][] {
  let bounds = layerBounds(items.filter((i) => i.kind !== "text"));
  if (!bounds) bounds = layerBounds(items);
  if (!bounds) return [];
  const [x0, y0, x1, y1] = bounds;
  const outlines: number[][] = [];
  for (const m of layerCopies(l)) {
    outlines.push(
      [
        apply(m, x0, y0),
        apply(m, x1, y0),
        apply(m, x1, y1),
        apply(m, x0, y1),
      ].flat(),
    );
  }
  return outlines;
}

// ---- export ----------------------------------------------------------

export function exportSvg(
  extract: ExtractResult,
  doc: LayerDoc,
  view: ViewState,
  lw: LineWeight,
  hidden: Set<string>,
): string {
  const byLayer = itemsByLayer(
    doc.layers.map((l) => l.id),
    doc.owner,
    extract.items,
  );
  let bounds: Rect = [0, 0, extract.width, extract.height];
  const groups: string[] = [];
  const layerGroup = (id: string, name: string, body: string) =>
    `<g id="${escapeXml(id)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(name)}">${body}</g>`;

  if (view.showMarkings) {
    groups.push(
      layerGroup(
        "markings",
        "Markings",
        itemsMarkup(byLayer.get(MARKINGS) ?? [], lw, hidden),
      ),
    );
  }
  for (const l of doc.layers) {
    if (!l.visible) continue;
    const items = byLayer.get(l.id) ?? [];
    const body = itemsMarkup(items, lw, hidden);
    const copies = layerCopies(l)
      .map((m) => `<g transform="${toSvg(m)}">${body}</g>`)
      .join("");
    groups.push(layerGroup(l.id.replace(/[^\w-]/g, "_"), l.name, copies));
    for (const outline of layerOutline(l, items)) {
      for (let i = 0; i < outline.length; i += 2) {
        bounds = unionRect(bounds, [
          outline[i],
          outline[i + 1],
          outline[i],
          outline[i + 1],
        ]);
      }
    }
  }
  const [x0, y0, x1, y1] = bounds.map((v) => round(v, 2));
  const w = x1 - x0;
  const h = y1 - y0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${round(w / 96, 4)}in" height="${round(h / 96, 4)}in" viewBox="${x0} ${y0} ${w} ${h}">
<defs>${extract.defs}</defs>
${groups.join("\n")}
</svg>`;
}

export function layerTransformCss(m: Affine): string {
  return toSvg(m);
}
