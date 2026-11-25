import { describe, expect, it } from "vitest";
import {
  aimAtRoomCenter, CEILING_EDGE_GAP, cornerZone, nearestSurface, roomCenter, snapToNearestSurface, SURFACE_GAP
} from "../src/model/edits";
import { DEFAULT_STATE } from "../src/model/presets";
import { cloneState } from "../src/model/serialize";
import type { PlannerState, Sensor } from "../src/model/types";

// Default room: 5 m wide (X), 4 m deep (Y), 2.6 m flat ceiling.
const room = (patch: Partial<PlannerState["room"]> = {}): PlannerState => {
  const st = cloneState(DEFAULT_STATE);
  Object.assign(st.room, patch);
  return st;
};
const sensorAt = (st: PlannerState, x: number, y: number, z: number, extra: Partial<Sensor> = {}): Sensor => {
  const s = st.sensors[0];
  Object.assign(s, { x, y, z, pan: 12, tilt: -33, roll: 7 }, extra);
  return s;
};

describe("nearestSurface", () => {
  it("picks the closest wall on each side", () => {
    const st = room();
    expect(nearestSurface(st, { x: 0.3, y: 2, z: 1.5 })).toEqual({ kind: "wall", wall: "x0" });
    expect(nearestSurface(st, { x: 4.9, y: 2, z: 1.5 })).toEqual({ kind: "wall", wall: "xW" });
    expect(nearestSurface(st, { x: 2.5, y: 0.1, z: 1.0 })).toEqual({ kind: "wall", wall: "y0" });
    expect(nearestSurface(st, { x: 2.5, y: 3.8, z: 1.0 })).toEqual({ kind: "wall", wall: "yD" });
  });

  it("picks a corner when within the corner zone of an X wall and a Y wall", () => {
    const st = room();
    expect(cornerZone(st)).toBeCloseTo(0.75);
    expect(nearestSurface(st, { x: 0.4, y: 0.5, z: 1.5 })).toEqual({ kind: "corner", walls: ["y0", "x0"] });
    expect(nearestSurface(st, { x: 4.6, y: 0.3, z: 1.5 })).toEqual({ kind: "corner", walls: ["y0", "xW"] });
    expect(nearestSurface(st, { x: 0.3, y: 3.7, z: 1.5 })).toEqual({ kind: "corner", walls: ["yD", "x0"] });
    expect(nearestSurface(st, { x: 4.7, y: 3.6, z: 1.5 })).toEqual({ kind: "corner", walls: ["yD", "xW"] });
  });

  it("is a wall, not a corner, just outside the corner zone", () => {
    // 0.3 m from the left wall, 0.8 m from the front wall: the front wall is beyond the 0.75 m zone
    expect(nearestSurface(room(), { x: 0.3, y: 0.8, z: 1.5 })).toEqual({ kind: "wall", wall: "x0" });
  });

  it("shrinks the corner zone in small rooms", () => {
    const st = room({ w: 2, d: 1.6 });
    expect(cornerZone(st)).toBeCloseTo(0.4); // a quarter of 1.6 m
    expect(nearestSurface(st, { x: 0.3, y: 0.5, z: 1 })).toEqual({ kind: "wall", wall: "x0" });
    expect(nearestSurface(st, { x: 0.3, y: 0.35, z: 1 })).toEqual({ kind: "corner", walls: ["y0", "x0"] });
  });

  it("picks the ceiling when it is at least as close as the nearest wall", () => {
    const st = room();
    expect(nearestSurface(st, { x: 2.5, y: 2, z: 2.5 })).toEqual({ kind: "ceiling" }); // 0.1 m below a 2.6 m ceiling
    expect(nearestSurface(st, { x: 0.2, y: 2, z: 2.4 })).toEqual({ kind: "ceiling" }); // tie: 0.2 m to both
    expect(nearestSurface(st, { x: 0.15, y: 2, z: 2.4 })).toEqual({ kind: "wall", wall: "x0" });
  });

  it("measures the ceiling distance under a sloped ceiling", () => {
    // single pitch rising from 2.6 m at the front wall to 3.6 m at the back wall
    const st = room({ ceiling: "single", peak: 3.6, low: "y0" });
    // at y = 3, the ceiling is 2.6 + 1.0 * 3/4 = 3.35 m; z = 3.2 is 0.15 m below it, nearer than any wall (>= 1 m)
    expect(nearestSurface(st, { x: 2.5, y: 3, z: 3.2 })).toEqual({ kind: "ceiling" });
    // the same height near the front would be above the ceiling (2.6 + 0.25 = 2.85 at y = 1), so dc < 0 -> ceiling
    expect(nearestSurface(st, { x: 2.5, y: 1, z: 2.84 })).toEqual({ kind: "ceiling" });
  });
});

