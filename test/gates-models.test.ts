import { describe, expect, it } from "vitest";
import {
  addSensor, applyModel, fovEdited, nearestCorner, ratedRange, nearestWall, setGateSpacing, setSensorFov, setSensorRange,
  snapToCeiling, snapToCorner, snapToWall, SURFACE_GAP, CORNER_GAP
} from "../src/model/edits";
import { DEFAULT_STATE, gateInfo, ringDistances, SENSOR_MODELS } from "../src/model/presets";
import { cloneState, parseState } from "../src/model/serialize";
import type { Sensor } from "../src/model/types";

const fresh = () => cloneState(DEFAULT_STATE);
const sensor = (patch: Partial<Sensor> = {}): Sensor => ({ ...fresh().sensors[0], ...patch });

describe("sensor models", () => {
  it("the LD2450 is the default sensor", () => {
    const s = fresh().sensors[0];
    expect(s.model).toBe("ld2450");
    expect([s.hfov, s.vfov, s.range]).toEqual([120, 70, 6]);
    expect(gateInfo(s)).toBeNull();
  });

  it("offers LD2450, LD2412 and LD2410", () => {
    expect(SENSOR_MODELS.map((m) => m.id)).toEqual(["ld2450", "ld2412", "ld2410"]);
  });

  it("LD2412: gates 0-13, 0.75 m apart by default, rated to 9 m", () => {
    const s = sensor();
    applyModel(s, "ld2412");
    expect(s).toMatchObject({ model: "ld2412", hfov: 150, vfov: 150, range: 9, gate: 0.75 });
    expect(gateInfo(s)).toEqual({ last: 13, spacing: 0.75, max: 9.75, spacings: [0.2, 0.5, 0.75] });
  });

  it("LD2410: gates 0-8, 0.75 m apart by default, rated to 5 m", () => {
    const s = sensor();
    applyModel(s, "ld2410");
    expect(s).toMatchObject({ model: "ld2410", hfov: 120, vfov: 120, range: 5, gate: 0.75 });
    expect(gateInfo(s)).toEqual({ last: 8, spacing: 0.75, max: 6, spacings: [0.2, 0.75] });
  });

  it("choosing Custom keeps the current numbers", () => {
    const s = sensor();
    applyModel(s, "ld2412");
    applyModel(s, "custom");
    expect(s).toMatchObject({ model: "custom", hfov: 150, vfov: 150, range: 9 });
    expect(gateInfo(s)).toBeNull();
  });

  it("editing a field of view by hand keeps the model and its gates, and is flagged", () => {
    const s = sensor();
    applyModel(s, "ld2412");
    setGateSpacing(s, 0.5);
    expect(fovEdited(s)).toBe(false);
    setSensorFov(s, "hfov", 100);
    expect(s.model).toBe("ld2412");
    expect(fovEdited(s)).toBe(true);
    expect(gateInfo(s)?.spacing).toBe(0.5);
    expect(ringDistances(s, 1).length).toBe(13); // 13 x 0.5 = 6.5 m, all inside the 6.5 m reach
    applyModel(s, "ld2412"); // picking the model again resets it
    expect(fovEdited(s)).toBe(false);
  });

  it("a new sensor copies the selected sensor's model and gate spacing", () => {
    const st = fresh();
    applyModel(st.sensors[0], "ld2410");
    setGateSpacing(st.sensors[0], 0.2);
    const added = addSensor(st, st.sensors[0]);
    expect(added).toMatchObject({ model: "ld2410", gate: 0.2, range: 1.6 });
  });
});

describe("gate spacing", () => {
  it("rated reach per spacing matches the published figures", () => {
    const ld2412 = SENSOR_MODELS.find((m) => m.id === "ld2412")!, ld2410 = SENSOR_MODELS.find((m) => m.id === "ld2410")!;
    expect([0.75, 0.5, 0.2].map((g) => ratedRange(ld2412, g))).toEqual([9, 6.5, 13 * 0.2]); // 9 / 6.5 / 2.6 m
    expect([0.75, 0.2].map((g) => ratedRange(ld2410, g))).toEqual([5, 8 * 0.2]); // 5 m (spec sheet) / 1.6 m
  });

  it("moves the max distance to the published reach for each spacing (rated range, capped at the last gate)", () => {
    const s = sensor();
    applyModel(s, "ld2412");
    setGateSpacing(s, 0.5);
    expect(s.gate).toBe(0.5);
    expect(s.range).toBeCloseTo(6.5); // gate 13 x 0.5 m
    setGateSpacing(s, 0.2);
    expect(s.range).toBeCloseTo(2.6); // gate 13 x 0.2 m
    setGateSpacing(s, 0.75);
    expect(s.range).toBe(9); // rated 9 m (gate 13 would be 9.75 m)
  });

  it("LD2410 at 0.2 m reaches 1.6 m", () => {
    const s = sensor();
    applyModel(s, "ld2410");
    setGateSpacing(s, 0.2);
    expect(s.range).toBeCloseTo(1.6);
  });

  it("ignores spacings the model doesn't support, and non-gated sensors", () => {
    const s = sensor();
    applyModel(s, "ld2410");
    setGateSpacing(s, 0.5); // the LD2410 has no 0.5 m mode
    expect(s.gate).toBe(0.75);
    const t = sensor(); // LD2450
    setGateSpacing(t, 0.2);
    expect(t.range).toBe(6);
  });

  it("max distance can't be set past the last gate", () => {
    const s = sensor();
    applyModel(s, "ld2412");
    setSensorRange(s, 12);
    expect(s.range).toBeCloseTo(9.75);
    setSensorRange(s, 4);
    expect(s.range).toBe(4);
    const t = sensor(); // non-gated: up to 50 m
    setSensorRange(t, 12);
    expect(t.range).toBe(12);
  });
});

