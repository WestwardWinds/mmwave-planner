import { describe, it, expect } from "vitest";
import { prepareOccluders, segmentHits, insideBox, blockerFor } from "../src/model/occlusion";
import { computeCoverage, sliceGrid, Cell } from "../src/model/coverage";
import type { Obstacle, PlannerState, Room, Sensor } from "../src/model/types";

const box = (o: Partial<Obstacle>): Obstacle => ({ id: 1, name: "box", x: 0, y: 0, z: 0, w: 2, d: 1, h: 2, rot: 0, ...o });

const sensor = (o: Partial<Sensor>): Sensor => ({
  id: 1, name: "S", color: 1, x: 0, y: 0, z: 2, pan: 0, tilt: 0, roll: 0, hfov: 179, vfov: 179, range: 10, ...o
});

const room = (o: Partial<Room>): Room => ({ w: 2, d: 2, h: 2.5, ceiling: "flat", peak: 2.5, low: "y0", ridge: "x", ...o });

const view = (sliceH: number): PlannerState["view"] => ({
  clip: false, slice: true, sliceH, rings: false, snap: false, units: "m", cones: "all"
});

const state = (o: Partial<PlannerState>): PlannerState => ({
  room: room({}),
  sensors: [],
  active: 1,
  points: [],
  obstacles: [],
  view: view(1),
  ...o
});

/** World segment from -> to against one box. */
function hits(b: Obstacle, from: [number, number, number], to: [number, number, number]): boolean {
  const [o] = prepareOccluders([b], { x: from[0], y: from[1], z: from[2] });
  return segmentHits(o, o.toLocal(to[0], to[1], to[2]));
}

/** Cell index of world (x, y) on the grid: row 0 is y = d, col 0 is x = 0. */
function cellAt(cov: { cols: number; rows: number }, w: number, d: number, x: number, y: number): number {
  const i = Math.floor((x / w) * cov.cols);
  const j = Math.floor(((d - y) / d) * cov.rows);
  return j * cov.cols + i;
}

describe("segmentHits", () => {
  // Box centered at origin, local w=2 (x), d=1 (y), z 0..2. Rotated 90 deg: world x in +-0.5, y in +-1.
  const b90 = box({ rot: 90 });

  it("hits a segment passing straight through (rot 90)", () => {
    expect(hits(b90, [-3, 0.8, 1], [3, 0.8, 1])).toBe(true); // |y|=0.8 < 1
  });

  it("the same segment misses the unrotated box", () => {
    expect(hits(box({ rot: 0 }), [-3, 0.8, 1], [3, 0.8, 1])).toBe(false); // |y|=0.8 > 0.5
  });

  it("misses a segment passing beside (rot 90)", () => {
    expect(hits(b90, [-3, 1.2, 1], [3, 1.2, 1])).toBe(false); // |y|=1.2 > 1
  });

  it("misses a segment passing above", () => {
    expect(hits(b90, [-3, 0, 2.5], [3, 0, 2.5])).toBe(false); // z=2.5 > top 2
  });

  it("hits a segment that dips through the top", () => {
    expect(hits(b90, [-3, 0, 3], [3, 0, 1])).toBe(true); // z=2 at x=0
  });

  it("hits a segment that ends inside", () => {
    expect(hits(b90, [-3, 0, 1], [0, 0, 1])).toBe(true);
  });

  it("hits a segment that starts inside", () => {
    expect(hits(b90, [0, 0, 1], [3, 3, 1])).toBe(true);
  });

  it("misses a segment that stops short of the box", () => {
    expect(hits(b90, [-3, 0, 1], [-1, 0, 1])).toBe(false); // box starts at x=-0.5
  });

  it("hits a segment that just reaches the face", () => {
    expect(hits(b90, [-3, 0, 1], [-0.5, 0, 1])).toBe(true); // touching counts
  });

  describe("rot 30", () => {
    const b30 = box({ rot: 30 });
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    // local x axis u = (c, s), local y axis n = (-s, c)
    const along = (off: number, t: number): [number, number, number] => [t * c - off * s, t * s + off * c, 1];

    it("hits a segment along the local x axis offset 0.4 (< half depth 0.5)", () => {
      expect(hits(b30, along(0.4, -3), along(0.4, 3))).toBe(true);
    });

    it("misses a segment along the local x axis offset 0.6 (> 0.5)", () => {
      expect(hits(b30, along(0.6, -3), along(0.6, 3))).toBe(false);
    });

    it("vertical drops onto points just outside / inside the rotated footprint", () => {
      // world (0, 0.7) -> local y = 0.7*cos30 = 0.606 > 0.5: miss
      expect(hits(b30, [0, 0.7, 3], [0, 0.7, 0.5])).toBe(false);
      // world (-0.3, 0.3) -> local (-0.3c + 0.3s, 0.3s + 0.3c) = (-0.11, 0.41): inside
      expect(hits(b30, [-0.3, 0.3, 3], [-0.3, 0.3, 0.5])).toBe(true);
      // world (0.95, 0.4): inside unrotated (|x| < 1, |y| < 0.5),
      // but rotated local x = 0.95c + 0.4s = 0.823 + 0.2 = 1.02 > 1: outside
      expect(hits(box({ rot: 0 }), [0.95, 0.4, 3], [0.95, 0.4, 0.5])).toBe(true);
      expect(hits(b30, [0.95, 0.4, 3], [0.95, 0.4, 0.5])).toBe(false);
    });
  });
});

