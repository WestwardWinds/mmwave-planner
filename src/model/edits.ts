// State changes shared by the panel and the 3D view. Each function mutates the state it is given.
import { ceilAt, ceilPlaneAt, ceilPlanes, isPitched, peakZ } from "./ceiling";
import { clamp, nextId, round, wrapDeg } from "./math";
import { BOX_PRESETS, gateInfo, modelById, SENSOR_MODELS } from "./presets";
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
    case "corner": Object.assign(s, { x: 0.06, y: 0.06, z: cz(0.06, 0.06) - 0.1, pan: 45, tilt: -35, roll: 0 }); break;
    case "ceiling": Object.assign(s, { x: w / 2, y: d / 2, z: cz(w / 2, d / 2) - 0.02, pan: 0, tilt: -90, roll: 0 }); break;
    case "flush": mountFlushOnCeiling(st, s); break;
  }
  clampAll(st);
}

/** Steepness factor of the ceiling at (x, y): vertical distance = perpendicular distance × this (1 on a flat ceiling). */
function slopeFactor(st: PlannerState, x: number, y: number): number {
  const q = ceilPlaneAt(ceilPlanes(st.room), x, y);
  return Math.sqrt(1 + q.a * q.a + q.b * q.b);
}

/** The ceiling planes that form the ceiling at (x, y): two on a gable's ridge line, otherwise one. */
function planesAt(st: PlannerState, x: number, y: number) {
  const cp = ceilPlanes(st.room);
  const top = ceilAt(cp, x, y);
  return cp.filter((q) => Math.abs(q.a * x + q.b * y + q.c - top) < 1e-6);
}

/**
 * Lie flat against the ceiling above the sensor, SURFACE_GAP below it measured square to the surface, facing along
 * the ceiling's downward normal (a, b, -1). Exactly on a gable's ridge both slopes meet, so the normals are averaged
 * (straight down for a centered ridge) instead of leaning toward whichever side rounding picks.
 * Returns true when the sensor sits on the ridge.
 */
function mountFlushOnCeiling(st: PlannerState, s: Sensor): boolean {
  const planes = planesAt(st, s.x, s.y);
  const n: [number, number, number] = [0, 0, 0];
  for (const q of planes) { n[0] += q.a; n[1] += q.b; n[2] -= 1; }
  const a = anglesFromDirection(n, s.pan);
  const top = ceilAt(ceilPlanes(st.room), s.x, s.y);
  Object.assign(s, { z: top - SURFACE_GAP * slopeFactor(st, s.x, s.y), pan: round(a.pan, 1), tilt: round(a.tilt, 1), roll: 0 });
  return planes.length > 1;
}

// ---------- snap to the nearest surface ----------
export type Wall = "x0" | "xW" | "y0" | "yD";
export type Surface =
  | { kind: "ceiling" }
  | { kind: "wall"; wall: Wall }
  | { kind: "corner"; walls: [Wall, Wall] };

/** Sensor origin to surface, so the 2.5 cm-deep body sits against it. */
export const SURFACE_GAP = 0.025;
/** In a corner the body is turned 45°, so it needs a little more room from each wall. */
export const CORNER_GAP = 0.06;
/** A ceiling mount keeps its 10 × 7 cm body clear of the walls. */
export const CEILING_EDGE_GAP = 0.08;
// Wall and corner mounts stay at least this far below the ceiling (square to it), so the ceiling is
// never the nearest surface afterwards: snapping a snapped sensor again leaves it where it is.
const WALL_CEILING_CLEARANCE = 0.05;
const CORNER_CEILING_CLEARANCE = 0.1;
/** Facing straight out of each wall (pan: 0° = +Y, 90° = +X). */
const WALL_PAN: Record<Wall, number> = { y0: 0, yD: 180, x0: 90, xW: -90 };
const WALL_NAME: Record<Wall, string> = { y0: "front wall", yD: "back wall", x0: "left wall", xW: "right wall" };

/** How close to two walls counts as "in the corner": 0.75 m, or a quarter of the shorter side in small rooms. */
export const cornerZone = (st: PlannerState): number => Math.min(0.75, 0.25 * Math.min(st.room.w, st.room.d));

/**
 * The surface nearest the sensor: the ceiling if it is at least as close as the nearest wall (measured square
 * to a sloped ceiling), a corner if the sensor is within the corner zone of both an X wall and a Y wall,
 * otherwise the nearest wall.
 */
