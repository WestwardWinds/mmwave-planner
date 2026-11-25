import { D2R } from "./math";
import type { Obstacle, Vec3 } from "./types";

/**
 * An obstacle prepared for one viewpoint: its rotation, half sizes, and the viewpoint expressed in
 * the box's own frame, so each line-of-sight test is a cheap slab test.
 */
export interface Occluder {
  box: Obstacle;
  toLocal: (x: number, y: number, z: number) => Vec3;
  half: Vec3;
  /** the viewpoint (sensor) in box coordinates */
  from: Vec3;
}

export function prepareOccluders(obstacles: Obstacle[], from: { x: number; y: number; z: number }): Occluder[] {
  return obstacles.map((box) => {
    const c = Math.cos(box.rot * D2R), sn = Math.sin(box.rot * D2R), cz = box.z + box.h / 2;
    const toLocal = (x: number, y: number, z: number): Vec3 => {
      const dx = x - box.x, dy = y - box.y;
      return [dx * c + dy * sn, -dx * sn + dy * c, z - cz];
    };
    return { box, toLocal, half: [box.w / 2, box.d / 2, box.h / 2], from: toLocal(from.x, from.y, from.z) };
  });
}

/** Does the segment viewpoint -> P (P in box coordinates) touch the box? */
export function segmentHits(o: Occluder, P: Vec3): boolean {
  const A = o.from, H = o.half;
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const D = P[i] - A[i];
    if (Math.abs(D) < 1e-12) {
      if (Math.abs(A[i]) > H[i]) return false;
      continue;
    }
    let ta = (-H[i] - A[i]) / D, tb = (H[i] - A[i]) / D;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

export const insideBox = (o: Occluder, P: Vec3): boolean =>
  Math.abs(P[0]) <= o.half[0] && Math.abs(P[1]) <= o.half[1] && Math.abs(P[2]) <= o.half[2];

/** The first obstacle that blocks the straight line to (x, y, z), or null. */
export function blockerFor(occ: Occluder[], x: number, y: number, z: number): Obstacle | null {
  for (const o of occ) if (segmentHits(o, o.toLocal(x, y, z))) return o.box;
  return null;
}