describe("insideBox", () => {
  const [o] = prepareOccluders([box({ x: 1, y: 1, rot: 90 })], { x: 0, y: 0, z: 0 });

  it("is true inside the rotated footprint", () => {
    // rot 90 at (1,1): world x 0.5..1.5, y 0..2
    expect(insideBox(o, o.toLocal(1.4, 1.9, 1))).toBe(true);
  });

  it("is false outside the rotated footprint even where the unrotated box would contain it", () => {
    // unrotated would be x 0..2, y 0.5..1.5; (1.8, 1.2) is outside x 0.5..1.5
    expect(insideBox(o, o.toLocal(1.8, 1.2, 1))).toBe(false);
  });

  it("is false above the top and true on the boundary", () => {
    expect(insideBox(o, o.toLocal(1, 1, 2.01))).toBe(false);
    expect(insideBox(o, o.toLocal(1, 1, 2))).toBe(true); // top face, |P.z| = h/2
  });

  it("toLocal measures z from the box's vertical center", () => {
    const [p] = prepareOccluders([box({ z: 1, h: 2 })], { x: 0, y: 0, z: 0 });
    expect(p.toLocal(0, 0, 2)[2]).toBeCloseTo(0); // center z = 1 + 2/2
    expect(p.from[2]).toBeCloseTo(-2);
  });
});

describe("blockerFor", () => {
  const A = box({ id: 1, name: "A", x: 2, y: 3, w: 0.5, d: 0.5 }); // off to the side
  const B = box({ id: 2, name: "B", x: 2, y: 0, w: 0.5, d: 0.5 }); // on the line from (0,0) to (4,0)
  const C = box({ id: 3, name: "C", x: 3, y: 0, w: 0.5, d: 0.5 }); // also on the line

  it("returns the box in the way", () => {
    const occ = prepareOccluders([A, B], { x: 0, y: 0, z: 1 });
    expect(blockerFor(occ, 4, 0, 1)).toBe(B);
  });

  it("returns null when the line is clear", () => {
    const occ = prepareOccluders([A, B], { x: 0, y: 0, z: 1 });
    expect(blockerFor(occ, 0, 4, 1)).toBeNull(); // along +y at x=0; A spans x 1.75..2.25
  });

  it("returns the first listed blocker when several block", () => {
    expect(blockerFor(prepareOccluders([C, B], { x: 0, y: 0, z: 1 }), 4, 0, 1)).toBe(C);
    expect(blockerFor(prepareOccluders([B, C], { x: 0, y: 0, z: 1 }), 4, 0, 1)).toBe(B);
  });

  it("ignores a box beyond the target", () => {
    const occ = prepareOccluders([C], { x: 0, y: 0, z: 1 });
    expect(blockerFor(occ, 2, 0, 1)).toBeNull(); // C starts at x=2.75
  });
});