describe("range rings", () => {
  it("non-gated sensors: every step inside the max distance", () => {
    expect(ringDistances(sensor({ range: 6 }), 1)).toEqual([1, 2, 3, 4, 5]);
    expect(ringDistances(sensor({ range: 6 }), 0.9144).length).toBe(6); // every 3 ft
  });

  it("gated sensors: one ring per gate (gate 0 is the sensor), within the max distance", () => {
    const s = sensor();
    applyModel(s, "ld2410"); // 0.75 m, rated 5 m: gates 1-6 (gates 7 and 8 at 5.25 and 6 m are past it)
    expect(ringDistances(s, 1)).toEqual([0.75, 1.5, 2.25, 3, 3.75, 4.5]);
    setSensorRange(s, 6); // raised to the last gate, all 8 show
    expect(ringDistances(s, 1).length).toBe(8);
    applyModel(s, "ld2412"); // 0.75 m, rated 9 m: gates 1-12 (gate 13 at 9.75 m is past the rated reach)
    expect(ringDistances(s, 1).length).toBe(12);
    setSensorRange(s, 9.75); // raising the max distance to the last gate shows it
    expect(ringDistances(s, 1).length).toBe(13);
    setGateSpacing(s, 0.2);
    const r = ringDistances(s, 1);
    expect(r.length).toBe(13);
    expect(r[12]).toBeCloseTo(2.6);
  });
});

describe("loading saves", () => {
  it("recognizes the model of a save made before models were stored", () => {
    const st = parseState({ sensors: [{ id: 1, x: 1, y: 1, z: 1, hfov: 150, vfov: 150, range: 9 }] });
    expect(st.sensors[0]).toMatchObject({ model: "ld2412", gate: 0.75 });
    const old = parseState({ sensors: [{ id: 1, x: 1, y: 1, z: 1, hfov: 100, vfov: 60, range: 5 }] });
    expect(old.sensors[0].model).toBe("custom");
  });

  it("keeps a valid gate spacing, replaces an invalid one, and caps the range", () => {
    const ok = parseState({ sensors: [{ id: 1, model: "ld2410", gate: 0.2, hfov: 120, vfov: 120, range: 6 }] });
    expect(ok.sensors[0]).toMatchObject({ model: "ld2410", gate: 0.2 });
    expect(ok.sensors[0].range).toBeCloseTo(1.6);
    const bad = parseState({ sensors: [{ id: 1, model: "ld2412", gate: 0.33, range: 9 }] });
    expect(bad.sensors[0].gate).toBe(0.75);
    const unknown = parseState({ sensors: [{ id: 1, model: "ld9999", hfov: 120, vfov: 70, range: 6 }] });
    expect(unknown.sensors[0].model).toBe("ld2450"); // recognized from its numbers instead
  });

  it("a sensor that names its model gets that model's numbers for anything it leaves out", () => {
    const st = parseState({ sensors: [{ id: 1, model: "ld2410", gate: 0.2 }] });
    expect(st.sensors[0]).toMatchObject({ model: "ld2410", hfov: 120, vfov: 120, gate: 0.2 });
    expect(st.sensors[0].range).toBeCloseTo(1.6);
    const t = parseState({ sensors: [{ id: 1, model: "ld2412" }] });
    expect(t.sensors[0]).toMatchObject({ hfov: 150, vfov: 150, gate: 0.75, range: 9 });
  });
});

describe("snapping buttons", () => {
  it("Nearest Wall always picks a wall, even right under the ceiling or in a corner", () => {
    const st = fresh();
    const s = Object.assign(st.sensors[0], { x: 0.3, y: 0.4, z: 2.58 }); // closest to the ceiling, and in a corner
    expect(nearestWall(st, s)).toBe("x0");
    const msg = snapToWall(st, s);
    expect([s.x, s.y, s.pan, s.tilt]).toEqual([SURFACE_GAP, 0.4, 90, 0]);
    expect(s.z).toBeLessThan(2.6);
    expect(msg).toBe("Mounted on the left wall, pointing straight out.");
  });

  it("Nearest Corner always picks the closest corner, even from the middle of a wall", () => {
    const st = fresh();
    const s = Object.assign(st.sensors[0], { x: 3.1, y: 0.02, z: 1.5 }); // on the front wall, right of center
    expect(nearestCorner(st, s)).toEqual(["y0", "xW"]);
    const msg = snapToCorner(st, s);
    expect(s.x).toBeCloseTo(5 - CORNER_GAP);
    expect(s.y).toBeCloseTo(CORNER_GAP);
    expect([s.pan, s.tilt, s.z]).toEqual([-45, 0, 1.5]);
    expect(msg).toBe("Mounted in the front-right corner, angled 45° into the room.");
  });

  it("Nearest Ceiling always goes flush on the ceiling above, even from low on a wall", () => {
    const st = fresh();
    const s = Object.assign(st.sensors[0], { x: 2.5, y: 0.02, z: 1.0 });
    const msg = snapToCeiling(st, s);
    expect(s.y).toBeCloseTo(0.08); // moved clear of the wall
    expect(s.z).toBeCloseTo(2.575);
    expect(s.tilt).toBe(-90);
    expect(msg).toBe("Mounted flush on the ceiling, pointing straight down.");
  });

  it("each button is stable when pressed again", () => {
    for (const fn of [snapToWall, snapToCorner, snapToCeiling]) {
      const st = fresh();
      Object.assign(st.room, { ceiling: "double", peak: 3.6, ridge: "y" });
      const s = Object.assign(st.sensors[0], { x: 1.3, y: 2.9, z: 2.0 });
      fn(st, s);
      const once = { ...s };
      fn(st, s);
      expect(s).toEqual(once);
    }
  });
});
