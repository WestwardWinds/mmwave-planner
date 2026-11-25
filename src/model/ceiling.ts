import type { Room } from "./types";

/** A ceiling plane z = a*x + b*y + c in the user frame. */
export interface CeilPlane {
  a: number;
  b: number;
  c: number;
}

export const isPitched = (room: Room): boolean => room.ceiling !== "flat";

/** Highest ceiling point. A peak below the wall height is treated as flat. */
export const peakZ = (room: Room): number => (isPitched(room) ? Math.max(room.peak, room.h) : room.h);

/**
 * The ceiling is the lowest of these planes at any (x, y).
 * single: rises from wall height on the `low` wall to the peak on the opposite wall.
 * double: rises from wall height on both sides to the peak along a centered ridge.
 */
export function ceilPlanes(room: Room): CeilPlane[] {
  const { w, d, h, ceiling, low, ridge } = room;
  const p = peakZ(room);
  const s = p - h;
  if (ceiling === "single") {
    switch (low) {
      case "x0": return [{ a: s / w, b: 0, c: h }];
      case "xW": return [{ a: -s / w, b: 0, c: p }];
      case "y0": return [{ a: 0, b: s / d, c: h }];
      case "yD": return [{ a: 0, b: -s / d, c: p }];
    }
  }
  if (ceiling === "double") {
    return ridge === "x"
      ? [{ a: 0, b: (2 * s) / d, c: h }, { a: 0, b: (-2 * s) / d, c: h + 2 * s }]
      : [{ a: (2 * s) / w, b: 0, c: h }, { a: (-2 * s) / w, b: 0, c: h + 2 * s }];
  }
  return [{ a: 0, b: 0, c: h }];
}

export function ceilAt(planes: CeilPlane[], x: number, y: number): number {
  let z = Infinity;
  for (const q of planes) z = Math.min(z, q.a * x + q.b * y + q.c);
  return z;
}

/** The plane that forms the ceiling at (x, y). */
export function ceilPlaneAt(planes: CeilPlane[], x: number, y: number): CeilPlane {
  let best = planes[0];
  let z = Infinity;
  for (const q of planes) {
    const v = q.a * x + q.b * y + q.c;
    if (v < z) { z = v; best = q; }
  }
  return best;
}

/** Where to put the "peak" label: the middle of the ridge, or the middle of the high wall. */
export function peakPoint(room: Room): [number, number, number] {
  const { w, d, ceiling, low } = room;
  const p = peakZ(room);
  if (ceiling === "double") return [w / 2, d / 2, p];
  return ({ y0: [w / 2, d, p], yD: [w / 2, 0, p], x0: [w, d / 2, p], xW: [0, d / 2, p] } as const)[low].slice() as [number, number, number];
}

/** The shortest corner post (always at wall height): where the wall-height label goes. */
export function lowCorner(room: Room): [number, number] {
  const planes = ceilPlanes(room);
  const corners: [number, number][] = [[room.w, 0], [0, 0], [room.w, room.d], [0, room.d]];
  return corners.reduce((best, c) => (ceilAt(planes, c[0], c[1]) < ceilAt(planes, best[0], best[1]) - 1e-6 ? c : best));
}
