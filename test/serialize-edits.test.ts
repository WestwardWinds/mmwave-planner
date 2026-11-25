import { describe, it, expect } from "vitest";
import { parseState, encodeShare, decodeShare, freeColor, assignColors, cloneState } from "../src/model/serialize";
import {
  clampToRoom, clampBox, CeilingMounts, setCeiling, applyMount, aimAt, addSensor, removeSensor, addObstacle, activeSensor
} from "../src/model/edits";
import { Store } from "../src/model/store";
import { DEFAULT_STATE } from "../src/model/presets";
import type { PlannerState, Sensor, Obstacle } from "../src/model/types";

const fresh = (): PlannerState => cloneState(DEFAULT_STATE);
const colors = (st: PlannerState) => st.sensors.map((s) => s.color);
const distinct = (a: number[]) => new Set(a).size === a.length;

/** Single pitch, low on the y=0 wall: z = 2.6 + (1/4) * y (w 5, d 4, h 2.6, peak 3.6). */
function sloped(): PlannerState {
  const st = fresh();
  Object.assign(st.room, { ceiling: "single", low: "y0", peak: 3.6 });
  return st;
}

describe("parseState", () => {
  it("returns the default state for garbage input", () => {
    for (const g of [null, undefined, 42, "x", [], [1, 2], true]) expect(parseState(g)).toEqual(DEFAULT_STATE);
  });

  it("does not share objects with DEFAULT_STATE", () => {
    const a = parseState(null);
    a.sensors[0].x = 99;
    expect(DEFAULT_STATE.sensors[0].x).toBe(2.5);
  });

  it("fills missing and broken fields from defaults on partial input", () => {
    const st = parseState({ room: { w: 8, d: "bad", h: NaN, ceiling: "dome", low: "nope" }, view: { clip: false, units: "yards", rings: "yes" } });
    expect(st.room.w).toBe(8);
    expect(st.room.d).toBe(4);
    expect(st.room.h).toBe(2.6);
    expect(st.room.ceiling).toBe("flat");
    expect(st.room.low).toBe("y0");
    expect(st.view.clip).toBe(false);
    expect(st.view.rings).toBe(true); // non-boolean ignored
    expect(st.view.units).toBe("m");
    expect(st.sensors).toEqual(DEFAULT_STATE.sensors);
  });

  it("floors room dimensions at 0.5 m", () => {
    const st = parseState({ room: { w: 0, d: -3, h: 0.1 } });
    expect([st.room.w, st.room.d, st.room.h]).toEqual([0.5, 0.5, 0.5]);
  });

  it("migrates the old single-`sensor` format", () => {
    const st = parseState({ room: { w: 6, d: 5, h: 2.5 }, sensor: { x: 1, y: 2, z: 1.5, pan: 30, hfov: 100 } });
    expect(st.sensors).toHaveLength(1);
    const s = st.sensors[0];
    expect(s).toMatchObject({ id: 1, name: "Sensor 1", color: 1, x: 1, y: 2, z: 1.5, pan: 30, hfov: 100 });
    expect(s.vfov).toBe(70); // template fallback
    expect(st.active).toBe(1);
  });

  it("uses [] for obstacles on an old save that has a room but no obstacles", () => {
    expect(parseState({ room: { w: 6 } }).obstacles).toEqual([]);
    // no room either: example box is kept
    expect(parseState({ sensors: [{ x: 1 }] }).obstacles).toEqual(DEFAULT_STATE.obstacles);
  });

  it("makes duplicate ids unique", () => {
    const st = parseState({ sensors: [{ id: 1 }, { id: 1 }, { id: 2 }] });
    // 1, 1->2, 2->3
    expect(st.sensors.map((s) => s.id)).toEqual([1, 2, 3]);
    const pts = parseState({ points: [{ id: 5, x: 0, y: 0, z: 0 }, { id: 5, x: 1, y: 1, z: 1 }] }).points;
    expect(pts.map((p) => p.id)).toEqual([5, 6]);
  });

  it("replaces invalid and duplicate colors with distinct slots", () => {
    const st = parseState({ sensors: [{ color: 2 }, { color: 2 }, { color: 9 }, { color: "red" }] });
    // first keeps 2; the rest get lowest free: 1, 3, 4
    expect(colors(st)).toEqual([2, 1, 3, 4]);
  });

  it("falls back to the first sensor when active is unknown", () => {
    expect(parseState({ sensors: [{ id: 3 }, { id: 7 }], active: 7 }).active).toBe(7);
    expect(parseState({ sensors: [{ id: 3 }, { id: 7 }], active: 99 }).active).toBe(3);
    expect(parseState({ sensors: [{ id: 3 }, { id: 7 }], active: "7" }).active).toBe(3);
  });

  it("clamps FOV to [1, 180] and range to >= 0.1", () => {
    const [a, b] = parseState({ sensors: [{ hfov: 500, vfov: 0, range: -2 }, { hfov: -10, vfov: 181, range: 0.05 }] }).sensors;
    expect([a.hfov, a.vfov, a.range]).toEqual([180, 1, 0.1]);
    expect([b.hfov, b.vfov, b.range]).toEqual([1, 180, 0.1]);
  });

  it("drops non-object sensors and malformed points/obstacles; keeps defaults if nothing valid", () => {
    const st = parseState({
      sensors: [1, "x", null],
      points: [{ x: 1, y: 2 }, { x: 1, y: 2, z: 3 }],
      obstacles: [{ x: 1, y: 1, z: 0, w: 0, d: 1, h: 1, rot: 0 }, { x: 1 }]
    });
    expect(st.sensors).toEqual(DEFAULT_STATE.sensors);
    expect(st.points).toHaveLength(1);
    expect(st.obstacles).toHaveLength(1);
    expect(st.obstacles[0].w).toBe(0.02); // floored
  });
});