describe("computeCoverage", () => {
  it("sliceGrid: 2 cm floor for small rooms, ~220 cells along the long side for big ones", () => {
    expect(sliceGrid(2, 2)).toEqual({ cols: 100, rows: 100 }); // 2/220 = 0.009 < 0.02 -> 2 cm
    expect(sliceGrid(4, 2)).toEqual({ cols: 200, rows: 100 }); // 4/220 = 0.018 < 0.02 -> 2 cm
    // 11/220 = 0.05 m cells: cols = 220, rows = ceil(3 / 0.05) = 60
    expect(sliceGrid(11, 3)).toEqual({ cols: 220, rows: 60 });
  });

  it("one ceiling sensor pointing down with a huge FOV covers 100%", () => {
    // sensor at (1,1,2.5); farthest cell ~1.41 m sideways, 1.5 m down: ~43 deg off axis < 89.5
    const st = state({ sensors: [sensor({ x: 1, y: 1, z: 2.5, tilt: -90 })] });
    const cov = computeCoverage(st);
    expect(cov.z).toBe(1);
    expect(cov.coveredPct).toBeCloseTo(100);
    expect(cov.overlapPct).toBe(0);
    expect(cov.hiddenPct).toBe(0);
    expect(Array.from(cov.kind).every((k) => k === Cell.One)).toBe(true);
    expect(Array.from(cov.who).every((v) => v === 0)).toBe(true);
    expect(Array.from(cov.count).every((v) => v === 1)).toBe(true);
  });

  it("with no sensors everything is None and percentages are 0", () => {
    const cov = computeCoverage(state({}));
    expect(Array.from(cov.kind).every((k) => k === Cell.None)).toBe(true);
    expect(cov.coveredPct).toBe(0);
    expect(cov.hiddenPct).toBe(0);
    expect(Array.from(cov.who).every((v) => v === -1)).toBe(true);
  });

  it("clamps the slice height to the room", () => {
    expect(computeCoverage(state({}), 99).z).toBe(2.5);
    expect(computeCoverage(state({}), -1).z).toBe(0);
    expect(computeCoverage(state({ room: room({ ceiling: "single", h: 2, peak: 3 }) }), 99).z).toBe(3);
  });

  describe("full-height partition wall", () => {
    // room 4 x 2; wall x 1.95..2.05 across the whole depth and height; sensor at (0.5,1,1) facing +X
    const st = state({
      room: room({ w: 4, d: 2 }),
      sensors: [sensor({ x: 0.5, y: 1, z: 1, pan: 90 })],
      obstacles: [box({ x: 2, y: 1, w: 0.1, d: 2, h: 2.5 })]
    });
    const cov = computeCoverage(st);
    const xs = (i: number) => (i + 0.5) * (4 / cov.cols);
    const cells = (pred: (x: number) => boolean) => {
      const out: number[] = [];
      for (let j = 0; j < cov.rows; j++) for (let i = 0; i < cov.cols; i++) if (pred(xs(i))) out.push(cov.kind[j * cov.cols + i]);
      return out;
    };

    it("every cell beyond the wall is Blocked", () => {
      const far = cells((x) => x > 2.05);
      expect(far.length).toBeGreaterThan(0);
      expect(far.every((k) => k === Cell.Blocked)).toBe(true);
    });

    it("no cell on the sensor side is Blocked; in front of the sensor they are One", () => {
      expect(cells((x) => x < 1.95).some((k) => k === Cell.Blocked)).toBe(false);
      expect(cells((x) => x > 0.5 && x < 1.95).every((k) => k === Cell.One)).toBe(true);
      // behind the sensor (x < 0.5) the azimuth exceeds 90 deg: outside the 179 deg cone
      expect(cells((x) => x < 0.49).every((k) => k === Cell.None)).toBe(true);
    });

    it("cells inside the wall are NotRoom", () => {
      const inWall = cells((x) => x > 1.951 && x < 2.049);
      expect(inWall.length).toBeGreaterThan(0);
      expect(inWall.every((k) => k === Cell.NotRoom)).toBe(true);
    });

    it("hiddenPct is the share of Blocked cells among room cells", () => {
      const k = Array.from(cov.kind);
      const total = k.filter((v) => v !== Cell.NotRoom).length;
      const blocked = k.filter((v) => v === Cell.Blocked).length;
      expect(cov.hiddenPct).toBeCloseTo((100 * blocked) / total);
      // far side x 2.05..4 is ~1.95/3.9 of the room width = ~50%
      expect(cov.hiddenPct).toBeGreaterThan(48);
      expect(cov.hiddenPct).toBeLessThan(52);
    });
  });

  describe("two sensors", () => {
    // sensors on the left and right walls facing each other, range 1.2, room 2 x 2, slice z = 1
    const st = state({
      sensors: [
        sensor({ id: 1, x: 0, y: 1, z: 1, pan: 90, range: 1.2 }),
        sensor({ id: 2, x: 2, y: 1, z: 1, pan: -90, range: 1.2 })
      ]
    });
    const cov = computeCoverage(st);

    it("the middle of the room is Overlap with count 2", () => {
      const k = cellAt(cov, 2, 2, 1.0, 1.0); // ~1 m from each sensor
      expect(cov.kind[k]).toBe(Cell.Overlap);
      expect(cov.count[k]).toBe(2);
      expect(cov.who[k]).toBe(-1);
    });

    it("Cell.One cells carry the index of the sensor that sees them", () => {
      const left = cellAt(cov, 2, 2, 0.3, 1.0); // 0.3 m from sensor 0, 1.7 m from sensor 1
      const right = cellAt(cov, 2, 2, 1.7, 1.0);
      expect(cov.kind[left]).toBe(Cell.One);
      expect(cov.who[left]).toBe(0);
      expect(cov.kind[right]).toBe(Cell.One);
      expect(cov.who[right]).toBe(1);
    });

    it("a cell out of range of both is None", () => {
      // (1, 0.05): sqrt(1 + 0.95^2) = ~1.38 from both > 1.2
      expect(cov.kind[cellAt(cov, 2, 2, 1.0, 0.05)]).toBe(Cell.None);
    });

    it("overlapPct and coveredPct match the cell counts", () => {
      const k = Array.from(cov.kind);
      const total = k.filter((v) => v !== Cell.NotRoom).length;
      expect(total).toBe(cov.cols * cov.rows);
      const ov = k.filter((v) => v === Cell.Overlap).length;
      const one = k.filter((v) => v === Cell.One).length;
      expect(ov).toBeGreaterThan(0);
      expect(cov.overlapPct).toBeCloseTo((100 * ov) / total);
      expect(cov.coveredPct).toBeCloseTo((100 * (ov + one)) / total);
      expect(cov.overlapPct).toBeLessThan(cov.coveredPct);
    });
  });

  describe("sloped ceiling", () => {
    // single pitch low at y=0: ceiling z = 2 + 0.5*y. At slice 2.5 the ceiling is below the slice where y < 1.
    const st = state({
      room: room({ w: 2, d: 2, h: 2, ceiling: "single", peak: 3, low: "y0" }),
      sensors: [sensor({ x: 1, y: 1.9, z: 2.9, tilt: -90 })],
      view: view(2.5)
    });
    const cov = computeCoverage(st);

    it("rows with y < 1 are NotRoom and rows with y > 1 are not", () => {
      // rows = 100; row j center y = 2 - (j + 0.5)*0.02: row 49 -> 1.01, row 50 -> 0.99
      for (let i = 0; i < cov.cols; i++) {
        expect(cov.kind[49 * cov.cols + i]).not.toBe(Cell.NotRoom);
        expect(cov.kind[50 * cov.cols + i]).toBe(Cell.NotRoom);
      }
      const notRoom = Array.from(cov.kind).filter((v) => v === Cell.NotRoom).length;
      expect(notRoom).toBe(50 * cov.cols);
    });

    it("NotRoom cells are left out of the percentages", () => {
      // the sensor sees every remaining cell (max ~1.4 m sideways, 0.4 m down: ~74 deg < 89.5)
      expect(cov.coveredPct).toBeCloseTo(100);
      expect(cov.hiddenPct).toBe(0);
    });
  });

  it("grid layout: row 0 is the back wall (y = d), column 0 is x = 0", () => {
    // small post near the back-left corner at (0.25, 1.75); 2 cm cells, so col 12 (x = 12.5*0.02 = 0.25),
    // row 12 (y = 2 - 12.5*0.02 = 1.75)
    const st = state({ obstacles: [box({ x: 0.25, y: 1.75, w: 0.1, d: 0.1, h: 2 })] });
    const cov = computeCoverage(st);
    expect(cov.kind[12 * cov.cols + 12]).toBe(Cell.NotRoom);
    // the mirrored front-left (row 87, y = 0.25) and back-right (col 87, x = 1.75) cells are room
    expect(cov.kind[87 * cov.cols + 12]).toBe(Cell.None);
    expect(cov.kind[12 * cov.cols + 87]).toBe(Cell.None);
    // post covers x 0.2..0.3, y 1.7..1.8: 5 x 5 cells
    expect(Array.from(cov.kind).filter((v) => v === Cell.NotRoom).length).toBe(25);
  });
});
