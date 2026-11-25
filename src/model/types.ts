// Planner data model. All lengths are meters, all angles degrees.
// User frame: X runs along the room width, Y into the room (depth), Z up.
// The origin is the front-left floor corner.

export type CeilingKind = "flat" | "single" | "double";
/** Which wall is low on a single-pitch ceiling. */
export type LowSide = "y0" | "yD" | "x0" | "xW";
/** Which axis the ridge of a double-pitch (gable) ceiling runs along. The ridge is centered. */
export type RidgeAxis = "x" | "y";
export type Units = "m" | "ftin";

export interface Room {
  w: number;
  d: number;
  /** Wall height (the low edge of a pitched ceiling). */
  h: number;
  ceiling: CeilingKind;
  /** Highest point of a pitched ceiling. Ignored for flat ceilings; treated as at least `h`. */
  peak: number;
  low: LowSide;
  ridge: RidgeAxis;
}

export interface Sensor {
  id: number;
  name: string;
  /** Color slot 1-4 (maps to the --s1..--s4 palette). */
  color: number;
  x: number;
  y: number;
  z: number;
  /** Horizontal tilt: rotation about Z. 0° faces +Y, 90° faces +X. */
  pan: number;
  /** Vertical tilt: + aims up, -90° points at the floor. */
  tilt: number;
  /** Rotation about the facing direction. */
  roll: number;
  hfov: number;
  vfov: number;
  range: number;
}

export interface TestPoint {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
}

/** An axis-aligned box rotated about Z. x, y = center on the floor plan; z = bottom height. */
export interface Obstacle {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Degrees counterclockwise seen from above. */
  rot: number;
}

export interface ViewOptions {
  clip: boolean;
  slice: boolean;
  sliceH: number;
  rings: boolean;
  snap: boolean;
  units: Units;
  cones: "all" | "active";
}

export interface PlannerState {
  room: Room;
  sensors: Sensor[];
  /** id of the sensor the panel edits */
  active: number;
  points: TestPoint[];
  obstacles: Obstacle[];
  view: ViewOptions;
}

export type Vec3 = [number, number, number];
