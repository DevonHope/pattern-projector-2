// Vector line weight: changes the stroke width of every line pdf.js draws,
// before it is rasterised, so lines stay crisp at any weight (unlike the
// pixel "thicken" filter in erode.ts, which can only make lines heavier).

export interface LineWeight {
  // Multiplier applied to each line's own width from the PDF. 1 = original.
  scale: number;
  // Lines are never drawn thinner than this many millimetres on the mat
  // (after calibration). 0 = no minimum.
  minMm: number;
}

export const DEFAULT_LINE_WEIGHT: LineWeight = { scale: 1, minMm: 0 };

export const LINE_SCALE_MIN = 0.25;
export const LINE_SCALE_MAX = 6;
export const LINE_SCALE_STEP = 0.25;
export const LINE_MIN_MM_OPTIONS = [0, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2];

const MM_PER_PDF_POINT = 25.4 / 72;

export function isDefaultLineWeight(lw: LineWeight): boolean {
  return lw.scale === 1 && lw.minMm === 0;
}

export function parseLineWeight(value: string | null): LineWeight {
  if (!value) return DEFAULT_LINE_WEIGHT;
  try {
    const parsed = JSON.parse(value);
    const scale = Number(parsed.scale);
    const minMm = Number(parsed.minMm);
    return {
      scale:
        Number.isFinite(scale) && scale > 0
          ? Math.min(Math.max(scale, LINE_SCALE_MIN), LINE_SCALE_MAX)
          : 1,
      minMm: Number.isFinite(minMm) && minMm > 0 ? minMm : 0,
    };
  } catch {
    return DEFAULT_LINE_WEIGHT;
  }
}

/**
 * Width (in the context's current user units) a stroke should use.
 * `currentWidth` is the width pdf.js set; `devicePxPerUnit` is how many canvas
 * pixels one current user unit covers; `devicePxPerMm` converts the minimum.
 */
export function adjustedWidth(
  currentWidth: number,
  lw: LineWeight,
  devicePxPerUnit: number,
  devicePxPerMm: number,
): number {
  // pdf.js uses width 0 for "thinnest possible line" (one device pixel).
  const base = currentWidth > 0 ? currentWidth : 1 / devicePxPerUnit;
  let width = base * lw.scale;
  if (lw.minMm > 0 && devicePxPerUnit > 0) {
    const minUnits = (lw.minMm * devicePxPerMm) / devicePxPerUnit;
    width = Math.max(width, minUnits);
  }
  return width;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface HookState {
  lineWeight: LineWeight;
  // Canvas pixels per PDF point at the page's render scale.
  devicePxPerPoint: number;
}

const HOOK = Symbol("lineWeightHook");

/**
 * Installs (once per context) a wrapper around stroke()/strokeRect() that
 * rescales line width, and sets the settings the wrapper reads for the next
 * render. Safe to call before every render.
 */
export function setLineWeightHook(
  ctx: Ctx2D,
  lineWeight: LineWeight,
  renderScale: number,
) {
  const target = ctx as Ctx2D & { [HOOK]?: HookState };
  const state: HookState = {
    lineWeight,
    devicePxPerPoint: renderScale,
  };
  if (target[HOOK]) {
    target[HOOK] = state;
    return;
  }
  target[HOOK] = state;

  const proto = Object.getPrototypeOf(ctx);
  const origStroke = proto.stroke as (...args: unknown[]) => void;
  const origStrokeRect = proto.strokeRect as (
    x: number,
    y: number,
    w: number,
    h: number,
  ) => void;

  function withWidth(draw: () => void) {
    const s = target[HOOK];
    if (!s || isDefaultLineWeight(s.lineWeight)) {
      draw();
      return;
    }
    const m = ctx.getTransform();
    // Average scale of the current transform: canvas px per user unit.
    const devicePxPerUnit = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const devicePxPerMm = s.devicePxPerPoint / MM_PER_PDF_POINT;
    const previous = ctx.lineWidth;
    ctx.lineWidth = adjustedWidth(
      previous,
      s.lineWeight,
      devicePxPerUnit,
      devicePxPerMm,
    );
    try {
      draw();
    } finally {
      ctx.lineWidth = previous;
    }
  }

  Object.defineProperty(ctx, "stroke", {
    configurable: true,
    writable: true,
    value: function (...args: unknown[]) {
      withWidth(() => origStroke.apply(ctx, args));
    },
  });
  Object.defineProperty(ctx, "strokeRect", {
    configurable: true,
    writable: true,
    value: function (x: number, y: number, w: number, h: number) {
      withWidth(() => origStrokeRect.call(ctx, x, y, w, h));
    },
  });
}

/**
 * SVG patterns: scale every stroked element's width in place. The original
 * width is remembered on the element so repeated changes don't compound.
 */
export function applyLineWeightToSvg(svg: SVGSVGElement, lw: LineWeight) {
  const view = svg.ownerDocument.defaultView;
  if (!view) return;
  const elements = svg.querySelectorAll<SVGGraphicsElement>(
    "path, line, polyline, polygon, rect, circle, ellipse",
  );
  elements.forEach((el) => {
    let original = el.getAttribute("data-pp-stroke-width");
    if (original === null) {
      original = view.getComputedStyle(el).strokeWidth || "1";
      el.setAttribute("data-pp-stroke-width", original);
    }
    if (isDefaultLineWeight(lw)) {
      el.style.removeProperty("stroke-width");
      return;
    }
    const px = parseFloat(original);
    if (!Number.isFinite(px)) return;
    el.style.setProperty("stroke-width", `${px * lw.scale}px`);
  });
}
