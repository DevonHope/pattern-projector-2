// 2D affine matrices as [a, b, c, d, e, f], the same layout PDF, canvas and
// SVG's matrix() use: x' = a*x + c*y + e, y' = b*x + d*y + f.

export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

// m1 · m2: apply m2 first, then m1.
export function mul(m1: Affine, m2: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) return IDENTITY;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

export function translation(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

export function rotation(degrees: number): Affine {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}

export function scaling(sx: number, sy: number = sx): Affine {
  return [sx, 0, 0, sy, 0, 0];
}

// Mirror across the infinite line through (x1, y1) and (x2, y2).
export function reflection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Affine {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return IDENTITY;
  const ux = dx / len;
  const uy = dy / len;
  const r: Affine = [
    2 * ux * ux - 1,
    2 * ux * uy,
    2 * ux * uy,
    2 * uy * uy - 1,
    0,
    0,
  ];
  return mul(translation(x1, y1), mul(r, translation(-x1, -y1)));
}

// Average linear scale of a matrix (for line widths).
export function scaleOf(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export function toSvg(m: Affine): string {
  return `matrix(${m.map((v) => round(v, 6)).join(" ")})`;
}

export function round(v: number, places = 2): number {
  const p = 10 ** places;
  return Math.round(v * p) / p;
}
