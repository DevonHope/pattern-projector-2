// Pull the line art out of PDF pages as vectors, in layout coordinates.
// Walks pdf.js's operator list (the same instructions its canvas renderer
// draws from) and turns every stroked or filled path into SVG path data.

import type { PDFDocumentProxy } from "pdfjs-dist";

// pdf.js operator codes (pdfjs-dist 3.11, src/shared/util.js OPS). Kept here
// so this module doesn't pull pdf.js into the server bundle.
export const OPS = {
  setLineWidth: 2,
  setDash: 6,
  setGState: 9,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  beginMarkedContent: 69,
  beginMarkedContentProps: 70,
  endMarkedContent: 71,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageXObjectRepeat: 88,
  constructPath: 91,
} as const;
import {
  Affine,
  IDENTITY,
  apply,
  mul,
  round,
  scaleOf,
  translation,
} from "./affine";
import {
  ExtractResult,
  Rect,
  VectorItem,
  bboxOfPoints,
  clipPolyline,
  intersectRect,
} from "./types";

export interface PagePlacement {
  pageNumber: number;
  // Top-left of the page in layout px.
  x: number;
  y: number;
}

interface GState {
  ctm: Affine;
  lineWidth: number;
  dash: number[] | null;
  stroke: string;
  fill: string;
  // Visible area in layout px: the page, narrowed by rectangular clips.
  clip: Rect;
}

// Shared across pages: one <clipPath> per distinct clip rectangle.
interface ClipRegistry {
  ids: Map<string, string>;
  defs: string[];
}

function clipIdFor(reg: ClipRegistry, r: Rect): string {
  const key = r.map((v) => round(v, 1)).join(",");
  let id = reg.ids.get(key);
  if (!id) {
    id = `ppclip${reg.ids.size}`;
    reg.ids.set(key, id);
    reg.defs.push(
      `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="${round(r[0])}" y="${round(r[1])}" width="${round(r[2] - r[0])}" height="${round(r[3] - r[1])}"/></clipPath>`,
    );
  }
  return id;
}

// The rectangle a path traces, if it is an axis-aligned rectangle.
function axisRect(pts: number[]): Rect | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    if (Number.isNaN(pts[i])) continue;
    xs.push(pts[i]);
    ys.push(pts[i + 1]);
  }
  if (xs.length < 4 || xs.length > 5) return null;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const near = (v: number, a: number, b: number) =>
    Math.abs(v - a) < 0.05 || Math.abs(v - b) < 0.05;
  for (let i = 0; i < xs.length; i++) {
    if (!near(xs[i], x0, x1) || !near(ys[i], y0, y1)) return null;
  }
  return [x0, y0, x1, y1];
}

const CURVE_STEPS = 8;

export async function extractPdf(
  pdf: PDFDocumentProxy,
  placements: PagePlacement[],
  cssPerPoint: number,
  width: number,
  height: number,
): Promise<ExtractResult> {
  const items: VectorItem[] = [];
  const pages: Rect[] = [];
  const clips: ClipRegistry = { ids: new Map(), defs: [] };
  let imageCount = 0;

  for (let pi = 0; pi < placements.length; pi++) {
    const placement = placements[pi];
    const page = await pdf.getPage(placement.pageNumber);
    const userUnit = (page as unknown as { userUnit?: number }).userUnit || 1;
    const viewport = page.getViewport({ scale: cssPerPoint * userUnit });
    const base = mul(
      translation(placement.x, placement.y),
      viewport.transform as Affine,
    );
    const pageRect: Rect = [
      placement.x,
      placement.y,
      placement.x + viewport.width,
      placement.y + viewport.height,
    ];
    pages.push(pageRect);
    const opList = await page.getOperatorList();
    imageCount += walk(
      opList.fnArray,
      opList.argsArray,
      base,
      pi,
      pageRect,
      clips,
      items,
    );

    const text = await page.getTextContent();
    for (const t of text.items) {
      if (!("str" in t) || !t.str.trim()) continue;
      const tm = t.transform as Affine;
      // Glyph space is y-up; flip so the text reads the right way in SVG.
      const m = mul(base, mul(tm, [1, 0, 0, -1, 0, 0]));
      const size = Math.hypot(tm[2], tm[3]) || 1;
      const length = (t.width || 0) / size;
      const corners = [
        apply(m, 0, 0),
        apply(m, length || t.str.length * 0.5, 0),
        apply(m, 0, -1),
        apply(m, length || t.str.length * 0.5, -1),
      ];
      const pts = new Float32Array(corners.flat());
      const tb = bboxOfPoints(pts);
      const tcx = (tb[0] + tb[2]) / 2;
      const tcy = (tb[1] + tb[3]) / 2;
      if (
        tcx < pageRect[0] ||
        tcx > pageRect[2] ||
        tcy < pageRect[1] ||
        tcy > pageRect[3]
      ) {
        continue; // off the page: not visible
      }
      items.push({
        id: items.length,
        kind: "text",
        text: { str: t.str, m, length, size: size * scaleOf(base) },
        pts,
        bbox: bboxOfPoints(pts),
        ocg: null,
        page: pi,
      });
    }
    page.cleanup();
  }

  return {
    items,
    pages,
    width,
    height,
    imageCount,
    defs: clips.defs.join(""),
  };
}