describe("share codes", () => {
  it("round-trips a state, including non-ASCII names", () => {
    const st = fresh();
    st.sensors[0].name = "Küche ✓";
    st.room.w = 7.25;
    const code = encodeShare(st);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe, no padding
    expect(decodeShare(code)).toEqual(st);
  });

  it("returns null for bad input", () => {
    expect(decodeShare("!!!not base64!!!")).toBeNull();
    expect(decodeShare(btoa("{not json"))).toBeNull();
  });
});

describe("freeColor / assignColors", () => {
  const mk = (id: number, color: number): Sensor => ({ ...DEFAULT_STATE.sensors[0], id, color });

  it("picks the lowest unused slot, ignoring `except`", () => {
    const list = [mk(1, 1), mk(2, 3)];
    expect(freeColor(list)).toBe(2);
    expect(freeColor(list, list[0])).toBe(1);
  });

  it("assignColors keeps valid unique colors and fixes the rest", () => {
    const list = [mk(1, 4), mk(2, 4), mk(3, 0)];
    assignColors(list);
    expect(list.map((s) => s.color)).toEqual([4, 1, 2]);
  });

  it("add/remove cycles never give two live sensors the same color (<= 4 sensors)", () => {
    const st = fresh();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 300; i++) {
      if (st.sensors.length < 4 && (st.sensors.length < 2 || rnd() < 0.5)) addSensor(st, st.sensors[0]);
      else removeSensor(st, st.sensors[Math.floor(rnd() * st.sensors.length)].id);
      expect(distinct(colors(st))).toBe(true);
      expect(colors(st).every((c) => c >= 1 && c <= 4)).toBe(true);
    }
  });
});

describe("clampToRoom / clampBox under a sloped ceiling", () => {
  it("clamps z to the ceiling at the spot", () => {
    const st = sloped();
    const low = { x: 1, y: 0, z: 3 };
    clampToRoom(st, low);
    expect(low.z).toBeCloseTo(2.6); // ceiling at y=0
    const high = { x: 1, y: 4, z: 3.5 };
    clampToRoom(st, high);
    expect(high.z).toBe(3.5); // ceiling at y=4 is 3.6
    const out = { x: -1, y: 9, z: -1 };
    clampToRoom(st, out);
    expect(out).toEqual({ x: 0, y: 4, z: 0 });
  });

  it("clampBox fits height to the ceiling at the box center", () => {
    const st = sloped();
    const b: Obstacle = { id: 1, name: "B", x: 2, y: 2, z: 0.5, w: 100, d: 0.001, h: 5, rot: 370 };
    clampBox(st, b);
    // top at y=2: 2.6 + 0.25*2 = 3.1
    expect(b.h).toBeCloseTo(3.1);
    expect(b.z).toBeCloseTo(0); // 3.1 - 3.1
    expect(b.w).toBe(50);
    expect(b.d).toBe(0.02);
    expect(b.rot).toBeCloseTo(10);
  });
});

