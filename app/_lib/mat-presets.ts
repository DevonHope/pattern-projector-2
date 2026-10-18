import { CM, IN } from "@/_lib/unit";

// Preset mat sizes for the calibration grid. Sizes are landscape
// (width = long side), the way a projector usually covers a mat.

export interface MatPreset {
  id: string;
  label: string;
  // Long and short side in `displayUnit`, as printed next to the label.
  long: number;
  short: number;
  displayUnit: "mm" | "in";
}

export type MatPresetGroupId = "isoA" | "us" | "arch" | "britishImperial";

export interface MatPresetGroup {
  id: MatPresetGroupId;
  presets: MatPreset[];
}

function iso(label: string, shortMm: number, longMm: number): MatPreset {
  return {
    id: label,
    label,
    long: longMm,
    short: shortMm,
    displayUnit: "mm",
  };
}

function imperial(
  id: string,
  label: string,
  short: number,
  long: number,
): MatPreset {
  return { id, label, long, short, displayUnit: "in" };
}

export const MAT_PRESET_GROUPS: MatPresetGroup[] = [
  {
    // ISO 216 A series.
    id: "isoA",
    presets: [
      iso("4A0", 1682, 2378),
      iso("2A0", 1189, 1682),
      iso("A0", 841, 1189),
      iso("A1", 594, 841),
      iso("A2", 420, 594),
      iso("A3", 297, 420),
      iso("A4", 210, 297),
      iso("A5", 148, 210),
      iso("A6", 105, 148),
      iso("A7", 74, 105),
      iso("A8", 52, 74),
      iso("A9", 37, 52),
      iso("A10", 26, 37),
    ],
  },
  {
    // North American sizes (ANSI/US).
    id: "us",
    presets: [
      imperial("letter", "Letter (ANSI A)", 8.5, 11),
      imperial("legal", "Legal", 8.5, 14),
      imperial("tabloid", "Tabloid / Ledger (ANSI B)", 11, 17),
      imperial("ansiC", "ANSI C", 17, 22),
      imperial("ansiD", "ANSI D", 22, 34),
      imperial("ansiE", "ANSI E", 34, 44),
      imperial("executive", "Executive", 7.25, 10.5),
      imperial("halfLetter", "Half Letter (Statement)", 5.5, 8.5),
      imperial("juniorLegal", "Junior Legal", 5, 8),
      imperial("govLetter", "Government Letter", 8, 10.5),
      imperial("govLegal", "Government Legal", 8.5, 13),
    ],
  },
  {
    // US architectural sizes.
    id: "arch",
    presets: [
      imperial("archA", "Arch A", 9, 12),
      imperial("archB", "Arch B", 12, 18),
      imperial("archC", "Arch C", 18, 24),
      imperial("archD", "Arch D", 24, 36),
      imperial("archE", "Arch E", 36, 48),
      imperial("archE1", "Arch E1", 30, 42),
      imperial("archE2", "Arch E2", 26, 38),
      imperial("archE3", "Arch E3", 27, 39),
    ],
  },
  {
    // Traditional British imperial sheet sizes.
    id: "britishImperial",
    presets: [
      imperial("foolscap", "Foolscap", 13.5, 17),
      imperial("crown", "Crown", 15, 20),
      imperial("demy", "Demy", 17.5, 22.5),
      imperial("medium", "Medium", 18, 23),
      imperial("royal", "Royal", 20, 25),
      imperial("superRoyal", "Super Royal", 20.5, 27.5),
      imperial("doubleCrown", "Double Crown", 20, 30),
      imperial("imperial", "Imperial", 22, 30),
      imperial("elephant", "Elephant", 23, 28),
      imperial("columbier", "Columbier", 23.5, 34.5),
      imperial("atlas", "Atlas", 26, 34),
      imperial("quadCrown", "Quad Crown", 30, 40),
      imperial("doubleElephant", "Double Elephant", 26.75, 40),
      imperial("antiquarian", "Antiquarian", 31, 53),
    ],
  },
];

function trim(n: number): string {
  // Up to 2 decimals, no trailing zeros: 84.1, 8.5, 26.75, 24.
  return String(Math.round(n * 100) / 100);
}

/** Small dimension text shown next to a preset, e.g. "1189 × 841 mm". */
export function presetDimensions(p: MatPreset): string {
  return `${trim(p.long)} × ${trim(p.short)} ${p.displayUnit}`;
}

/** Values to put in the calibration width/height/unit fields. */
export function presetCalibration(p: MatPreset): {
  width: string;
  height: string;
  unitOfMeasure: string;
} {
  if (p.displayUnit === "mm") {
    return {
      width: trim(p.long / 10),
      height: trim(p.short / 10),
      unitOfMeasure: CM,
    };
  }
  return { width: trim(p.long), height: trim(p.short), unitOfMeasure: IN };
}

/** The preset matching the current fields (either orientation), if any. */
export function findMatchingPreset(
  width: string,
  height: string,
  unitOfMeasure: string,
): MatPreset | null {
  const w = Number(width);
  const h = Number(height);
  for (const group of MAT_PRESET_GROUPS) {
    for (const p of group.presets) {
      const c = presetCalibration(p);
      if (c.unitOfMeasure !== unitOfMeasure) continue;
      const pw = Number(c.width);
      const ph = Number(c.height);
      if ((pw === w && ph === h) || (pw === h && ph === w)) return p;
    }
  }
  return null;
}