function walk(
  fnArray: number[],
  argsArray: any[],
  base: Affine,
  pageIndex: number,
  pageRect: Rect,
  clips: ClipRegistry,
  items: VectorItem[],
): number {
  const pageArea = (pageRect[2] - pageRect[0]) * (pageRect[3] - pageRect[1]);
  let state: GState = {
    ctm: IDENTITY,
    lineWidth: 1,
    dash: null,
    stroke: "#000000",
    fill: "#000000",
    clip: [...pageRect] as Rect,
  };
  let pendingClip = false;

  // A clip takes effect after the path it is set with has been painted.
  function applyPendingClip() {
    if (!pendingClip) return;
    pendingClip = false;
    const r = axisRect(pts);
    if (r) state.clip = intersectRect(state.clip, r);
  }
  const stack: GState[] = [];
  const marked: (string[] | null)[] = [];
  let images = 0;

  // Current path, already in layout coordinates.
  let d: string[] = [];
  let pts: number[] = [];
  let cx = 0; // current point in user space
  let cy = 0;
  let sx = 0; // subpath start in user space
  let sy = 0;

  const full = () => mul(base, state.ctm);

  function point(m: Affine, x: number, y: number) {
    const [X, Y] = apply(m, x, y);
    return [X, Y];
  }

  function moveTo(m: Affine, x: number, y: number) {
    const [X, Y] = point(m, x, y);
    d.push(`M${round(X)} ${round(Y)}`);
    if (pts.length) pts.push(NaN, NaN);
    pts.push(X, Y);
    cx = sx = x;
    cy = sy = y;
  }

  function lineTo(m: Affine, x: number, y: number) {
    const [X, Y] = point(m, x, y);
    d.push(`L${round(X)} ${round(Y)}`);
    pts.push(X, Y);
    cx = x;
    cy = y;
  }

  function curveTo(
    m: Affine,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x: number,
    y: number,
  ) {
    const [X1, Y1] = point(m, x1, y1);
    const [X2, Y2] = point(m, x2, y2);
    const [X, Y] = point(m, x, y);
    d.push(
      `C${round(X1)} ${round(Y1)} ${round(X2)} ${round(Y2)} ${round(X)} ${round(Y)}`,
    );
    const [X0, Y0] = point(m, cx, cy);
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      pts.push(
        u * u * u * X0 +
          3 * u * u * t * X1 +
          3 * u * t * t * X2 +
          t * t * t * X,
        u * u * u * Y0 +
          3 * u * u * t * Y1 +
          3 * u * t * t * Y2 +
          t * t * t * Y,
      );
    }
    cx = x;
    cy = y;
  }

  function closePath(m: Affine) {
    d.push("Z");
    const [X, Y] = point(m, sx, sy);
    pts.push(X, Y);
    cx = sx;
    cy = sy;
  }

  function ocgs(): string[] | null {
    const ids: string[] = [];
    for (const m of marked) if (m) ids.push(...m);
    return ids.length ? ids : null;
  }

  function emit(stroke: boolean, fill: boolean, evenOdd: boolean) {
    if (d.length === 0) return;
    const m = full();
    const raw = new Float32Array(pts);
    const rawBox = bboxOfPoints(raw);
    const c = state.clip;
    const inside =
      rawBox[0] >= c[0] &&
      rawBox[1] >= c[1] &&
      rawBox[2] <= c[2] &&
      rawBox[3] <= c[3];
    const p = inside ? raw : clipPolyline(raw, c);
    applyPendingClip();
    if (!p.some((v) => !Number.isNaN(v))) {
      d = [];
      pts = [];
      return; // entirely clipped away
    }
    const bbox = bboxOfPoints(p);
    const fillColor = fill ? state.fill : null;
    const isBackground =
      fill &&
      !stroke &&
      isWhite(state.fill) &&
      (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > pageArea * 0.25;
    if (!isBackground) {
      const scale = scaleOf(m);
      items.push({
        id: items.length,
        kind: "path",
        d: d.join(""),
        fill: fillColor,
        fillRule: evenOdd ? "evenodd" : "nonzero",
        stroke: stroke ? state.stroke : null,
        width: state.lineWidth * scale,
        dash:
          stroke && state.dash && state.dash.length
            ? state.dash.map((v) => round(v * scale))
            : null,
        pts: p,
        bbox,
        ocg: ocgs(),
        page: pageIndex,
        clip: inside ? undefined : clipIdFor(clips, c),
      });
    }
    d = [];
    pts = [];
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push({ ...state });
        break;
      case OPS.restore:
        state = stack.pop() ?? state;
        break;
      case OPS.transform:
        state.ctm = mul(state.ctm, args as Affine);
        break;
      case OPS.setLineWidth:
        state.lineWidth = args[0];
        break;
      case OPS.setDash:
        state.dash = Array.isArray(args[0]) ? args[0] : null;
        break;
      case OPS.setGState:
        for (const [key, value] of args[0] as [string, any][]) {
          if (key === "LW") state.lineWidth = value;
          if (key === "D" && Array.isArray(value)) {
            state.dash = Array.isArray(value[0]) ? value[0] : null;
          }
        }
        break;
      case OPS.setStrokeRGBColor:
        state.stroke = color(args);
        break;
      case OPS.setFillRGBColor:
        state.fill = color(args);
        break;
      case OPS.constructPath: {
        const m = full();
        const [ops, coords] = args as [number[], number[]];
        let j = 0;
        for (const op of ops) {
          switch (op) {
            case OPS.moveTo:
              moveTo(m, coords[j++], coords[j++]);
              break;
            case OPS.lineTo:
              lineTo(m, coords[j++], coords[j++]);
              break;
            case OPS.curveTo:
              curveTo(
                m,
                coords[j],
                coords[j + 1],
                coords[j + 2],
                coords[j + 3],
                coords[j + 4],
                coords[j + 5],
              );
              j += 6;
              break;
            case OPS.curveTo2:
              curveTo(
                m,
                cx,
                cy,
                coords[j],
                coords[j + 1],
                coords[j + 2],
                coords[j + 3],
              );
              j += 4;
              break;
            case OPS.curveTo3:
              curveTo(
                m,
                coords[j],
                coords[j + 1],
                coords[j + 2],
                coords[j + 3],
                coords[j + 2],
                coords[j + 3],
              );
              j += 4;
              break;
            case OPS.closePath:
              closePath(m);
              break;
            case OPS.rectangle: {
              const x = coords[j++];
              const y = coords[j++];
              const w = coords[j++];
              const h = coords[j++];
              moveTo(m, x, y);
              lineTo(m, x + w, y);
              lineTo(m, x + w, y + h);
              lineTo(m, x, y + h);
              closePath(m);
              break;
            }
          }
        }
        break;
      }
      case OPS.stroke:
        emit(true, false, false);
        break;
      case OPS.closeStroke:
        closePath(full());
        emit(true, false, false);
        break;
      case OPS.fill:
        emit(false, true, false);
        break;
      case OPS.eoFill:
        emit(false, true, true);
        break;
      case OPS.fillStroke:
        emit(true, true, false);
        break;
      case OPS.eoFillStroke:
        emit(true, true, true);
        break;
      case OPS.closeFillStroke:
        closePath(full());
        emit(true, true, false);
        break;
      case OPS.closeEOFillStroke:
        closePath(full());
        emit(true, true, true);
        break;
      case OPS.clip:
      case OPS.eoClip:
        pendingClip = true;
        break;
      case OPS.endPath:
        applyPendingClip();
        d = [];
        pts = [];
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...state });
        if (Array.isArray(args[0]) && args[0].length === 6) {
          state.ctm = mul(state.ctm, args[0] as Affine);
        }
        if (Array.isArray(args[1]) && args[1].length === 4) {
          // Forms are clipped to their bounding box.
          const [bx0, by0, bx1, by1] = args[1] as number[];
          const fm = full();
          const corners = [
            apply(fm, bx0, by0),
            apply(fm, bx1, by0),
            apply(fm, bx1, by1),
            apply(fm, bx0, by1),
          ];
          const r = axisRect(corners.flat());
          if (r) state.clip = intersectRect(state.clip, r);
        }
        break;
      case OPS.paintFormXObjectEnd:
        state = stack.pop() ?? state;
        break;
      case OPS.beginGroup:
        stack.push({ ...state });
        if (args[0]?.matrix && args[0].matrix.length === 6) {
          state.ctm = mul(state.ctm, args[0].matrix as Affine);
        }
        break;
      case OPS.endGroup:
        state = stack.pop() ?? state;
        break;
      case OPS.beginMarkedContentProps: {
        const [tag, props] = args;
        if (tag === "OC" && props) {
          marked.push(
            props.type === "OCG" && props.id
              ? [props.id]
              : Array.isArray(props.ids)
                ? props.ids
                : null,
          );
        } else {
          marked.push(null);
        }
        break;
      }
      case OPS.beginMarkedContent:
        marked.push(null);
        break;
      case OPS.endMarkedContent:
        marked.pop();
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintImageXObjectRepeat:
        images++;
        break;
    }
  }
  return images;
}

function color(args: any[]): string {
  if (typeof args[0] === "string") return args[0];
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(args[0])}${hex(args[1])}${hex(args[2])}`;
}

function isWhite(c: string): boolean {
  const v = c.toLowerCase();
  return v === "#ffffff" || v === "#fff" || v === "white";
}
