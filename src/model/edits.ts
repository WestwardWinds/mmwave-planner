// State changes shared by the panel and the 3D view. Each function mutates the state it is given.
import { ceilAt, ceilPlaneAt, ceilPlanes, isPitched, peakZ } from "./ceiling";
import { clamp, nextId, round, wrapDeg } from "./math";
import { BOX_PRESETS, SENSOR_MODELS } from "./presets";
import { aimAngles, anglesFromDirection } from "./radar";
import { freeColor } from "./serialize";
import type { CeilingKind, Obstacle, PlannerState, Sensor, TestPoint } from "./types";
import { M_PER_FT } from "./units";

export const activeSensor = (st: PlannerState): Sensor => st.sensors.find((s) => s.id === st.active) ?? st.sensors[0];

/** Keep a sensor or point inside the room and under the ceiling at its spot. */
export function clampToRoom(st: PlannerState, o: { x: number; y: number; z: number }): void {
  o.x = clamp(o.x, 0, st.room.w);
  o.y = clamp(o.y, 0, st.room.d);
  o.z = clamp(o.z, 0, ceilAt(ceilPlanes(st.room), o.x, o.y));
}

/** Keep a box inside the room, under the ceiling measured at its center (a rough fit for slopes). */
export function clampBox(st: PlannerState, b: Obstacle): void {
  b.w = clamp(b.w, 0.02, 50);
  b.d = clamp(b.d, 0.02, 50);
  b.x = clamp(b.x, 0, st.room.w);
  b.y = clamp(b.y, 0, st.room.d);
  const top = ceilAt(ceilPlanes(st.room), b.x, b.y);
  b.h = clamp(b.h, 0.02, top);
  b.z = clamp(b.z, 0, Math.max(0, top - b.h));
  b.rot = wrapDeg(b.rot);
}

export function clampAll(st: PlannerState): void {
  st.sensors.forEach((s) => clampToRoom(st, s));
  st.points.forEach((p) => clampToRoom(st, p));
  st.obstacles.forEach((b) => clampBox(st, b));
  st.view.sliceH = clamp(st.view.sliceH, 0, peakZ(st.room));
}

/**
 * Things mounted on the ceiling follow it when the room shape changes.
 * Call `record` while the room is settled; call `follow` after the room changes.
 */
export class CeilingMounts {
  private sensorGaps = new Map<number, number>();
  private boxesAtCeiling = new Set<number>();
  static readonly SENSOR_GAP = 0.1;

  record(st: PlannerState): void {
    const cp = ceilPlanes(st.room);
    this.sensorGaps.clear();
    this.boxesAtCeiling.clear();
    for (const s of st.sensors) {
      const gap = ceilAt(cp, s.x, s.y) - s.z;
      if (gap <= CeilingMounts.SENSOR_GAP) this.sensorGaps.set(s.id, gap);
    }
    for (const b of st.obstacles) if (ceilAt(cp, b.x, b.y) - (b.z + b.h) <= 0.02) this.boxesAtCeiling.add(b.id);
  }

  follow(st: PlannerState): void {
    const cp = ceilPlanes(st.room);
    for (const s of st.sensors) {
      const gap = this.sensorGaps.get(s.id);
      if (gap !== undefined) s.z = Math.max(0, ceilAt(cp, s.x, s.y) - gap);
    }
    for (const b of st.obstacles) if (this.boxesAtCeiling.has(b.id)) b.h = Math.max(0.02, ceilAt(cp, b.x, b.y) - b.z);
  }
}

export function setCeiling(st: PlannerState, kind: CeilingKind): void {
  st.room.ceiling = kind;
  if (isPitched(st.room) && st.room.peak < st.room.h + 0.05) st.room.peak = round(st.room.h + 1, 2);
}

export type MountPreset = "front" | "left" | "corner" | "ceiling" | "flush";

