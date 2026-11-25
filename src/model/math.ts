export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const EPS = 1e-9;

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Fixed decimals, without "-0.00". */
export const fmt = (v: number, d = 2): string => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);

export const round = (v: number, d: number): number => Number(v.toFixed(d));

/** A finite number, or the fallback. */
export const num = (v: unknown, fallback: number): number => (typeof v === "number" && isFinite(v) ? v : fallback);

export function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

/** Wrap an angle into [-180, 180). */
export const wrapDeg = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

export const nextId = (list: { id: number }[]): number => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
