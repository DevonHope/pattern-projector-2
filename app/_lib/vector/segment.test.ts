import { segment } from "./segment";
import { VectorItem, bboxOfPoints, clipPolyline } from "./types";
import {
  apply,
  invert,
  mul,
  reflection,
  rotation,
  translation,
} from "./affine";
import {
  MARKINGS,
  foldLineAt,
  initialDoc,
  itemAt,
  itemsByLayer,
  layerAt,
  layerMatrix,
  restoreDoc,
  toSaved,
} from "./layers";

const IN = 96;

function line(items: VectorItem[], coords: number[], page = 0) {
  const pts = new Float32Array(coords.map((v) => v * IN));
  items.push({
    id: items.length,
    kind: "path",
    d: "",
    stroke: "#000000",
    fill: null,
    width: 1,
    pts,
    bbox: bboxOfPoints(pts),
    ocg: null,
    page,
  });
}

function rect(
  items: VectorItem[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  line(items, [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]);
}

function text(
  items: VectorItem[],
  str: string,
  x: number,
  y: number,
  size: number,
) {
  const pts = new Float32Array([x * IN, y * IN, (x + 1) * IN, (y + 0.3) * IN]);
  items.push({
    id: items.length,
    kind: "text",
    text: { str, m: [1, 0, 0, 1, 0, 0], length: 0, size },
    pts,
    bbox: bboxOfPoints(pts),
    ocg: null,
    page: 0,
  });
}

function pattern() {
  const items: VectorItem[] = [];
  // Page border around everything.
  rect(items, 0.25, 0.25, 19.75, 19.75); // 0
  // Piece A drawn as four separate edges (like many PDFs do).
  line(items, [2, 2, 8, 2]); // 1
  line(items, [8, 2, 8, 10]); // 2
  line(items, [8, 10, 2, 10]); // 3
  line(items, [2, 10, 2, 2]); // 4
  line(items, [5, 3, 5, 9]); // 5 grainline inside A
  text(items, "FRONT", 3, 5, 30); // 6
  text(items, "cut 2", 3, 6, 12); // 7
  // Piece B: one closed path with a seam line inside it.
  rect(items, 11, 3, 17, 15); // 8
  rect(items, 11.5, 3.5, 16.5, 14.5); // 9
  // 1 inch test square and a title, outside every piece.
  rect(items, 2, 15, 3, 16); // 10
  text(items, "My Pattern", 2, 17, 40); // 11
  return items;
}

describe("segment", () => {
  const items = pattern();
  const s = segment(items, 20 * IN, 20 * IN, [[0, 0, 20 * IN, 20 * IN]]);

  it("finds two pieces", () => {
    expect(s.pieces.length).toBe(2);
  });

  it("groups fragmented edges, grainline and labels into piece A", () => {
    const a = s.pieceOf[1];
    expect(a).toBeGreaterThanOrEqual(0);
    for (const id of [2, 3, 4, 5, 6, 7]) expect(s.pieceOf[id]).toBe(a);
    expect(s.pieces[a].name).toBe("FRONT");
  });

  it("keeps nested lines with their outer outline", () => {
    expect(s.pieceOf[8]).toBeGreaterThanOrEqual(0);
    expect(s.pieceOf[9]).toBe(s.pieceOf[8]);
    expect(s.pieceOf[8]).not.toBe(s.pieceOf[1]);
  });

  it("leaves the page border, test square and title as markings", () => {
    expect(items[0].frame).toBe(true);
    expect(s.pieceOf[0]).toBe(-1);
    expect(s.pieceOf[10]).toBe(-1);
    expect(s.pieceOf[11]).toBe(-1);
  });

  it("numbers pieces left to right", () => {
    expect(s.pieces[0].bbox[0]).toBeLessThan(s.pieces[1].bbox[0]);
  });
});

describe("layers", () => {
  const items = pattern();
  const extract = {
    items,
    pages: [[0, 0, 20 * IN, 20 * IN] as [number, number, number, number]],
    width: 20 * IN,
    height: 20 * IN,
    imageCount: 0,
    defs: "",
  };
  const s = segment(items, extract.width, extract.height, extract.pages);
  const fresh = initialDoc(extract, s, (n) => `Piece ${n}`);

  it("makes one layer per piece and puts the rest in markings", () => {
    expect(fresh.layers.length).toBe(2);
    expect(fresh.owner[0]).toBe(MARKINGS);
    expect(fresh.owner[5]).toBe(fresh.layers[0].id);
  });

  it("restores saved ticks and moves for the same layout only", () => {
    const changed = {
      ...fresh,
      layers: fresh.layers.map((l, i) =>
        i === 0 ? { ...l, cut: true, dx: 50 } : l,
      ),
      owner: { ...fresh.owner, 9: MARKINGS },
    };
    const saved = toSaved(changed, fresh, "sig1");
    expect(saved.moved).toEqual({ 9: MARKINGS });
    const back = restoreDoc(fresh, JSON.parse(JSON.stringify(saved)), "sig1");
    expect(back.layers[0].cut).toBe(true);
    expect(back.layers[0].dx).toBe(50);
    expect(back.owner[9]).toBe(MARKINGS);
    expect(restoreDoc(fresh, saved, "other").layers[0].cut).toBe(false);
  });

  it("taps hit a moved, rotated piece where it is drawn", () => {
    const layer = { ...fresh.layers[0], dy: 8 * IN, rotation: 90 };
    const doc = { ...fresh, layers: [layer, fresh.layers[1]] };
    const view = { isolate: false, selected: null, showMarkings: true };
    const byLayer = new Map([
      [layer.id, items.filter((i) => fresh.owner[i.id] === layer.id)],
      [fresh.layers[1].id, []],
    ]);
    // A point inside the original piece, mapped through the layer matrix.
    const [x, y] = apply(layerMatrix(layer), 4 * IN, 4 * IN);
    expect(layerAt(doc, view, s.grid, byLayer, x, y, 5)).toBe(layer.id);
    // The piece's old spot is now empty.
    expect(layerAt(doc, view, s.grid, byLayer, 4 * IN, 4 * IN, 5)).toBe(null);
  });

  it("picks the tapped straight edge as the fold line", () => {
    const layer = fresh.layers[0];
    const own = items.filter((i) => fresh.owner[i.id] === layer.id);
    const fold = foldLineAt(layer, own, 2 * IN + 2, 6 * IN, 10);
    expect(fold).toEqual([2 * IN, 10 * IN, 2 * IN, 2 * IN]);
  });
});

describe("affine", () => {
  it("inverts and composes", () => {
    const m = mul(translation(5, 7), rotation(30));
    const [x, y] = apply(m, 3, 4);
    const [bx, by] = apply(invert(m), x, y);
    expect(bx).toBeCloseTo(3);
    expect(by).toBeCloseTo(4);
  });

  it("reflects across a line", () => {
    const r = reflection(0, 0, 0, 10); // the y axis
    const [x, y] = apply(r, 3, 4);
    expect(x).toBeCloseTo(-3);
    expect(y).toBeCloseTo(4);
  });
});

describe("picking lines", () => {
  it("prefers a nearby line over a label whose box contains the tap", () => {
    const items = pattern();
    const extract = {
      items,
      pages: [[0, 0, 20 * IN, 20 * IN] as [number, number, number, number]],
      width: 20 * IN,
      height: 20 * IN,
      imageCount: 0,
      defs: "",
    };
    const s = segment(items, extract.width, extract.height, extract.pages);
    const doc = initialDoc(extract, s, (n) => `Piece ${n}`);
    const view = { isolate: false, selected: null, showMarkings: true };
    const byLayer = itemsByLayer(
      doc.layers.map((l) => l.id),
      doc.owner,
      items,
    );
    // Inside the "FRONT" label's box (3..4, 5..5.3) and 0.1 in from nothing;
    // move the label onto the grainline at x = 5 to make them overlap.
    items[6].bbox = [4.8 * IN, 5 * IN, 5.8 * IN, 5.3 * IN];
    expect(
      itemAt(doc, view, byLayer, new Set(), 5 * IN + 3, 5.1 * IN, 10),
    ).toBe(5);
    // Away from any line, the label is picked.
    expect(itemAt(doc, view, byLayer, new Set(), 5.6 * IN, 5.1 * IN, 10)).toBe(
      6,
    );
  });
});

describe("tiled pages", () => {
  it("never treats a clipped piece edge along a page edge as a border", () => {
    const items: VectorItem[] = [];
    // A fold line running down a whole tile, 0.1 in from its left edge,
    // clipped from a longer line on the full pattern.
    line(items, [0.1, 0, 0.1, 11]);
    items[0].clip = "ppclip0";
    // The same shape drawn by the page itself (a trim line) is a border.
    line(items, [8.4, 0, 8.4, 11]);
    segment(items, 8.5 * IN, 11 * IN, [[0, 0, 8.5 * IN, 11 * IN]]);
    expect(items[0].frame).toBe(false);
    expect(items[1].frame).toBe(true);
  });

  it("finds a piece bigger than any one tile", () => {
    const items: VectorItem[] = [];
    rect(items, 2, 2, 18, 18);
    const tiles: [number, number, number, number][] = [
      [0, 0, 10 * IN, 10 * IN],
      [10 * IN, 0, 20 * IN, 10 * IN],
      [0, 10 * IN, 10 * IN, 20 * IN],
      [10 * IN, 10 * IN, 20 * IN, 20 * IN],
    ];
    const s = segment(items, 20 * IN, 20 * IN, tiles);
    expect(s.pieces.length).toBe(1);
  });

  it("joins a title split into runs back together", () => {
    const items: VectorItem[] = [];
    rect(items, 1, 1, 9, 9);
    text(items, "Wa", 3, 4, 26);
    text(items, "istband", 3.6, 4, 26);
    items[2].bbox[0] = items[1].bbox[2]; // touching runs
    for (const i of [1, 2]) {
      items[i].text!.m = [1, 0, 0, 1, items[i].bbox[0], 4 * IN];
    }
    text(items, "Cut 2", 3, 6, 12);
    const s = segment(items, 10 * IN, 10 * IN, [[0, 0, 10 * IN, 10 * IN]]);
    expect(s.pieces[0].name).toBe("Waistband");
  });
});

describe("clipPolyline", () => {
  it("cuts segments exactly at the edge and drops what is outside", () => {
    const out = clipPolyline(
      new Float32Array([-10, 5, 10, 5, 10, 20, 30, 20]),
      [0, 0, 20, 10],
    );
    expect(Array.from(out)).toEqual([0, 5, 10, 5, 10, 10]);
  });
});

describe("pieces laid out close together", () => {
  it("keeps two outlines 0.08 in apart as separate pieces", () => {
    const items: VectorItem[] = [];
    rect(items, 1, 1, 6, 9);
    rect(items, 6.08, 1, 11, 9);
    const s = segment(items, 12 * IN, 10 * IN, [[0, 0, 12 * IN, 10 * IN]]);
    expect(s.pieces.length).toBe(2);
    expect(s.pieceOf[0]).not.toBe(s.pieceOf[1]);
  });
});
