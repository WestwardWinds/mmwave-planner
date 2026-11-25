import type { PlannerState, Sensor } from "./types";

/** Distance gates: gate 0 is at the sensor, then one gate every `spacing` meters up to gate `last`. */
export interface GateSpec {
  last: number;
  spacings: number[];
  /** default spacing */
  spacing: number;
}

export interface SensorModel {
  id: string;
  label: string;
  hfov: number;
  vfov: number;
  range: number;
  note: string;
  gates?: GateSpec;
}

/**
 * Sensor model presets. Add a model here to offer it in the "Sensor model" menu.
 * Checked against published specs (Nov 2026):
 * LD2450: Hi-Link manual V1.00: "Azimuth angle ±60°, pitch angle ±35°", "Detection distance 6m". No gates.
 * LD2412: Hi-Link gives one angle, "±75°" (applied to both axes here), and "0.75–9 m"; serial protocol V1.05:
 *         gates up to 13, 0.75 / 0.5 / 0.2 m per gate (0.5 and 0.2 need newer firmware). Rated reach 9 / 6.5 / 2.6 m.
 * LD2410: Hi-Link spec sheet: up to 5 m ("The farthest sensing distance is up to 5 meters"; the manual's
 *         "0.75m ~ 6m" is the gate setting range, 8 gates x 0.75 m); one angle, "±60°" (applied to both axes);
 *         gates 0-8 at 0.75 m, or 0.2 m (LD2410B/C firmware) = 1.6 m.
 */
export const SENSOR_MODELS: SensorModel[] = [
  {
    id: "ld2450",
    label: "HLK-LD2450 · 120° × 70° · 6 m",
    hfov: 120,
    vfov: 70,
    range: 6,
    note: "Hi-Link LD2450 tracking radar: ±60° horizontal, ±35° vertical, up to 6 m. Hi-Link's diagrams show it wall-mounted at about 1.5 m."
  },
  {
    id: "ld2412",
    label: "HLK-LD2412 · 150° × 150° · 9 m",
    hfov: 150,
    vfov: 150,
    range: 9,
    note: "Hi-Link LD2412 presence radar: ±75° detection angle, up to 9 m. Hi-Link gives only one angle, so it is used for both axes. Closer gate spacing shortens the reach (0.5 m: 6.5 m, 0.2 m: 2.6 m) and needs newer firmware. Suggested mount: 1.5–2 m on a wall or 2.6–3 m on a ceiling.",
    gates: { last: 13, spacings: [0.2, 0.5, 0.75], spacing: 0.75 }
  },
  {
    id: "ld2410",
    label: "HLK-LD2410 · 120° × 120° · 5 m",
    hfov: 120,
    vfov: 120,
    range: 5,
    note: "Hi-Link LD2410 presence radar: ±60° detection angle, up to 5 m per Hi-Link's spec sheet (the gate settings run to gate 8, 6 m). Hi-Link gives only one angle, so it is used for both axes. 0.2 m gate spacing (LD2410B/C firmware) reaches 1.6 m.",
    gates: { last: 8, spacings: [0.2, 0.75], spacing: 0.75 }
  }
];

export const modelById = (id: string): SensorModel | undefined => SENSOR_MODELS.find((m) => m.id === id);

/** A model whose field of view and range match these numbers exactly (used to recognize older saves). */
export const matchModel = (s: Pick<Sensor, "hfov" | "vfov" | "range">): SensorModel | undefined =>
  SENSOR_MODELS.find((m) => m.hfov === s.hfov && m.vfov === s.vfov && m.range === s.range);

/** Gate layout of a sensor, or null if its model doesn't use gates (or it is a custom sensor). */
export function gateInfo(s: Pick<Sensor, "model" | "gate">): { last: number; spacing: number; max: number; spacings: number[] } | null {
  const g = modelById(s.model)?.gates;
  if (!g) return null;
  const spacing = g.spacings.includes(s.gate) ? s.gate : g.spacing;
  return { last: g.last, spacing, max: g.last * spacing, spacings: g.spacings };
}

/**
 * Distances of the range rings drawn on a sensor's cone. Gated sensors get one ring per gate
 * (gate 1, 2, …, at spacing × n; gate 0 is the sensor itself); others get a ring every `step` (1 m or 3 ft).
 * Only rings inside the max distance are drawn.
 */
export function ringDistances(s: Pick<Sensor, "model" | "gate" | "range">, step: number): number[] {
  const g = gateInfo(s);
  const out: number[] = [];
  if (g) {
    for (let n = 1; n <= g.last; n++) if (n * g.spacing <= s.range + 1e-9) out.push(n * g.spacing);
  } else {
    for (let n = 1; n * step < s.range - 1e-6 && n <= 40; n++) out.push(n * step);
  }
  return out;
}

/** The LD2450 is the default sensor. */
export const SENSOR_TEMPLATE: Omit<Sensor, "id" | "name" | "color"> = {
  x: 2.5, y: 0.02, z: 2.0, pan: 0, tilt: -20, roll: 0, hfov: 120, vfov: 70, range: 6, model: "ld2450", gate: 0.75
};

/** The example room: one wall sensor, one bookshelf that casts a dead spot, one test point. */
export const DEFAULT_STATE: PlannerState = {
  room: { w: 5, d: 4, h: 2.6, ceiling: "flat", peak: 3.6, low: "y0", ridge: "x" },
  sensors: [{ id: 1, name: "Sensor 1", color: 1, ...SENSOR_TEMPLATE }],
  active: 1,
  points: [{ id: 1, name: "Sofa", x: 1.2, y: 3.2, z: 0.9 }],
  obstacles: [{ id: 1, name: "Bookshelf", x: 3.6, y: 2.4, z: 0, w: 0.9, d: 0.35, h: 1.9, rot: 30 }],
  view: { clip: true, slice: true, sliceH: 0.9, rings: true, snap: true, units: "m", cones: "all" }
};

export interface BoxPreset {
  name: string;
  w: number;
  d: number;
  /** null = up to the ceiling */
  h: number | null;
}

export const BOX_PRESETS: Record<string, BoxPreset> = {
  box: { name: "Box", w: 0.6, d: 0.6, h: 0.6 },
  sofa: { name: "Sofa", w: 2.0, d: 0.9, h: 0.85 },
  shelf: { name: "Bookshelf", w: 1.0, d: 0.35, h: 1.9 },
  bed: { name: "Bed", w: 1.6, d: 2.0, h: 0.6 },
  island: { name: "Kitchen island", w: 1.8, d: 0.9, h: 0.9 },
  wall: { name: "Partition wall", w: 2.0, d: 0.12, h: null }
};