export function nearestSurface(st: PlannerState, s: { x: number; y: number; z: number }): Surface {
  const { w, d } = st.room;
  const xWall: Wall = s.x <= w - s.x ? "x0" : "xW";
  const yWall: Wall = s.y <= d - s.y ? "y0" : "yD";
  const dx = Math.min(s.x, w - s.x), dy = Math.min(s.y, d - s.y);
  const dc = (ceilAt(ceilPlanes(st.room), s.x, s.y) - s.z) / slopeFactor(st, s.x, s.y);
  const tol = 1e-9; // so exact ties (e.g. 2.6 - 2.4 vs 0.2) aren't decided by rounding error
  if (dc <= Math.min(dx, dy) + tol) return { kind: "ceiling" };
  if (Math.max(dx, dy) <= cornerZone(st) + tol) return { kind: "corner", walls: [yWall, xWall] };
  return { kind: "wall", wall: dx <= dy ? xWall : yWall };
}

/** The wall nearest the sensor's spot on the floor plan. */
export function nearestWall(st: PlannerState, s: { x: number; y: number }): Wall {
  const { w, d } = st.room;
  const dx = Math.min(s.x, w - s.x), dy = Math.min(s.y, d - s.y);
  return dx <= dy ? (s.x <= w - s.x ? "x0" : "xW") : (s.y <= d - s.y ? "y0" : "yD");
}

/** The corner nearest the sensor's spot on the floor plan, as [Y wall, X wall]. */
export function nearestCorner(st: PlannerState, s: { x: number; y: number }): [Wall, Wall] {
  const { w, d } = st.room;
  return [s.y <= d - s.y ? "y0" : "yD", s.x <= w - s.x ? "x0" : "xW"];
}

/** Snap to the nearest wall: flat against it, pointing straight out, level. Height is kept. */
export const snapToWall = (st: PlannerState, s: Sensor): string => snapTo(st, s, { kind: "wall", wall: nearestWall(st, s) });
/** Snap into the nearest corner: tucked in, angled 45° into the room, level. Height is kept. */
export const snapToCorner = (st: PlannerState, s: Sensor): string => snapTo(st, s, { kind: "corner", walls: nearestCorner(st, s) });
/** Snap flush onto the ceiling above the sensor, matching its slope (straight down on a flat ceiling). */
export const snapToCeiling = (st: PlannerState, s: Sensor): string => snapTo(st, s, { kind: "ceiling" });

/**
 * Move the sensor onto whichever of wall, corner or ceiling is nearest (see nearestSurface) and give it that
 * surface's default aim. Returns a short description for the panel.
 */
export const snapToNearestSurface = (st: PlannerState, s: Sensor): string => snapTo(st, s, nearestSurface(st, s));

/**
 * Put the sensor on a surface with that surface's default aim:
 * wall — flat against it, pointing straight out, no tilt; corner — tucked in, 45° between the walls, no tilt;
 * ceiling — flat against it, matching its slope (straight down under a flat ceiling).
 * Height is kept for walls and corners, staying clear of the ceiling.
 */
function snapTo(st: PlannerState, s: Sensor, surface: Surface): string {
  const { w, d } = st.room;
  const cp = ceilPlanes(st.room);
  // keep the height, but stay `clearance` below the ceiling (square to it) and above the floor
  const keepHeight = (x: number, y: number, clearance: number) =>
    clamp(s.z, 0.05, Math.max(0.05, ceilAt(cp, x, y) - clearance * slopeFactor(st, x, y)));
  let message: string;
  if (surface.kind === "ceiling") {
    s.x = clamp(s.x, CEILING_EDGE_GAP, Math.max(CEILING_EDGE_GAP, w - CEILING_EDGE_GAP));
    s.y = clamp(s.y, CEILING_EDGE_GAP, Math.max(CEILING_EDGE_GAP, d - CEILING_EDGE_GAP));
    const onRidge = mountFlushOnCeiling(st, s);
    message = onRidge ? "Mounted flush on the ceiling at the ridge, pointing straight down."
      : isPitched(st.room) ? "Mounted flush on the ceiling, matching its slope."
      : "Mounted flush on the ceiling, pointing straight down.";
  } else if (surface.kind === "wall") {
    const wl = surface.wall;
    const x = wl === "x0" ? SURFACE_GAP : wl === "xW" ? w - SURFACE_GAP : s.x;
    const y = wl === "y0" ? SURFACE_GAP : wl === "yD" ? d - SURFACE_GAP : s.y;
    Object.assign(s, { x, y, z: keepHeight(x, y, WALL_CEILING_CLEARANCE), pan: WALL_PAN[wl], tilt: 0, roll: 0 });
    message = `Mounted on the ${WALL_NAME[wl]}, pointing straight out.`;
  } else {
    const [yw, xw] = surface.walls;
    const x = xw === "x0" ? CORNER_GAP : w - CORNER_GAP;
    const y = yw === "y0" ? CORNER_GAP : d - CORNER_GAP;
    // halfway between the two walls' outward directions, e.g. front-left corner: between 0° and 90° = 45°
    const fx = xw === "x0" ? 1 : -1, fy = yw === "y0" ? 1 : -1;
    const pan = round(Math.atan2(fx, fy) * (180 / Math.PI), 1);
    Object.assign(s, { x, y, z: keepHeight(x, y, CORNER_CEILING_CLEARANCE), pan, tilt: 0, roll: 0 });
    message = `Mounted in the ${yw === "y0" ? "front" : "back"}-${xw === "x0" ? "left" : "right"} corner, angled 45° into the room.`;
  }
  clampToRoom(st, s);
  return message;
}

