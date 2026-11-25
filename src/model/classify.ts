import { EPS, fmt } from "./math";
import { blockerFor, insideBox, prepareOccluders } from "./occlusion";
import { localCoords, sensorBasis, type Polar } from "./radar";
import type { Obstacle, Sensor, Units } from "./types";
import { fmtLen } from "./units";

/** Why a sensor misses a spot. Kept as data so the wording (and units) are decided at display time. */
export type MissReason =
  | { kind: "range"; by: number }
  | { kind: "hfov"; by: number; behind: boolean }
  | { kind: "vfov"; by: number; above: boolean }
  | { kind: "blocked"; by: string }
  | { kind: "inside"; of: string };

export interface SensorResult extends Polar {
  /** within range and both fields of view */
  inCone: boolean;
  /** in the cone but an obstacle is in the way (or the spot is inside one) */
  blocked: Obstacle | null;
  /** detected by this sensor */
  inside: boolean;
  reasons: MissReason[];
}

/**
 * A spot is in a sensor's cone when it is within max range, |azimuth| <= HFOV/2 and |elevation| <= VFOV/2.
 * It is detected when it is also in the sensor's straight line of sight.
 */
export function classifyFor(s: Sensor, obstacles: Obstacle[], x: number, y: number, z: number): SensorResult {
  const c = localCoords(sensorBasis(s), s, x, y, z);
  const reasons: MissReason[] = [];
  if (c.range > s.range + EPS) reasons.push({ kind: "range", by: c.range - s.range });
  if (Math.abs(c.az) > s.hfov / 2 + EPS) reasons.push({ kind: "hfov", by: Math.abs(c.az) - s.hfov / 2, behind: Math.abs(c.az) > 90 });
  if (Math.abs(c.el) > s.vfov / 2 + EPS) reasons.push({ kind: "vfov", by: Math.abs(c.el) - s.vfov / 2, above: c.el > 0 });
  const inCone = reasons.length === 0;
  let blocked: Obstacle | null = null;
  if (inCone) {
    const occ = prepareOccluders(obstacles, s);
    const own = occ.find((o) => insideBox(o, o.toLocal(x, y, z)));
    blocked = own ? own.box : blockerFor(occ, x, y, z);
    if (blocked) reasons.push(own ? { kind: "inside", of: blocked.name || "an obstacle" } : { kind: "blocked", by: blocked.name || "an obstacle" });
  }
  return { ...c, inCone, blocked, inside: inCone && !blocked, reasons };
}

export interface PointResult {
  per: { sensor: Sensor; result: SensorResult }[];
  /** sensors that detect the point */
  seenBy: Sensor[];
  /** detected by at least one sensor */
  inside: boolean;
  /** a dead spot: no sensor detects it, but one would if an obstacle weren't in the way */
  blocked: boolean;
}

export function classifyAll(sensors: Sensor[], obstacles: Obstacle[], pt: { x: number; y: number; z: number }): PointResult {
  const per = sensors.map((sensor) => ({ sensor, result: classifyFor(sensor, obstacles, pt.x, pt.y, pt.z) }));
  const seenBy = per.filter((p) => p.result.inside).map((p) => p.sensor);
  return { per, seenBy, inside: seenBy.length > 0, blocked: !seenBy.length && per.some((p) => p.result.blocked !== null) };
}

export function formatReason(r: MissReason, units: Units): string {
  switch (r.kind) {
    case "range": return fmtLen(r.by, units) + " beyond max distance";
    case "hfov": return fmt(r.by, 1) + "° outside horizontal FOV" + (r.behind ? " (behind the sensor)" : "");
    case "vfov": return fmt(r.by, 1) + "° " + (r.above ? "above" : "below") + " vertical FOV";
    case "blocked": return "Line of sight blocked by " + r.by;
    case "inside": return "Inside " + r.of;
  }
}
