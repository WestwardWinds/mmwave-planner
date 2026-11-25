import { clamp, D2R, R2D } from "./math";
import type { Sensor, Vec3 } from "./types";

/** Unit vectors of a sensor's own frame, in user coordinates: forward, right, up. */
export interface Basis {
  f: Vec3;
  r: Vec3;
  u: Vec3;
}

/** Pan: rotation about Z, 0° faces +Y, 90° faces +X. Tilt: + aims up. Roll: about the facing axis. */
export function sensorBasis(s: Pick<Sensor, "pan" | "tilt" | "roll">): Basis {
  const p = s.pan * D2R, t = s.tilt * D2R, q = s.roll * D2R;
  const f: Vec3 = [Math.cos(t) * Math.sin(p), Math.cos(t) * Math.cos(p), Math.sin(t)];
  const r0: Vec3 = [Math.cos(p), -Math.sin(p), 0];
  const u0: Vec3 = [-Math.sin(t) * Math.sin(p), -Math.sin(t) * Math.cos(p), Math.cos(t)];
  const c = Math.cos(q), sn = Math.sin(q);
  const r: Vec3 = [c * r0[0] + sn * u0[0], c * r0[1] + sn * u0[1], c * r0[2] + sn * u0[2]];
  const u: Vec3 = [-sn * r0[0] + c * u0[0], -sn * r0[1] + c * u0[1], -sn * r0[2] + c * u0[2]];
  return { f, r, u };
}

export interface Polar {
  range: number;
  /** atan2(right, forward), degrees. + is to the sensor's right. */
  az: number;
  /** asin(up / range), degrees. + is above the center line. */
  el: number;
}

/** A spot's distance and angles as the sensor sees it. */
export function localCoords(b: Basis, s: Pick<Sensor, "x" | "y" | "z">, x: number, y: number, z: number): Polar {
  const dx = x - s.x, dy = y - s.y, dz = z - s.z;
  const lx = dx * b.r[0] + dy * b.r[1] + dz * b.r[2];
  const ly = dx * b.f[0] + dy * b.f[1] + dz * b.f[2];
  const lz = dx * b.u[0] + dy * b.u[1] + dz * b.u[2];
  const range = Math.sqrt(lx * lx + ly * ly + lz * lz);
  if (range < 1e-9) return { range: 0, az: 0, el: 0 };
  return { range, az: Math.atan2(lx, ly) * R2D, el: Math.asin(clamp(lz / range, -1, 1)) * R2D };
}

/** Pan and tilt that point a sensor at (x, y, z). Pan is kept when the target is straight above or below. */
export function aimAngles(s: Pick<Sensor, "x" | "y" | "z" | "pan">, x: number, y: number, z: number): { pan: number; tilt: number } | null {
  const dx = x - s.x, dy = y - s.y, dz = z - s.z;
  if (Math.hypot(dx, dy, dz) < 1e-6) return null;
  const horiz = Math.hypot(dx, dy);
  return { pan: horiz > 1e-6 ? Math.atan2(dx, dy) * R2D : s.pan, tilt: Math.atan2(dz, horiz) * R2D };
}

/** Pan and tilt for a facing direction (unit or not). */
export function anglesFromDirection(dir: Vec3, fallbackPan: number): { pan: number; tilt: number } {
  const L = Math.hypot(dir[0], dir[1], dir[2]);
  const f = dir.map((c) => c / L) as Vec3;
  const horiz = Math.hypot(f[0], f[1]);
  return { pan: horiz > 1e-6 ? Math.atan2(f[0], f[1]) * R2D : fallbackPan, tilt: Math.asin(clamp(f[2], -1, 1)) * R2D };
}
