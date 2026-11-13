// Group vector items into pattern pieces.
//
// Pattern outlines are drawn many ways (one closed path, a path per edge,
// several nested sizes...), so pieces are found from the drawing as a whole
// rather than from any one path: the line art is rasterised onto a coarse
// grid, everything reachable from the edge of the layout is "outside", and
// each enclosed region left over is a piece. Every vector item then joins
// the piece most of its samples fall in; anything else (titles, the test
// square, page borders) stays as loose markings.

import { Rect, VectorItem, rectArea } from "./types";

const PX_PER_IN = 96;

export interface DetectedPiece {
  index: number;
  key: string;
  bbox: Rect;
  name: string | null;
  itemCount: number;
}

export interface PieceGrid {
  cols: number;
  rows: number;
  cell: number; // layout px per cell
  // cell -> piece index, -1 outside every piece. Includes a one-cell border.
  labels: Int32Array;
}

export interface Segmentation {
  pieces: DetectedPiece[];
  // item id -> piece index, or -1 for loose markings
  pieceOf: Int32Array;
  grid: PieceGrid;
}

export interface SegmentOptions {
  minPieceSqIn?: number;
  maxCells?: number;
  cellsPerInch?: number;
}

export function segment(
  items: VectorItem[],
  width: number,
  height: number,
  pages: Rect[],
  opts: SegmentOptions = {},
): Segmentation {
  const minPieceSqIn = opts.minPieceSqIn ?? 2;
  const maxCells = opts.maxCells ?? 3_000_000;
  let perInch = opts.cellsPerInch ?? 32;
  while (
    perInch > 4 &&
    (width / (PX_PER_IN / perInch)) * (height / (PX_PER_IN / perInch)) >
      maxCells
  ) {
    perInch -= 1;
  }
  const cell = PX_PER_IN / perInch;
  const cols = Math.max(1, Math.ceil(width / cell)) + 2;
  const rows = Math.max(1, Math.ceil(height / cell)) + 2;
  const n = cols * rows;

  markFrames(items, width, height, pages);

  // 1. Rasterise line art (one cell = 1/32 in by default).
  const raw = new Uint8Array(n);
  const toCol = (x: number) =>
    Math.min(cols - 2, Math.max(1, Math.floor(x / cell) + 1));
  const toRow = (y: number) =>
    Math.min(rows - 2, Math.max(1, Math.floor(y / cell) + 1));
  for (const item of items) {
    if (item.kind === "text" || item.box || item.frame) continue;
    const p = item.pts;
    let px = NaN;
    let py = NaN;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i];
      const y = p[i + 1];
      if (Number.isNaN(x)) {
        px = NaN;
        continue;
      }
      if (Number.isNaN(px)) {
        raw[toRow(y) * cols + toCol(x)] = 1;
      } else {
        drawLine(raw, cols, toCol(px), toRow(py), toCol(x), toRow(y));
      }
      px = x;
      py = y;
    }
  }

  // 2. No gap closing: samples follow the true geometry (dashes included), so
  // outlines are already continuous, and pieces laid out a hair apart must
  // stay apart.
  const ink = raw;

  // 3. Label empty regions; those touching the edge, or shaped like a whole
  // page / the whole layout (an unrecognised border), are outside.
  const bg = new Int32Array(n).fill(-1);
  const outside: boolean[] = [];
  const stack = new Int32Array(n);
  let bgCount = 0;
  for (let start = 0; start < n; start++) {
    if (ink[start] || bg[start] !== -1) continue;
    const label = bgCount++;
    let sp = 0;
    stack[sp++] = start;
    bg[start] = label;
    let touches = false;
    let c0 = cols;
    let r0 = rows;
    let c1 = 0;
    let r1 = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const r = (i / cols) | 0;
      const c = i - r * cols;
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) {
        touches = true;
      }
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c > 0 && !ink[i - 1] && bg[i - 1] === -1) {
        bg[i - 1] = label;
        stack[sp++] = i - 1;
      }
      if (c < cols - 1 && !ink[i + 1] && bg[i + 1] === -1) {
        bg[i + 1] = label;
        stack[sp++] = i + 1;
      }
      if (r > 0 && !ink[i - cols] && bg[i - cols] === -1) {
        bg[i - cols] = label;
        stack[sp++] = i - cols;
      }
      if (r < rows - 1 && !ink[i + cols] && bg[i + cols] === -1) {
        bg[i + cols] = label;
        stack[sp++] = i + cols;
      }
    }
    const region: Rect = [
      (c0 - 1) * cell,
      (r0 - 1) * cell,
      c1 * cell,
      r1 * cell,
    ];
    outside[label] = touches || isFrameShaped(region, width, height, pages);
  }

  // 4. Everything not outside forms pieces. 4-connected, so two outlines that
  // only touch corner to corner on the grid stay separate pieces.
  const inside = (i: number) => ink[i] === 1 || !outside[bg[i]];
  const comp = new Int32Array(n).fill(-1);
  const compInfo: {
    area: number;
    holes: number;
    c0: number;
    r0: number;
    c1: number;
    r1: number;
  }[] = [];
  for (let start = 0; start < n; start++) {
    if (comp[start] !== -1 || !inside(start)) continue;
    const label = compInfo.length;
    const info = { area: 0, holes: 0, c0: cols, r0: rows, c1: 0, r1: 0 };
    compInfo.push(info);
    let sp = 0;
    stack[sp++] = start;
    comp[start] = label;
    while (sp > 0) {
      const i = stack[--sp];
      const r = (i / cols) | 0;
      const c = i - r * cols;
      info.area++;
      if (!ink[i]) info.holes++;
      if (c < info.c0) info.c0 = c;
      if (c > info.c1) info.c1 = c;
      if (r < info.r0) info.r0 = r;
      if (r > info.r1) info.r1 = r;
      if (c > 0 && comp[i - 1] === -1 && inside(i - 1)) {
        comp[i - 1] = label;
        stack[sp++] = i - 1;
      }
      if (c < cols - 1 && comp[i + 1] === -1 && inside(i + 1)) {
        comp[i + 1] = label;
        stack[sp++] = i + 1;
      }
      if (r > 0 && comp[i - cols] === -1 && inside(i - cols)) {
        comp[i - cols] = label;
        stack[sp++] = i - cols;
      }
      if (r < rows - 1 && comp[i + cols] === -1 && inside(i + cols)) {
        comp[i + cols] = label;
        stack[sp++] = i + cols;
      }
    }
  }

  const minCells = minPieceSqIn * perInch * perInch;
  const keep = compInfo.map(
    (info) => info.area >= minCells && info.holes >= info.area * 0.35,
  );

  // 5. Each item joins the piece most of its samples fall in.
  const pieceOfComp = (i: number) =>
    comp[i] >= 0 && keep[comp[i]] ? comp[i] : -1;
  const assigned = new Int32Array(items.length).fill(-1);
  for (const item of items) {
    if (item.frame) continue;
    const p = item.pts;
    if (item.kind === "text" || item.box) {
      const cx = (item.bbox[0] + item.bbox[2]) / 2;
      const cy = (item.bbox[1] + item.bbox[3]) / 2;
      assigned[item.id] = pieceOfComp(toRow(cy) * cols + toCol(cx));
      continue;
    }
    const votes = new Map<number, number>();
    let total = 0;
    for (let i = 0; i < p.length; i += 2) {
      if (Number.isNaN(p[i])) continue;
      total++;
      const k = pieceOfComp(toRow(p[i + 1]) * cols + toCol(p[i]));
      votes.set(k, (votes.get(k) ?? 0) + 1);
    }
    let best = -1;
    let bestVotes = 0;
    votes.forEach((v, k) => {
      if (k >= 0 && v > bestVotes) {
        best = k;
        bestVotes = v;
      }
    });
    if (best >= 0 && bestVotes >= total * 0.6) assigned[item.id] = best;
  }

  // 6. Number pieces top-to-bottom, left-to-right and name them.
  const kept = compInfo
    .map((info, comp) => ({ info, comp }))
    .filter(({ comp }) => keep[comp]);
  const band = 2 * perInch;
  kept.sort(
    (a, b) =>
      Math.floor(a.info.r0 / band) - Math.floor(b.info.r0 / band) ||
      a.info.c0 - b.info.c0,
  );
  const indexOfComp = new Map<number, number>();
  kept.forEach(({ comp }, index) => indexOfComp.set(comp, index));

  const pieceOf = new Int32Array(items.length).fill(-1);
  const bboxes: (Rect | null)[] = kept.map(() => null);
  const counts = kept.map(() => 0);
  const titles: VectorItem[][] = kept.map(() => []);
  for (const item of items) {
    const c = assigned[item.id];
    if (c < 0) continue;
    const index = indexOfComp.get(c)!;
    pieceOf[item.id] = index;
    counts[index]++;
    if (item.kind !== "text") {
      const b = bboxes[index];
      bboxes[index] = b
        ? [
            Math.min(b[0], item.bbox[0]),
            Math.min(b[1], item.bbox[1]),
            Math.max(b[2], item.bbox[2]),
            Math.max(b[3], item.bbox[3]),
          ]
        : [...item.bbox];
    } else if (item.text && /\p{L}/u.test(item.text.str)) {
      titles[index].push(item);
    }
  }

  const labels = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const c = comp[i];
    if (c >= 0 && keep[c]) labels[i] = indexOfComp.get(c)!;
  }

  const seen = new Map<string, number>();
  const pieces: DetectedPiece[] = kept.map(({ info }, index) => {
    const bbox: Rect = bboxes[index] ?? [
      (info.c0 - 1) * cell,
      (info.r0 - 1) * cell,
      info.c1 * cell,
      info.r1 * cell,
    ];
    let key = `${Math.round((bbox[0] + bbox[2]) / 48)}:${Math.round((bbox[1] + bbox[3]) / 48)}:${Math.round((bbox[2] - bbox[0]) / 48)}`;
    const dup = seen.get(key) ?? 0;
    seen.set(key, dup + 1);
    if (dup) key += `#${dup}`;
    return {
      index,
      key,
      bbox,
      name: pieceName(titles[index]),
      itemCount: counts[index],
    };
  });

  return { pieces, pieceOf, grid: { cols, rows, cell, labels } };
}

