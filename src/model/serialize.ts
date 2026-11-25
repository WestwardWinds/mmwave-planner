import { num, pick } from "./math";
import { DEFAULT_STATE, matchModel, modelById, SENSOR_TEMPLATE } from "./presets";
import type { Obstacle, PlannerState, Sensor, TestPoint } from "./types";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const SENSOR_KEYS = ["x", "y", "z", "pan", "tilt", "roll", "hfov", "vfov", "range"] as const;
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

function uniqueIds<T extends { id: number }>(list: T[]): T[] {
  const seen = new Set<number>();
  for (const x of list) {
    while (seen.has(x.id)) x.id++;
    seen.add(x.id);
  }
  return list;
}

/** The lowest color slot 1-4 not used by another sensor (cycles when all four are taken). */
export function freeColor(sensors: Sensor[], except?: Sensor): number {
  const used = new Set(sensors.filter((s) => s !== except && s.color).map((s) => s.color));
  for (let c = 1; c <= 4; c++) if (!used.has(c)) return c;
  return (sensors.length % 4) + 1;
}

/** Give every sensor a valid color slot, distinct while there are four or fewer. */
export function assignColors(sensors: Sensor[]): void {
  const used = new Set<number>();
  for (const s of sensors) {
    if ([1, 2, 3, 4].includes(s.color) && !used.has(s.color)) used.add(s.color);
    else s.color = 0;
  }
  for (const s of sensors) if (!s.color) { s.color = freeColor(sensors, s); used.add(s.color); }
}

function cleanSensor(src: Rec, i: number): Sensor {
  const o = { id: num(src.id, i + 1), name: String(src.name || "Sensor " + (i + 1)).slice(0, 40), color: num(src.color, 0) } as Sensor;
  // a sensor that names its model gets that model's field of view and range for anything it leaves out
  const named = typeof src.model === "string" ? modelById(src.model) : undefined;
  const base = named ? { ...SENSOR_TEMPLATE, hfov: named.hfov, vfov: named.vfov, range: named.range } : SENSOR_TEMPLATE;
  for (const k of SENSOR_KEYS) o[k] = num(src[k], base[k]);
  // saves from before sensors stored their model: recognize it from the field of view and range
  o.model = named ? named.id : src.model === "custom" ? "custom" : (matchModel(o)?.id ?? "custom");
  const gates = modelById(o.model)?.gates;
  o.gate = gates ? (gates.spacings.includes(src.gate as number) ? (src.gate as number) : gates.spacing) : num(src.gate, SENSOR_TEMPLATE.gate);
  if (gates) o.range = Math.min(o.range, gates.last * o.gate); // a gated sensor can't see past its last gate
  return o;
}

/**
 * Turn untrusted JSON (a saved state, an imported file, a docs-page config) into a valid state.
 * Unknown or broken fields fall back to the example room's values. Accepts the older single-`sensor` format.
 */
export function parseState(input: unknown): PlannerState {
  const out = clone(DEFAULT_STATE);
  if (!isRec(input)) return out;
  const s = input;
  if (isRec(s.room)) {
    const r = s.room;
    for (const k of ["w", "d", "h", "peak"] as const) out.room[k] = num(r[k], out.room[k]);
    out.room.w = Math.max(0.5, out.room.w); out.room.d = Math.max(0.5, out.room.d); out.room.h = Math.max(0.5, out.room.h);
    out.room.ceiling = pick(r.ceiling, ["flat", "single", "double"] as const, "flat");
    out.room.low = pick(r.low, ["y0", "yD", "x0", "xW"] as const, "y0");
    out.room.ridge = pick(r.ridge, ["x", "y"] as const, "x");
  }
  if (isRec(s.view)) {
    const v = s.view;
    for (const k of ["clip", "slice", "rings", "snap"] as const) if (typeof v[k] === "boolean") out.view[k] = v[k] as boolean;
    out.view.sliceH = num(v.sliceH, out.view.sliceH);
    out.view.units = pick(v.units, ["m", "ftin"] as const, "m");
    out.view.cones = pick(v.cones, ["all", "active"] as const, "all");
  }
  if (Array.isArray(s.sensors) && s.sensors.length) out.sensors = s.sensors.filter(isRec).map(cleanSensor);
  else if (isRec(s.sensor)) out.sensors = [cleanSensor({ name: "Sensor 1", ...s.sensor }, 0)];
  if (!out.sensors.length) out.sensors = clone(DEFAULT_STATE.sensors);
  for (const x of out.sensors) { x.hfov = Math.min(180, Math.max(1, x.hfov)); x.vfov = Math.min(180, Math.max(1, x.vfov)); x.range = Math.max(0.1, x.range); }
  uniqueIds(out.sensors);
  assignColors(out.sensors);
  out.active = out.sensors.some((x) => x.id === s.active) ? (s.active as number) : out.sensors[0].id;

  if (Array.isArray(s.points)) {
    out.points = s.points
      .filter((p): p is Rec => isRec(p) && [p.x, p.y, p.z].every((v) => typeof v === "number" && isFinite(v)))
      .map((p, i): TestPoint => ({ id: num(p.id, i + 1), name: String(p.name || "Point " + (i + 1)).slice(0, 40), x: p.x as number, y: p.y as number, z: p.z as number }));
    uniqueIds(out.points);
  }
  if (Array.isArray(s.obstacles)) {
    const keys = ["x", "y", "z", "w", "d", "h", "rot"];
    out.obstacles = s.obstacles
      .filter((b): b is Rec => isRec(b) && keys.every((k) => typeof b[k] === "number" && isFinite(b[k] as number)))
      .map((b, i): Obstacle => ({
        id: num(b.id, i + 1), name: String(b.name || "Box " + (i + 1)).slice(0, 40),
        x: b.x as number, y: b.y as number, z: b.z as number,
        w: Math.max(0.02, b.w as number), d: Math.max(0.02, b.d as number), h: Math.max(0.02, b.h as number), rot: b.rot as number
      }));
    uniqueIds(out.obstacles);
  } else if (isRec(s.room)) {
    out.obstacles = []; // saved before obstacles existed: don't inject the example box
  }
  return out;
}

export const serializeState = (state: PlannerState): string => JSON.stringify(state, null, 2);

/** URL-safe base64 of the state, for share links (#config=...). */
export function encodeShare(state: PlannerState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(code: string): PlannerState | null {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return parseState(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export const cloneState = clone;
