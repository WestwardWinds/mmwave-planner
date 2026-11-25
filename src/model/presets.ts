import type { PlannerState, Sensor } from "./types";

export interface SensorModel {
  id: string;
  label: string;
  hfov: number;
  vfov: number;
  range: number;
  note: string;
}

/**
 * Sensor model presets. Add a model here to offer it in the "Sensor model" menu.
 * LD2450: Hi-Link manual, ±60° azimuth / ±35° pitch, 6 m.
 * LD2412: listings give a single ±75° detection angle and 9 m; applied to both axes here.
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
    note: "Hi-Link LD2412 presence radar: ±75° detection angle, up to 9 m (adjustable). Listings give one angle, so it is used for both axes. Suggested mount: 1.5–2 m on a wall or 2.6–3 m on a ceiling."
  }
];

export const matchModel = (s: Pick<Sensor, "hfov" | "vfov" | "range">): SensorModel | undefined =>
  SENSOR_MODELS.find((m) => m.hfov === s.hfov && m.vfov === s.vfov && m.range === s.range);

export const SENSOR_TEMPLATE: Omit<Sensor, "id" | "name" | "color"> = {
  x: 2.5, y: 0.02, z: 2.0, pan: 0, tilt: -20, roll: 0, hfov: 120, vfov: 70, range: 6
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