// The piece's title: its largest lettered text. Labels are often split into
// several runs (kerning, or a tile edge through the word), so runs of that
// size on the same baseline are joined back together.
export function pieceName(labels: VectorItem[]): string | null {
  let size = 0;
  for (const l of labels) size = Math.max(size, l.text!.size);
  if (size === 0) return null;
  const big = labels.filter((l) => l.text!.size >= size * 0.9);
  const lines: VectorItem[][] = [];
  for (const l of big) {
    const y = l.text!.m[5];
    const line = lines.find((g) => Math.abs(g[0].text!.m[5] - y) < size * 0.3);
    if (line) line.push(l);
    else lines.push([l]);
  }
  let best: string | null = null;
  for (const line of lines) {
    line.sort((a, b) => a.text!.m[4] - b.text!.m[4]);
    let str = "";
    let end = -Infinity;
    for (const l of line) {
      if (str && l.bbox[0] - end > size * 0.25) str += " ";
      str += l.text!.str;
      end = l.bbox[2];
    }
    str = str.replace(/\s+/g, " ").trim();
    if (
      str.length >= 2 &&
      str.length <= 40 &&
      /\p{L}{2}/u.test(str) &&
      (!best || str.length > best.length)
    ) {
      best = str;
    }
  }
  return best;
}

