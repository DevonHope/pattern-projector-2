// Pull drawable elements out of an SVG pattern (shown in an <object>) as
// self-contained fragments in layout coordinates.

import { Affine, apply, mul, scaleOf, scaling, toSvg } from "./affine";
import { ExtractResult, VectorItem, bboxOfPoints } from "./types";

const SHAPES = "path, line, polyline, polygon, rect, circle, ellipse";
const SKIP_INSIDE = "defs, clipPath, mask, marker, symbol, pattern";
const MAX_SAMPLES = 1500;

export function extractSvg(
  svg: SVGSVGElement,
  patternScale: number,
  width: number,
  height: number,
): ExtractResult {
  const view = svg.ownerDocument.defaultView!;
  const items: VectorItem[] = [];
  const root: Affine = scaling(patternScale);
  const elements = svg.querySelectorAll<SVGGraphicsElement>(
    `${SHAPES}, text, use`,
  );
  // The viewer scales the root <svg> with CSS; take that off while measuring
  // so getCTM() gives plain user units on every browser.
  const savedStyle = svg.getAttribute("style");
  svg.removeAttribute("style");

  elements.forEach((el) => {
    if (el.closest(SKIP_INSIDE)) return;
    // Text spans are handled with their <text>.
    if (el.tagName === "use" && el.closest("text")) return;
    const style = view.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      // Still extract elements hidden only by an Inkscape layer toggle.
      if (!layerOf(el)) return;
    }
    const ctm = el.getCTM();
    if (!ctm) return;
    const m = mul(root, [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f]);
    const isShape = el.matches(SHAPES);

    let pts: Float32Array;
    if (isShape) {
      pts = samplePath(el as SVGGeometryElement, m);
    } else {
      let box: DOMRect;
      try {
        box = el.getBBox();
      } catch {
        return;
      }
      const corners = [
        apply(m, box.x, box.y),
        apply(m, box.x + box.width, box.y),
        apply(m, box.x, box.y + box.height),
        apply(m, box.x + box.width, box.y + box.height),
      ];
      pts = new Float32Array(corners.flat());
    }
    if (pts.length === 0) return;

    const clone = el.cloneNode(true) as SVGElement;
    clone.removeAttribute("class");
    clone.removeAttribute("id");
    clone.removeAttribute("style");
    clone.setAttribute("transform", toSvg(m));
    const original = el.getAttribute("data-pp-stroke-width");
    const strokeWidth = parseFloat(original ?? style.strokeWidth) || 0;
    const css: string[] = [
      `fill:${style.fill}`,
      `stroke:${style.stroke}`,
      `stroke-width:__SW__`,
      `stroke-linecap:${style.strokeLinecap}`,
      `stroke-linejoin:${style.strokeLinejoin}`,
    ];
    if (style.strokeDasharray && style.strokeDasharray !== "none") {
      css.push(`stroke-dasharray:${style.strokeDasharray}`);
    }
    if (style.opacity !== "1") css.push(`opacity:${style.opacity}`);
    if (el.tagName === "text") {
      css.push(
        `font-size:${style.fontSize}`,
        `font-family:${style.fontFamily.replace(/"/g, "'")}`,
        `font-weight:${style.fontWeight}`,
        `text-anchor:${style.textAnchor}`,
      );
    }
    clone.setAttribute("style", css.join(";"));
    const markup = new XMLSerializer()
      .serializeToString(clone)
      .replace(/ xmlns="[^"]*"/g, "");

    const layer = layerOf(el);
    items.push({
      id: items.length,
      kind: el.tagName === "text" ? "text" : "svg",
      box: !isShape,
      svg: markup,
      width: strokeWidth,
      unitScale: scaleOf(m),
      stroke: style.stroke === "none" ? null : style.stroke,
      text:
        el.tagName === "text"
          ? {
              str: el.textContent ?? "",
              m,
              length: 0,
              size: (parseFloat(style.fontSize) || 12) * scaleOf(m),
            }
          : undefined,
      pts,
      bbox: bboxOfPoints(pts),
      ocg: layer ? [layer] : null,
      page: -1,
    });
  });

  if (savedStyle !== null) svg.setAttribute("style", savedStyle);

  const defs = Array.from(svg.querySelectorAll("defs"))
    .map((d) => d.innerHTML)
    .join("");

  return {
    items,
    pages: [[0, 0, width, height]],
    width,
    height,
    imageCount: svg.querySelectorAll("image").length,
    defs,
  };
}

function layerOf(el: Element): string | null {
  let node: Element | null = el.parentElement;
  let found: string | null = null;
  while (node) {
    if (
      node.tagName === "g" &&
      node.getAttribute("inkscape:groupmode") === "layer" &&
      node.id
    ) {
      found = node.id; // outermost layer wins, matching the Layers menu
    }
    node = node.parentElement;
  }
  return found;
}

function samplePath(el: SVGGeometryElement, m: Affine): Float32Array {
  let length = 0;
  try {
    length = el.getTotalLength();
  } catch {
    return new Float32Array();
  }
  if (!Number.isFinite(length) || length <= 0) return new Float32Array();
  const scale = scaleOf(m) || 1;
  // About one sample per 2 layout px, capped.
  const count = Math.max(
    2,
    Math.min(MAX_SAMPLES, Math.ceil((length * scale) / 2)),
  );
  const step = length / count;
  const out: number[] = [];
  let px = NaN;
  let py = NaN;
  for (let i = 0; i <= count; i++) {
    const p = el.getPointAtLength(Math.min(length, i * step));
    const [x, y] = apply(m, p.x, p.y);
    // A jump far longer than the step is a new subpath (a move-to).
    if (!Number.isNaN(px) && Math.hypot(x - px, y - py) > step * scale * 3) {
      out.push(NaN, NaN);
    }
    out.push(x, y);
    px = x;
    py = y;
  }
  return new Float32Array(out);
}
