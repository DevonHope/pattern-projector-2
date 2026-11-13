import { Matrix, inverse } from "ml-matrix";
import React, { useMemo, useRef } from "react";
import { transformPoint } from "@/_lib/geometry";
import { useTransformContext } from "@/_hooks/use-transform-context";
import { VectorPattern } from "@/_hooks/use-vector-pattern";
import { LineWeight } from "@/_lib/line-weight";
import { toSvg } from "@/_lib/vector/affine";
import {
  MARKINGS,
  foldLineAt,
  itemAt,
  itemsMarkup,
  layerAt,
  layerCopies,
  layerOutline,
  shownLayers,
} from "@/_lib/vector/layers";

const HIGHLIGHT = "#9333ea"; // purple-600, matches the app's buttons
const TAP_SLOP_PX = 6;
const TAP_TOLERANCE_PX = 14;

// Draws the pattern from its vector pieces, each piece as its own layer.
// Sits in the same transformed box as the PDF/SVG viewer, so it lines up
// with the calibration exactly.
export default function VectorPatternView({
  vector,
  perspective,
  lineWeight,
  hidden,
  filter,
  width,
  height,
  interactive,
}: {
  vector: VectorPattern;
  perspective: Matrix;
  lineWeight: LineWeight;
  hidden: Set<string>;
  filter: string;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const local = useTransformContext();
  const { extract, doc, view, byLayer, tool } = vector;

  const markup = useMemo(() => {
    const map = new Map<string, string>();
    byLayer.forEach((items, id) =>
      map.set(id, itemsMarkup(items, lineWeight, hidden)),
    );
    return map;
  }, [byLayer, lineWeight, hidden]);

  const down = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);

  if (!extract) return null;

  function toLayout(clientX: number, clientY: number) {
    const p = transformPoint({ x: clientX, y: clientY }, perspective);
    return transformPoint(p, inverse(local));
  }

  // Layout px covered by a few screen px at the current zoom.
  function tolerance(clientX: number, clientY: number) {
    const a = toLayout(clientX, clientY);
    const b = toLayout(clientX + TAP_TOLERANCE_PX, clientY);
    return Math.max(2, Math.hypot(b.x - a.x, b.y - a.y));
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!interactive) return;
    down.current = { x: e.clientX, y: e.clientY };
    if (tool !== "move" || !view.selected) return;
    const p = toLayout(e.clientX, e.clientY);
    const hit = layerAt(
      doc,
      view,
      vector.seg?.grid ?? null,
      byLayer,
      p.x,
      p.y,
      tolerance(e.clientX, e.clientY),
    );
    const layer = vector.selectedLayer;
    if (hit && layer && hit === layer.id) {
      // Dragging the selected piece moves just that piece.
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      drag.current = { id: hit, x: p.x, y: p.y, dx: layer.dx, dy: layer.dy };
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const p = toLayout(e.clientX, e.clientY);
    vector.updateLayer(d.id, { dx: d.dx + p.x - d.x, dy: d.dy + p.y - d.y });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (drag.current) {
      e.stopPropagation();
      drag.current = null;
      down.current = null;
      return;
    }
    const start = down.current;
    down.current = null;
    if (!interactive || !start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) {
      return; // that was a pan of the whole pattern
    }
    const p = toLayout(e.clientX, e.clientY);
    const tol = tolerance(e.clientX, e.clientY);
    if (tool === "move") {
      vector.select(
        layerAt(doc, view, vector.seg?.grid ?? null, byLayer, p.x, p.y, tol),
      );
    } else if (tool === "lines") {
      const item = itemAt(doc, view, byLayer, hidden, p.x, p.y, tol);
      if (item !== null) vector.toggleItem(item);
    } else if (tool === "fold") {
      const layer = vector.selectedLayer;
      if (!layer) return;
      const line = foldLineAt(
        layer,
        byLayer.get(layer.id) ?? [],
        p.x,
        p.y,
        tol,
      );
      if (line) {
        vector.updateLayer(layer.id, { fold: line });
        vector.setTool("move");
      }
    }
  }

  const shown = vector.patternHidden ? [] : shownLayers(doc, view);
  const selected = vector.selectedLayer;
  const selectedItems = new Set(vector.selectedItems);
  const ownerOf = (id: number) => doc.owner[id] ?? MARKINGS;
  const layerById = new Map(doc.layers.map((l) => [l.id, l]));

  return (
    <div
      className="absolute top-0 left-0"
      style={{ width, height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg
        className="absolute top-0 left-0"
        width={width}
        height={height}
        style={{ overflow: "visible", filter }}
      >
        <defs dangerouslySetInnerHTML={{ __html: extract.defs }} />
        {/* Catches taps between lines, so empty space inside a piece counts. */}
        <rect
          x={-width}
          y={-height}
          width={width * 3}
          height={height * 3}
          fill="transparent"
        />
        {!vector.patternHidden && view.showMarkings && !view.isolate && (
          <g dangerouslySetInnerHTML={{ __html: markup.get(MARKINGS) ?? "" }} />
        )}
        {shown.map((l) =>
          layerCopies(l).map((m, k) => (
            <g
              key={`${l.id}:${k}`}
              transform={toSvg(m)}
              opacity={l.cut ? 0.18 : 1}
              dangerouslySetInnerHTML={{ __html: markup.get(l.id) ?? "" }}
            />
          )),
        )}
      </svg>

      {/* Highlights stay purple whatever the theme filter does. */}
      <svg
        className="absolute top-0 left-0 pointer-events-none"
        width={width}
        height={height}
        style={{ overflow: "visible" }}
      >
        {selected && selected.visible && !vector.patternHidden && (
          <>
            {layerOutline(selected, byLayer.get(selected.id) ?? []).map(
              (o, k) => (
                <polygon
                  key={k}
                  points={o.join(" ")}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  strokeDasharray={k === 0 ? "8 6" : "2 6"}
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
            {selected.fold && (
              <g transform={toSvg(layerCopies(selected)[0])}>
                <FoldLine fold={selected.fold} />
              </g>
            )}
          </>
        )}
        {vector.extract &&
          vector.selectedItems.length > 0 &&
          vector.extract.items
            .filter((i) => selectedItems.has(i.id))
            .map((item) => {
              const layer = layerById.get(ownerOf(item.id));
              const copies = layer ? layerCopies(layer).slice(0, 1) : [null];
              return copies.map((m, k) => (
                <g key={`${item.id}:${k}`} transform={m ? toSvg(m) : undefined}>
                  {item.kind === "path" && item.d ? (
                    <path
                      d={item.d}
                      fill="none"
                      stroke={HIGHLIGHT}
                      strokeWidth={4}
                      strokeOpacity={0.8}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <rect
                      x={item.bbox[0]}
                      y={item.bbox[1]}
                      width={item.bbox[2] - item.bbox[0]}
                      height={item.bbox[3] - item.bbox[1]}
                      fill={HIGHLIGHT}
                      fillOpacity={0.2}
                      stroke={HIGHLIGHT}
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              ));
            })}
      </svg>
    </div>
  );
}

function FoldLine({ fold }: { fold: [number, number, number, number] }) {
  const [x1, y1, x2, y2] = fold;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Draw the fold a bit past the tapped segment so it reads as a line.
  const ext = Math.max(48, len * 0.15);
  const ux = dx / len;
  const uy = dy / len;
  return (
    <line
      x1={x1 - ux * ext}
      y1={y1 - uy * ext}
      x2={x2 + ux * ext}
      y2={y2 + uy * ext}
      stroke={HIGHLIGHT}
      strokeWidth={3}
      strokeDasharray="12 6 2 6"
      vectorEffect="non-scaling-stroke"
    />
  );
}
