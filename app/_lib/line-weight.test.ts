import {
  DEFAULT_LINE_WEIGHT,
  adjustedWidth,
  parseLineWeight,
  setLineWeightHook,
} from "./line-weight";

describe("adjustedWidth", () => {
  it("scales the original width", () => {
    expect(adjustedWidth(2, { scale: 0.5, minMm: 0 }, 4, 10)).toBe(1);
    expect(adjustedWidth(2, { scale: 3, minMm: 0 }, 4, 10)).toBe(6);
  });

  it("treats width 0 as a one-device-pixel hairline", () => {
    // 4 device px per unit -> hairline is 0.25 units; doubled = 0.5.
    expect(adjustedWidth(0, { scale: 2, minMm: 0 }, 4, 10)).toBe(0.5);
  });

  it("enforces the minimum width in millimetres", () => {
    // 1 mm = 10 device px = 2.5 units at 4 px/unit.
    expect(adjustedWidth(1, { scale: 1, minMm: 1 }, 4, 10)).toBe(2.5);
    // Already wider than the minimum: unchanged.
    expect(adjustedWidth(5, { scale: 1, minMm: 1 }, 4, 10)).toBe(5);
  });
});

describe("parseLineWeight", () => {
  it("falls back to the default for missing or bad values", () => {
    expect(parseLineWeight(null)).toEqual(DEFAULT_LINE_WEIGHT);
    expect(parseLineWeight("not json")).toEqual(DEFAULT_LINE_WEIGHT);
  });

  it("clamps the scale", () => {
    expect(parseLineWeight('{"scale":100,"minMm":0.5}')).toEqual({
      scale: 6,
      minMm: 0.5,
    });
  });
});

describe("setLineWeightHook", () => {
  class FakeCtx {
    lineWidth = 1;
    widths: number[] = [];
    getTransform() {
      return { a: 2, b: 0, c: 0, d: 2 }; // 2 device px per unit
    }
    stroke() {
      this.widths.push(this.lineWidth);
    }
    strokeRect() {
      this.widths.push(this.lineWidth);
    }
  }

  it("rescales strokes and restores lineWidth afterwards", () => {
    const ctx = new FakeCtx();
    setLineWeightHook(ctx as any, { scale: 2, minMm: 0 }, 1);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeRect();
    expect(ctx.widths).toEqual([6, 6]);
    expect(ctx.lineWidth).toBe(3);
  });

  it("updates settings without wrapping twice", () => {
    const ctx = new FakeCtx();
    setLineWeightHook(ctx as any, { scale: 2, minMm: 0 }, 1);
    setLineWeightHook(ctx as any, { scale: 0.5, minMm: 0 }, 1);
    ctx.lineWidth = 4;
    ctx.stroke();
    expect(ctx.widths).toEqual([2]);
  });

  it("leaves strokes alone at the default weight", () => {
    const ctx = new FakeCtx();
    setLineWeightHook(ctx as any, DEFAULT_LINE_WEIGHT, 1);
    ctx.lineWidth = 0;
    ctx.stroke();
    expect(ctx.widths).toEqual([0]);
  });
});