// Index of the piece under a layout point, or -1.
export function pieceAt(grid: PieceGrid, x: number, y: number): number {
  const c = Math.floor(x / grid.cell) + 1;
  const r = Math.floor(y / grid.cell) + 1;
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return -1;
  return grid.labels[r * grid.cols + c];
}

// Page borders sit right at the page edges; a big rectangular piece has
// margins around it.
const BORDER_MARGIN = 0.75 * PX_PER_IN;

function hugsEdges(r: Rect, page: Rect, margin = BORDER_MARGIN): boolean {
  return (
    Math.abs(r[0] - page[0]) <= margin &&
    Math.abs(r[1] - page[1]) <= margin &&
    Math.abs(page[2] - r[2]) <= margin &&
    Math.abs(page[3] - r[3]) <= margin
  );
}

// An empty region that is really the inside of an unrecognised page border.
function isFrameShaped(
  region: Rect,
  width: number,
  height: number,
  pages: Rect[],
): boolean {
  // The region sits inside the border line, so allow a little extra.
  const margin = BORDER_MARGIN + 0.25 * PX_PER_IN;
  if (hugsEdges(region, [0, 0, width, height], margin)) return true;
  return pages.some((p) => hugsEdges(region, p, margin));
}

// Page borders, tile grids and crop lines: straight, axis-aligned and about
// as big as a page or the whole layout.
export function markFrames(
  items: VectorItem[],
  width: number,
  height: number,
  pages: Rect[],
) {
  const edgeTolerance = 0.75 * PX_PER_IN;
  for (const item of items) {
    item.frame = false;
    // Clipped items run on past the page edge: pattern content, never page
    // furniture (a piece's fold line along a tile edge looks just like one).
    if (item.kind === "text" || item.box || item.clip) continue;
    const [x0, y0, x1, y1] = item.bbox;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < PX_PER_IN && h < PX_PER_IN) continue;
    if (!isAxisAligned(item.pts)) continue;
    if (hugsEdges(item.bbox, [0, 0, width, height])) {
      item.frame = true;
      continue;
    }
    for (const p of pages) {
      const pw = p[2] - p[0];
      const ph = p[3] - p[1];
      const within =
        x0 >= p[0] - pw * 0.02 &&
        x1 <= p[2] + pw * 0.02 &&
        y0 >= p[1] - ph * 0.02 &&
        y1 <= p[3] + ph * 0.02;
      if (!within) continue;
      if (hugsEdges(item.bbox, p)) {
        item.frame = true;
        break;
      }
      // A single long line hugging a page edge (tile trim/overlap line).
      const thin = Math.min(w, h) < 2;
      if (!thin) continue;
      if (
        w >= pw * 0.8 &&
        (y0 - p[1] < edgeTolerance || p[3] - y1 < edgeTolerance)
      ) {
        item.frame = true;
        break;
      }
      if (
        h >= ph * 0.8 &&
        (x0 - p[0] < edgeTolerance || p[2] - x1 < edgeTolerance)
      ) {
        item.frame = true;
        break;
      }
    }
  }
}

function isAxisAligned(p: Float32Array): boolean {
  let px = NaN;
  let py = NaN;
  let segments = 0;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i];
    const y = p[i + 1];
    if (Number.isNaN(x)) {
      px = NaN;
      continue;
    }
    if (!Number.isNaN(px)) {
      const dx = Math.abs(x - px);
      const dy = Math.abs(y - py);
      if (dx > 0.5 && dy > 0.5) return false;
      segments++;
    }
    px = x;
    py = y;
  }
  return segments > 0;
}

function drawLine(
  grid: Uint8Array,
  cols: number,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
) {
  const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
  if (steps === 0) {
    grid[r0 * cols + c0] = 1;
    return;
  }
  for (let s = 0; s <= steps; s++) {
    const c = Math.round(c0 + ((c1 - c0) * s) / steps);
    const r = Math.round(r0 + ((r1 - r0) * s) / steps);
    grid[r * cols + c] = 1;
  }
}

export { rectArea };
