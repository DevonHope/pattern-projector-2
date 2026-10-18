import { CM, IN } from "./unit";
import {
  MAT_PRESET_GROUPS,
  findMatchingPreset,
  presetCalibration,
  presetDimensions,
} from "./mat-presets";

const all = MAT_PRESET_GROUPS.flatMap((g) => g.presets);
const byId = (id: string) => all.find((p) => p.id === id)!;

describe("mat presets", () => {
  it("has every A size from 4A0 to A10", () => {
    const ids = MAT_PRESET_GROUPS.find((g) => g.id === "isoA")!.presets.map(
      (p) => p.id,
    );
    expect(ids).toEqual([
      "4A0", "2A0", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10",
    ]);
  });

  it("has unique ids and long side >= short side", () => {
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    for (const p of all) expect(p.long).toBeGreaterThanOrEqual(p.short);
  });

  it("formats dimensions for the dropdown", () => {
    expect(presetDimensions(byId("A0"))).toBe("1189 × 841 mm");
    expect(presetDimensions(byId("letter"))).toBe("11 × 8.5 in");
    expect(presetDimensions(byId("doubleElephant"))).toBe("40 × 26.75 in");
  });

  it("converts A sizes to cm and imperial sizes to inches, landscape", () => {
    expect(presetCalibration(byId("A1"))).toEqual({
      width: "84.1",
      height: "59.4",
      unitOfMeasure: CM,
    });
    expect(presetCalibration(byId("archD"))).toEqual({
      width: "36",
      height: "24",
      unitOfMeasure: IN,
    });
  });

  it("recognises the current size in either orientation", () => {
    expect(findMatchingPreset("84.1", "59.4", CM)?.id).toBe("A1");
    expect(findMatchingPreset("8.5", "11", IN)?.id).toBe("letter");
    expect(findMatchingPreset("24", "16", IN)).toBeNull();
    expect(findMatchingPreset("84.1", "59.4", IN)).toBeNull();
  });
});