describe("snapToNearestSurface", () => {
  it("wall: flat against it, pointing straight out, no tilt or roll, height kept", () => {
    const st = room();
    const s = sensorAt(st, 0.3, 2, 1.5);
    const msg = snapToNearestSurface(st, s);
    expect([s.x, s.y, s.z]).toEqual([SURFACE_GAP, 2, 1.5]);
    expect([s.pan, s.tilt, s.roll]).toEqual([90, 0, 0]);
    expect(msg).toBe("Mounted on the left wall, pointing straight out.");
  });

  it("wall: each wall faces into the room", () => {
    const cases: [number, number, number, number, number][] = [
      // x, y -> expected x, y, pan
      [4.9, 2, 5 - SURFACE_GAP, 2, -90],
      [2.5, 0.1, 2.5, SURFACE_GAP, 0],
      [2.5, 3.8, 2.5, 4 - SURFACE_GAP, 180]
    ];
    for (const [x, y, ex, ey, pan] of cases) {
      const st = room();
      const s = sensorAt(st, x, y, 1.0);
      snapToNearestSurface(st, s);
      expect(s.x).toBeCloseTo(ex);
      expect(s.y).toBeCloseTo(ey);
      expect(s.pan).toBe(pan);
      expect(s.tilt).toBe(0);
    }
  });

  it("corner: tucked into the corner, 45° between the walls, level", () => {
    const cases: [number, number, number, number, number, string][] = [
      [0.4, 0.5, 0.06, 0.06, 45, "front-left"],
      [4.6, 0.3, 4.94, 0.06, -45, "front-right"],
      [0.3, 3.7, 0.06, 3.94, 135, "back-left"],
      [4.7, 3.6, 4.94, 3.94, -135, "back-right"]
    ];
    for (const [x, y, ex, ey, pan, name] of cases) {
      const st = room();
      const s = sensorAt(st, x, y, 1.8);
      const msg = snapToNearestSurface(st, s);
      expect(s.x).toBeCloseTo(ex);
      expect(s.y).toBeCloseTo(ey);
      expect(s.z).toBeCloseTo(1.8);
      expect([s.pan, s.tilt, s.roll]).toEqual([pan, 0, 0]);
      expect(msg).toBe(`Mounted in the ${name} corner, angled 45° into the room.`);
    }
  });

  it("flat ceiling: flush, pointing straight down, x and y kept", () => {
    const st = room();
    const s = sensorAt(st, 2.5, 2, 2.5);
    const msg = snapToNearestSurface(st, s);
    expect([s.x, s.y]).toEqual([2.5, 2]);
    expect(s.z).toBeCloseTo(2.6 - SURFACE_GAP);
    expect(s.tilt).toBe(-90);
    expect(s.roll).toBe(0);
    expect(msg).toBe("Mounted flush on the ceiling, pointing straight down.");
  });

  it("sloped ceiling: flush, matching the slope", () => {
    // gable with the ridge along Y at x = 2.5: 1 m rise over 2.5 m, so a 21.8° slope.
    // Flush, the sensor faces along the downward normal: tilt = -(90 - 21.8) = -68.2°, leaning toward the ridge (+X).
    const st = room({ ceiling: "double", peak: 3.6, ridge: "y" });
    const s = sensorAt(st, 1.25, 2, 3.0);
    const msg = snapToNearestSurface(st, s);
    // ceiling at x = 1.25 is 2.6 + 0.4 * 1.25 = 3.1; the 2.5 cm gap is square to the slope: 0.025 * sqrt(1.16) vertically
    expect(s.z).toBeCloseTo(3.1 - SURFACE_GAP * Math.sqrt(1.16), 6);
    expect(s.tilt).toBeCloseTo(-68.2, 1);
    expect(s.pan).toBe(90);
    expect(msg).toBe("Mounted flush on the ceiling, matching its slope.");
  });

  it("exactly on a gable ridge: straight down, for either ridge direction", () => {
    for (const ridge of ["x", "y"] as const) {
      const st = room({ ceiling: "double", peak: 3.6, ridge });
      // on the ridge line: y = 2 for a ridge along X, x = 2.5 for a ridge along Y
      const [x, y] = ridge === "x" ? [1.25, 2] : [2.5, 1];
      const s = sensorAt(st, x, y, 3.0, { pan: 20 });
      const msg = snapToNearestSurface(st, s);
      expect(s.tilt).toBe(-90);
      expect(s.pan).toBe(20); // nothing to lean toward, so pan is kept
      expect(msg).toBe("Mounted flush on the ceiling at the ridge, pointing straight down.");
    }
    // just off the ridge it matches the slope on its own side again
    const st = room({ ceiling: "double", peak: 3.6, ridge: "x" });
    const s = sensorAt(st, 2.5, 1.9, 3.4);
    snapToNearestSurface(st, s);
    // a ridge along X slopes across the 4 m depth: 1 m rise over 2 m (26.6°), so tilt = -(90 - 26.6) = -63.4°
    expect(s.tilt).toBeCloseTo(-63.4, 1);
    expect(s.pan).toBe(0); // the ridge is at larger Y
  });

  it("a ceiling mount beside a wall is moved clear of the wall", () => {
    const st = room();
    const s = sensorAt(st, 0, 2, 2.6); // on the wall/ceiling edge
    snapToNearestSurface(st, s);
    expect(s.x).toBeCloseTo(CEILING_EDGE_GAP);
    expect(s.tilt).toBe(-90);
    const t = sensorAt(st, 0.01, 3.99, 2.59);
    snapToNearestSurface(st, t);
    expect([t.x, t.y]).toEqual([CEILING_EDGE_GAP, 4 - CEILING_EDGE_GAP]);
  });

  it("measures distance to a steep ceiling square to the slope", () => {
    // 45° single pitch: 2.6 m at the left wall rising to 7.6 m at the right wall
    const st = room({ ceiling: "single", peak: 7.6, low: "x0" });
    // at x = 2.5 the ceiling is 5.1 m; z = 4.1 is 1.0 m below vertically but only 0.707 m square to the slope,
    // nearer than the front wall at 0.8 m
    expect(nearestSurface(st, { x: 2.5, y: 0.8, z: 4.1 })).toEqual({ kind: "ceiling" });
    expect(nearestSurface(st, { x: 2.5, y: 0.6, z: 4.1 })).toEqual({ kind: "wall", wall: "y0" });
  });

  it("is stable: snapping an already snapped sensor leaves it where it is", () => {
    const rooms: Partial<PlannerState["room"]>[] = [
      {},
      { ceiling: "single", peak: 3.6, low: "y0" },
      { ceiling: "single", peak: 7.6, low: "x0" },
      { ceiling: "double", peak: 3.6, ridge: "x" },
      { ceiling: "double", peak: 3.6, ridge: "y" },
      { w: 2, d: 1.6, h: 2.4 }
    ];
    let checked = 0;
    for (const r of rooms) {
      const st = room(r);
      const { w, d } = st.room;
      // a grid of starting spots, including points on walls, in corners and right under the ceiling
      for (const fx of [0, 0.004, 0.02, 0.1, 0.3, 0.5, 0.7, 0.9, 0.98, 1]) {
        for (const fy of [0, 0.01, 0.15, 0.5, 0.85, 0.99, 1]) {
          for (const zf of [0.2, 0.6, 0.97, 0.995, 1]) {
            const x = fx * w, y = fy * d;
            const s = sensorAt(st, x, y, 0);
            s.z = zf * (st.room.ceiling === "flat" ? st.room.h : 2.6 + (fx + fy) * 0.4); // up to near the ceiling
            snapToNearestSurface(st, s);
            const once = { x: s.x, y: s.y, z: s.z, pan: s.pan, tilt: s.tilt, roll: s.roll };
            snapToNearestSurface(st, s);
            expect({ x: s.x, y: s.y, z: s.z, pan: s.pan, tilt: s.tilt, roll: s.roll }).toEqual(once);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(6 * 10 * 7 * 5);
  });

  it("keeps a wall-mounted sensor's height under a sloped ceiling", () => {
    // single pitch, low at the front: at the back wall the ceiling is 3.6 m, so 3.0 m is fine and kept
    const st = room({ ceiling: "single", peak: 3.6, low: "y0" });
    const s = sensorAt(st, 2.5, 3.7, 1.2);
    snapToNearestSurface(st, s);
    expect(s.y).toBeCloseTo(4 - SURFACE_GAP);
    expect(s.z).toBeCloseTo(1.2);
    expect(s.pan).toBe(180);
  });
});

describe("aim at the room center", () => {
  it("is the middle of the floor plan, halfway up to the ceiling there", () => {
    expect(roomCenter(room())).toEqual({ x: 2.5, y: 2, z: 1.3 });
    // gable with the ridge along X through the center: 3.6 m above the center -> 1.8 m
    expect(roomCenter(room({ ceiling: "double", peak: 3.6, ridge: "x" })).z).toBeCloseTo(1.8);
  });

  it("from a wall at center height, faces straight across", () => {
    const st = room();
    const s = sensorAt(st, SURFACE_GAP, 2, 1.3);
    aimAtRoomCenter(st, s);
    expect(s.pan).toBe(90);
    expect(s.tilt).toBe(0);
  });

  it("from a high corner, aims diagonally and down", () => {
    const st = room();
    const s = sensorAt(st, 0.06, 0.06, 2.3);
    aimAtRoomCenter(st, s);
    // to (2.5, 2, 1.3): dx 2.44, dy 1.94 -> pan atan2(2.44, 1.94) = 51.5°; drop 1.0 over 3.117 m -> tilt -17.8°
    expect(s.pan).toBeCloseTo(51.5, 1);
    expect(s.tilt).toBeCloseTo(-17.8, 1);
  });

  it("from directly above the center, points straight down and keeps pan", () => {
    const st = room();
    const s = sensorAt(st, 2.5, 2, 2.575, { pan: 30 });
    aimAtRoomCenter(st, s);
    expect(s.tilt).toBe(-90);
    expect(s.pan).toBe(30);
  });
});