describe("CeilingMounts", () => {
  it("keeps a ceiling sensor's gap and leaves a wall sensor alone when the ceiling becomes single pitch", () => {
    const st = fresh();
    st.sensors = [
      { ...st.sensors[0], id: 1, x: 2.5, y: 2, z: 2.55 }, // 0.05 under flat 2.6
      { ...st.sensors[0], id: 2, color: 2, x: 2.5, y: 2, z: 2.0 } // wall height
    ];
    const m = new CeilingMounts();
    m.record(st);
    Object.assign(st.room, { ceiling: "single", low: "y0", peak: 3.6 });
    m.follow(st);
    // ceiling at y=2: 2.6 + 0.25*2 = 3.1; minus gap 0.05
    expect(st.sensors[0].z).toBeCloseTo(3.05);
    expect(st.sensors[1].z).toBe(2.0);
  });

  it("stretches a box that touched the ceiling", () => {
    const st = fresh();
    st.obstacles = [{ id: 1, name: "W", x: 2.5, y: 2, z: 0, w: 1, d: 0.1, h: 2.6, rot: 0 }];
    const m = new CeilingMounts();
    m.record(st);
    Object.assign(st.room, { ceiling: "single", low: "y0", peak: 3.6 });
    m.follow(st);
    expect(st.obstacles[0].h).toBeCloseTo(3.1);
  });
});

describe("setCeiling", () => {
  it("bumps the peak to h+1 when pitched and peak is too low", () => {
    const st = fresh();
    st.room.peak = 2.6;
    setCeiling(st, "double");
    expect(st.room.ceiling).toBe("double");
    expect(st.room.peak).toBe(3.6);
  });
  it("leaves a high enough peak and flat ceilings alone", () => {
    const st = fresh();
    st.room.peak = 4.2;
    setCeiling(st, "single");
    expect(st.room.peak).toBe(4.2);
    st.room.peak = 1;
    setCeiling(st, "flat");
    expect(st.room.peak).toBe(1);
  });
});

describe("applyMount", () => {
  it("front", () => {
    const st = fresh(); const s = st.sensors[0];
    applyMount(st, s, "front");
    // z = min(2, 2.6 - 0.2)
    expect(s).toMatchObject({ x: 2.5, y: 0.02, pan: 0, tilt: -20, roll: 0 });
    expect(s.z).toBeCloseTo(2.0);
  });
  it("left", () => {
    const st = fresh(); const s = st.sensors[0];
    applyMount(st, s, "left");
    expect(s).toMatchObject({ x: 0.02, y: 2, pan: 90, tilt: -20, roll: 0 });
    expect(s.z).toBeCloseTo(2.0);
  });
  it("corner on a slope", () => {
    const st = sloped(); const s = st.sensors[0];
    applyMount(st, s, "corner");
    // ceiling at y=0.06: 2.6 + 0.06/4 = 2.615; minus 0.1 so it reads as a corner mount, not a ceiling one
    expect(s).toMatchObject({ x: 0.06, y: 0.06, pan: 45, tilt: -35 });
    expect(s.z).toBeCloseTo(2.515, 6);
  });
  it("ceiling", () => {
    const st = sloped(); const s = st.sensors[0];
    applyMount(st, s, "ceiling");
    // ceiling at (2.5, 2): 3.1; minus 0.02
    expect(s).toMatchObject({ x: 2.5, y: 2, pan: 0, tilt: -90 });
    expect(s.z).toBeCloseTo(3.08);
  });
  it("flush on a flat ceiling points straight down and keeps pan", () => {
    const st = fresh(); const s = st.sensors[0];
    s.pan = 33;
    applyMount(st, s, "flush");
    expect(s.tilt).toBe(-90);
    expect(s.pan).toBe(33);
    expect(s.z).toBeCloseTo(2.575, 6); // 2.6 - the 2.5 cm body depth
  });
  it("flush on a gable slope (2.5 m half-width, 1 m rise) tilts ~-68.2 deg toward the ridge", () => {
    const st = fresh();
    Object.assign(st.room, { ceiling: "double", ridge: "y", peak: 3.6 });
    const s = st.sensors[0];
    Object.assign(s, { x: 1, y: 2, pan: 0 });
    applyMount(st, s, "flush");
    // plane z = 2.6 + 0.4x; normal (0.4, 0, -1): tilt = asin(-1/sqrt(1.16)) = -68.2, pan = atan2(0.4, 0) = 90 (+X, ridge at x=2.5)
    expect(s.tilt).toBeCloseTo(-68.2, 1);
    expect(s.pan).toBeCloseTo(90, 1);
    // 2.6 + 0.4, less the 2.5 cm body depth measured square to the slope: 0.025 * sqrt(1.16) vertically
    expect(s.z).toBeCloseTo(3.0 - 0.025 * Math.sqrt(1.16), 6);
    // on the far side the slope points back toward the ridge
    Object.assign(s, { x: 4 });
    applyMount(st, s, "flush");
    expect(s.pan).toBeCloseTo(-90, 1);
  });
});

