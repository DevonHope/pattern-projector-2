import { Affine } from "./affine";

export type Rect = [number, number, number, number]; // x0, y0, x1, y1

// One drawable thing pulled out of the pattern, in layout coordinates
// (CSS pixels at 96 per inch, the same space the pattern is laid out in).
export interface VectorItem {
  id: number;
  kind: "path" | "text" | "svg";
  // path: SVG path data in layout coordinates.
  d?: string;
  fill?: string | null;
  fillRule?: "nonzero" | "evenodd";
  stroke?: string | null;
  // Stroke width in layout px (path), or in the element's own units (svg).
  width?: number;
  dash?: number[] | null;
  // text: the string and the matrix from a 1-unit glyph box to layout px.
  text?: { str: string; m: Affine; length: number; size: number };
  // svg: an element serialised with its transform baked in. "__SW__" marks
  // where the (line-weight adjusted) stroke width goes.
  svg?: string;
  // Layout px per unit of the svg element's own coordinates.
  unitScale?: number;
  // Polyline samples (x, y pairs, NaN NaN between subpaths) used for
  // grouping into pieces and for tapping lines.
  pts: Float32Array;
  bbox: Rect;
  // Layer ids (PDF optional content groups / Inkscape layers) that must all
  // be visible for this item to show.
  ocg: string[] | null;
  // Index of the page it came from in the stitched layout, -1 if none.
  page: number;
  // Page border, tile grid or similar: never treated as part of a piece.
  frame?: boolean;
  // Only a bounding box is known (placed symbols): pts are its corners.
  box?: boolean;
  // Id of a <clipPath> (in ExtractResult.defs) the item is drawn through:
  // its page, or a clip rectangle the PDF set.
  clip?: string;
}

export interface ExtractResult {
  items: VectorItem[];
  pages: Rect[];
  width: number;
  height: number;
  // Raster images found on the pages (scanned patterns can't be split).
  imageCount: number;
  // Extra <defs> markup needed by svg items.
  defs: string;
}

export function rectArea(r: Rect): number {
  return Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return [...b] as Rect;
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

export function intersectRect(a: Rect | null, b: Rect): Rect {
  if (!a) return [...b] as Rect;
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
}

// Clip a polyline (x, y pairs, NaN NaN between subpaths) to a rectangle,
// cutting segments exactly at the edge so outlines stay continuous across
// tile boundaries.
export function clipPolyline(pts: Float32Array, r: Rect): Float32Array {
  const out: number[] = [];
  let px = NaN;
  let py = NaN;
  let open = false; // last output point continues the current run
  let lastX = NaN;
  let lastY = NaN;
  const push = (x: number, y: number, continues: boolean) => {
    if (!continues && out.length) out.push(NaN, NaN);
    out.push(x, y);
    lastX = x;
    lastY = y;
  };
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (Number.isNaN(x)) {
      px = NaN;
      open = false;
      continue;
    }
    if (Number.isNaN(px)) {
      // Start of a subpath: keep the point only if inside.
      if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) {
        push(x, y, false);
        open = true;
      } else {
        open = false;
      }
      px = x;
      py = y;
      continue;
    }
    const seg = clipSegment(px, py, x, y, r);
    if (seg) {
      const [ax, ay, bx, by] = seg;
      const continues = open && ax === lastX && ay === lastY;
      if (!continues) push(ax, ay, false);
      push(bx, by, true);
      open = bx === x && by === y;
    } else {
      open = false;
    }
    px = x;
    py = y;
  }
  return new Float32Array(out);
}

// Liang–Barsky.
function clipSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: Rect,
): [number, number, number, number] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - r[0], r[2] - x0, y0 - r[1], r[3] - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

export function bboxOfPoints(pts: Float32Array): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (Number.isNaN(x)) continue;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return [0, 0, 0, 0];
  return [x0, y0, x1, y1];
}