/** Move and aim a sensor to a common mounting spot. */
export function applyMount(st: PlannerState, s: Sensor, preset: MountPreset): void {
  const { w, d } = st.room;
  const cp = ceilPlanes(st.room);
  const cz = (x: number, y: number) => ceilAt(cp, x, y);
  switch (preset) {
    case "front": Object.assign(s, { x: w / 2, y: 0.02, z: Math.min(2.0, cz(w / 2, 0.02) - 0.2), pan: 0, tilt: -20, roll: 0 }); break;
    case "left": Object.assign(s, { x: 0.02, y: d / 2, z: Math.min(2.0, cz(0.02, d / 2) - 0.2), pan: 90, tilt: -20, roll: 0 }); break;
    case "corner": Object.assign(s, { x: 0.05, y: 0.05, z: cz(0.05, 0.05) - 0.05, pan: 45, tilt: -35, roll: 0 }); break;
    case "ceiling": Object.assign(s, { x: w / 2, y: d / 2, z: cz(w / 2, d / 2) - 0.02, pan: 0, tilt: -90, roll: 0 }); break;
    case "flush": {
      // lie flat against the ceiling: face along its downward normal (a, b, -1) at the sensor's x, y
      const q = ceilPlaneAt(cp, s.x, s.y);
      const a = anglesFromDirection([q.a, q.b, -1], s.pan);
      Object.assign(s, { z: cz(s.x, s.y) - 0.02, pan: round(a.pan, 1), tilt: round(a.tilt, 1), roll: 0 });
      break;
    }
  }
  clampAll(st);
}

export function applyModel(s: Sensor, modelId: string): void {
  const m = SENSOR_MODELS.find((x) => x.id === modelId);
  if (m) Object.assign(s, { hfov: m.hfov, vfov: m.vfov, range: m.range });
}

export function aimAt(s: Sensor, p: { x: number; y: number; z: number }): void {
  const a = aimAngles(s, p.x, p.y, p.z);
  if (a) { s.pan = round(a.pan, 1); s.tilt = round(a.tilt, 1); }
}

/** A new sensor on the back wall facing in, with the same model as `like`. Becomes the active sensor. */
export function addSensor(st: PlannerState, like: Sensor): Sensor {
  const { w, d } = st.room;
  const id = nextId(st.sensors);
  const s: Sensor = { id, name: "Sensor " + id, color: freeColor(st.sensors), x: w / 2, y: d - 0.02, z: 0, pan: 180, tilt: -20, roll: 0, hfov: like.hfov, vfov: like.vfov, range: like.range };
  s.z = Math.min(2.0, ceilAt(ceilPlanes(st.room), s.x, s.y) - 0.2);
  st.sensors.push(s);
  st.active = id;
  return s;
}

export function removeSensor(st: PlannerState, id: number): void {
  if (st.sensors.length < 2) return;
  st.sensors = st.sensors.filter((s) => s.id !== id);
  if (!st.sensors.some((s) => s.id === st.active)) st.active = st.sensors[0].id;
}

export function addPoint(st: PlannerState): TestPoint {
  const id = nextId(st.points);
  const p: TestPoint = { id, name: "Point " + id, x: round(st.room.w / 2, 3), y: round(st.room.d / 2, 3), z: st.view.units === "ftin" ? 3 * M_PER_FT : 1 };
  clampToRoom(st, p);
  st.points.push(p);
  return p;
}

export function addObstacle(st: PlannerState, presetId: string): Obstacle | null {
  const P = BOX_PRESETS[presetId];
  if (!P) return null;
  const { w, d } = st.room;
  const top = ceilAt(ceilPlanes(st.room), w / 2, d / 2);
  const same = st.obstacles.filter((q) => q.name.startsWith(P.name)).length;
  const b: Obstacle = {
    id: nextId(st.obstacles), name: P.name + (same ? " " + (same + 1) : ""), x: w / 2, y: d / 2, z: 0,
    w: Math.min(P.w, w), d: Math.min(P.d, d), h: P.h == null ? top : Math.min(P.h, top), rot: 0
  };
  clampBox(st, b);
  st.obstacles.push(b);
  return b;
}