describe("aimAt", () => {
  it("aims at a target with rounded pan/tilt", () => {
    const s: Sensor = { ...DEFAULT_STATE.sensors[0], x: 0, y: 0, z: 2, pan: 0, tilt: 0 };
    aimAt(s, { x: 1, y: 1, z: 2 - Math.SQRT2 });
    // pan atan2(1,1)=45, tilt atan2(-sqrt2, sqrt2) = -45
    expect(s.pan).toBe(45);
    expect(s.tilt).toBe(-45);
  });
  it("keeps pan for a target straight below and ignores its own position", () => {
    const s: Sensor = { ...DEFAULT_STATE.sensors[0], x: 1, y: 1, z: 2, pan: 17, tilt: 5 };
    aimAt(s, { x: 1, y: 1, z: 0 });
    expect(s.pan).toBe(17);
    expect(s.tilt).toBe(-90);
    aimAt(s, { x: 1, y: 1, z: 2 });
    expect([s.pan, s.tilt]).toEqual([17, -90]);
  });
});

describe("addSensor / removeSensor", () => {
  it("adds a sensor on the back wall, copies the model and makes it active", () => {
    const st = fresh();
    const like = { ...st.sensors[0], hfov: 150, vfov: 150, range: 9 };
    const s = addSensor(st, like);
    expect(s).toMatchObject({ id: 2, name: "Sensor 2", color: 2, x: 2.5, y: 3.98, pan: 180, hfov: 150, vfov: 150, range: 9 });
    expect(s.z).toBeCloseTo(2.0); // min(2, 2.6 - 0.2)
    expect(st.active).toBe(2);
    expect(activeSensor(st)).toBe(s);
  });
  it("removeSensor moves active to the first sensor and refuses to remove the last one", () => {
    const st = fresh();
    addSensor(st, st.sensors[0]);
    addSensor(st, st.sensors[0]);
    expect(st.active).toBe(3);
    removeSensor(st, 3);
    expect(st.active).toBe(1);
    removeSensor(st, 2);
    expect(st.sensors.map((s) => s.id)).toEqual([1]);
    removeSensor(st, 1);
    expect(st.sensors).toHaveLength(1);
  });
  it("removing a non-active sensor keeps active", () => {
    const st = fresh();
    addSensor(st, st.sensors[0]);
    removeSensor(st, 1);
    expect(st.active).toBe(2);
  });
});

describe("addObstacle", () => {
  it("wall preset is ceiling height (flat and sloped)", () => {
    const st = fresh();
    expect(addObstacle(st, "wall")!.h).toBeCloseTo(2.6);
    const sl = sloped();
    expect(addObstacle(sl, "wall")!.h).toBeCloseTo(3.1); // ceiling at room center y=2
  });
  it("numbers repeated presets and rejects unknown ones", () => {
    const st = fresh();
    st.obstacles = [];
    expect(addObstacle(st, "box")!.name).toBe("Box");
    const b2 = addObstacle(st, "box")!;
    expect(b2.name).toBe("Box 2");
    expect(b2.id).toBe(2);
    expect(addObstacle(st, "piano")).toBeNull();
  });
});

describe("Store", () => {
  it("update mutates and notifies subscribers once; unsubscribe stops it", () => {
    const store = new Store(fresh());
    let calls = 0;
    let seenW = 0;
    const off = store.subscribe((s) => { calls++; seenW = s.room.w; });
    store.update((s) => { s.room.w = 9; });
    expect(calls).toBe(1);
    expect(seenW).toBe(9);
    off();
    store.update();
    expect(calls).toBe(1);
  });
  it("replace validates input and notifies", () => {
    const store = new Store(fresh());
    let calls = 0;
    store.subscribe(() => calls++);
    store.replace({ room: { w: -5 }, sensors: [{ id: 4, hfov: 999 }], active: 1 });
    expect(calls).toBe(1);
    expect(store.state.room.w).toBe(0.5);
    expect(store.state.sensors[0].hfov).toBe(180);
    expect(store.state.active).toBe(4);
    store.replace("garbage");
    expect(store.state).toEqual(DEFAULT_STATE);
  });
  it("snapshot is a deep copy", () => {
    const store = new Store(fresh());
    const snap = store.snapshot();
    snap.room.w = 42;
    expect(store.state.room.w).toBe(5);
  });
});