/** The middle of the room: center of the floor plan, halfway up to the ceiling there. */
export function roomCenter(st: PlannerState): { x: number; y: number; z: number } {
  const x = st.room.w / 2, y = st.room.d / 2;
  return { x, y, z: ceilAt(ceilPlanes(st.room), x, y) / 2 };
}

export function aimAtRoomCenter(st: PlannerState, s: Sensor): void {
  aimAt(s, roomCenter(st));
}

/** Set a sensor to a model's field of view, range and default gate spacing. "custom" keeps the current numbers. */
export function applyModel(s: Sensor, modelId: string): void {
  if (modelId === "custom") { s.model = "custom"; return; }
  const m = SENSOR_MODELS.find((x) => x.id === modelId);
  if (!m) return;
  Object.assign(s, { model: m.id, hfov: m.hfov, vfov: m.vfov, range: m.range });
  if (m.gates) {
    s.gate = m.gates.spacing;
    s.range = ratedRange(m, s.gate);
  }
}

/**
 * A gated model's rated reach at a gate spacing: its rated range, but never past the last gate.
 * Matches the published figures: LD2412 9 m at 0.75 m (gate 13 would be 9.75 m), 6.5 m at 0.5 m, 2.6 m at 0.2 m;
 * LD2410 5 m at 0.75 m (gate 8 would be 6 m), 1.6 m at 0.2 m.
 */
export function ratedRange(m: { range: number; gates?: { last: number } }, spacing: number): number {
  return m.gates ? Math.min(m.range, m.gates.last * spacing) : m.range;
}

/** Change a gated sensor's gate spacing. The max distance moves to the model's rated reach at that spacing. */
export function setGateSpacing(s: Sensor, spacing: number): void {
  const m = modelById(s.model);
  if (!m?.gates || !m.gates.spacings.includes(spacing)) return;
  s.gate = spacing;
  s.range = ratedRange(m, spacing);
}

/** Set the max distance; a gated sensor can't see past its last gate. */
export function setSensorRange(s: Sensor, range: number): void {
  const g = gateInfo(s);
  s.range = clamp(range, 0.1, g ? g.max : 50);
}

/**
 * Set a field of view by hand. The sensor keeps its model (and gates): it is still that hardware, aimed or
 * shielded differently. The panel notes when the field of view differs from the model's.
 */
export function setSensorFov(s: Sensor, which: "hfov" | "vfov", value: number): void {
  s[which] = clamp(value, 1, 180);
}

/** True when a model sensor's field of view has been changed from the model's values. */
export function fovEdited(s: Sensor): boolean {
  const m = modelById(s.model);
  return !!m && (m.hfov !== s.hfov || m.vfov !== s.vfov);
}

export function aimAt(s: Sensor, p: { x: number; y: number; z: number }): void {
  const a = aimAngles(s, p.x, p.y, p.z);
  if (a) { s.pan = round(a.pan, 1); s.tilt = round(a.tilt, 1); }
}

/** A new sensor on the back wall facing in, with the same model as `like`. Becomes the active sensor. */
export function addSensor(st: PlannerState, like: Sensor): Sensor {
  const { w, d } = st.room;
  const id = nextId(st.sensors);
  const s: Sensor = {
    id, name: "Sensor " + id, color: freeColor(st.sensors), x: w / 2, y: d - 0.02, z: 0, pan: 180, tilt: -20, roll: 0,
    hfov: like.hfov, vfov: like.vfov, range: like.range, model: like.model, gate: like.gate
  };
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
