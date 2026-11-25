import { describe, it, expect } from "vitest";
import {
  ceilPlanes,
  ceilAt,
  ceilPlaneAt,
  peakPoint,
  lowCorner,
  peakZ,
  isPitched,
} from "../src/model/ceiling";
import type { Room } from "../src/model/types";

// Base room: 4 m wide (X), 6 m deep (Y), 2.4 m walls, 3.6 m peak => rise s = 1.2 m.
const W = 4;
const D = 6;
const H = 2.4;
const P = 3.6;

function room(over: Partial<Room> = {}): Room {
  return { w: W, d: D, h: H, ceiling: "flat", peak: P, low: "y0", ridge: "x", ...over } as Room;
}

const at = (r: Room, x: number, y: number) => ceilAt(ceilPlanes(r), x, y);

describe("flat ceiling", () => {
  const r = room();

  it("is not pitched and peakZ is the wall height", () => {
    expect(isPitched(r)).toBe(false);
    expect(peakZ(r)).toBeCloseTo(H);
  });

  it("is a single horizontal plane at wall height", () => {
    const planes = ceilPlanes(r);
    expect(planes).toHaveLength(1);
    expect(planes[0]).toEqual({ a: 0, b: 0, c: H });
  });

  it("is wall height everywhere, ignoring peak", () => {
    for (const [x, y] of [[0, 0], [W, D], [W / 2, D / 2], [1, 5]]) {
      expect(at(r, x, y)).toBeCloseTo(H);
    }
  });

  it("lowCorner is the first corner [w, 0] since all corners tie", () => {
    expect(lowCorner(r)).toEqual([W, 0]);
  });
});

describe("single pitch", () => {
  // slope = s / span: along Y 1.2/6 = 0.2 per m, along X 1.2/4 = 0.3 per m

  it("low y0: wall height at y=0, peak at y=d, midpoint halfway", () => {
    const r = room({ ceiling: "single", low: "y0" });
    expect(at(r, 1, 0)).toBeCloseTo(H); // 2.4
    expect(at(r, 3, D)).toBeCloseTo(P); // 2.4 + 0.2*6 = 3.6
    expect(at(r, 2, D / 2)).toBeCloseTo(3.0); // 2.4 + 0.2*3
    expect(at(r, 0, 1.5)).toBeCloseTo(2.7); // 2.4 + 0.2*1.5, independent of x
  });

  it("low yD: wall height at y=d, peak at y=0, midpoint halfway", () => {
    const r = room({ ceiling: "single", low: "yD" });
    expect(at(r, 1, D)).toBeCloseTo(H);
    expect(at(r, 3, 0)).toBeCloseTo(P);
    expect(at(r, 2, D / 2)).toBeCloseTo(3.0);
    expect(at(r, 4, 4.5)).toBeCloseTo(2.7); // 3.6 - 0.2*4.5
  });

  it("low x0: wall height at x=0, peak at x=w, midpoint halfway", () => {
    const r = room({ ceiling: "single", low: "x0" });
    expect(at(r, 0, 2)).toBeCloseTo(H);
    expect(at(r, W, 5)).toBeCloseTo(P); // 2.4 + 0.3*4
    expect(at(r, W / 2, 1)).toBeCloseTo(3.0); // 2.4 + 0.3*2
    expect(at(r, 1, 0)).toBeCloseTo(2.7); // 2.4 + 0.3*1, independent of y
  });

  it("low xW: wall height at x=w, peak at x=0, midpoint halfway", () => {
    const r = room({ ceiling: "single", low: "xW" });
    expect(at(r, W, 2)).toBeCloseTo(H);
    expect(at(r, 0, 5)).toBeCloseTo(P);
    expect(at(r, W / 2, 1)).toBeCloseTo(3.0);
    expect(at(r, 3, D)).toBeCloseTo(2.7); // 3.6 - 0.3*3
  });

  it("produces exactly one plane with the expected coefficients", () => {
    const y0 = ceilPlanes(room({ ceiling: "single", low: "y0" }));
    expect(y0).toHaveLength(1);
    expect(y0[0].a).toBeCloseTo(0);
    expect(y0[0].b).toBeCloseTo(0.2); // 1.2 / 6
    expect(y0[0].c).toBeCloseTo(H);
    const xW = ceilPlanes(room({ ceiling: "single", low: "xW" }));
    expect(xW).toHaveLength(1);
    expect(xW[0].a).toBeCloseTo(-0.3); // -1.2 / 4
    expect(xW[0].b).toBeCloseTo(0);
    expect(xW[0].c).toBeCloseTo(P);
  });

  it("is pitched and peakZ is the peak", () => {
    const r = room({ ceiling: "single" });
    expect(isPitched(r)).toBe(true);
    expect(peakZ(r)).toBeCloseTo(P);
  });

  it("peakPoint is the middle of the high wall", () => {
    expect(peakPoint(room({ ceiling: "single", low: "y0" }))).toEqual([W / 2, D, P]);
    expect(peakPoint(room({ ceiling: "single", low: "yD" }))).toEqual([W / 2, 0, P]);
    expect(peakPoint(room({ ceiling: "single", low: "x0" }))).toEqual([W, D / 2, P]);
    expect(peakPoint(room({ ceiling: "single", low: "xW" }))).toEqual([0, D / 2, P]);
  });

  it("peakPoint returns a fresh array each call", () => {
    const r = room({ ceiling: "single", low: "y0" });
    const a = peakPoint(r);
    a[0] = 99;
    expect(peakPoint(r)[0]).toBe(W / 2);
  });

  it("lowCorner is a corner on the low wall (first of [w,0],[0,0],[w,d],[0,d] on ties)", () => {
    expect(lowCorner(room({ ceiling: "single", low: "y0" }))).toEqual([W, 0]);
    expect(lowCorner(room({ ceiling: "single", low: "yD" }))).toEqual([W, D]);
    expect(lowCorner(room({ ceiling: "single", low: "x0" }))).toEqual([0, 0]);
    expect(lowCorner(room({ ceiling: "single", low: "xW" }))).toEqual([W, 0]);
  });

  it("lowCorner is always at wall height", () => {
    for (const low of ["y0", "yD", "x0", "xW"] as const) {
      const r = room({ ceiling: "single", low });
      const [x, y] = lowCorner(r);
      expect(at(r, x, y)).toBeCloseTo(H);
    }
  });
});

describe("double pitch", () => {
  it("ridge x: wall height at both eaves (y=0, y=d), peak along y=d/2", () => {
    const r = room({ ceiling: "double", ridge: "x" });
    expect(ceilPlanes(r)).toHaveLength(2);
    expect(at(r, 1, 0)).toBeCloseTo(H);
    expect(at(r, 3, D)).toBeCloseTo(H);
    for (const x of [0, 1, W / 2, W]) expect(at(r, x, D / 2)).toBeCloseTo(P);
  });

  it("ridge x: quarter points are halfway up", () => {
    // slope 2s/d = 2.4/6 = 0.4 per m; y = 1.5 => 2.4 + 0.6 = 3.0; y = 4.5 => 4.8 - 0.4*4.5 = 3.0
    const r = room({ ceiling: "double", ridge: "x" });
    expect(at(r, 2, D / 4)).toBeCloseTo(3.0);
    expect(at(r, 2, (3 * D) / 4)).toBeCloseTo(3.0);
  });

  it("ridge y: wall height at both eaves (x=0, x=w), peak along x=w/2", () => {
    const r = room({ ceiling: "double", ridge: "y" });
    expect(ceilPlanes(r)).toHaveLength(2);
    expect(at(r, 0, 1)).toBeCloseTo(H);
    expect(at(r, W, 5)).toBeCloseTo(H);
    for (const y of [0, 2, D / 2, D]) expect(at(r, W / 2, y)).toBeCloseTo(P);
  });

  it("ridge y: quarter points are halfway up", () => {
    // slope 2s/w = 2.4/4 = 0.6 per m; x = 1 => 2.4 + 0.6 = 3.0; x = 3 => 4.8 - 0.6*3 = 3.0
    const r = room({ ceiling: "double", ridge: "y" });
    expect(at(r, W / 4, 3)).toBeCloseTo(3.0);
    expect(at(r, (3 * W) / 4, 3)).toBeCloseTo(3.0);
  });

  it("is symmetric about the ridge", () => {
    const rx = room({ ceiling: "double", ridge: "x" });
    expect(at(rx, 1, 0.7)).toBeCloseTo(at(rx, 1, D - 0.7));
    const ry = room({ ceiling: "double", ridge: "y" });
    expect(at(ry, 0.3, 2)).toBeCloseTo(at(ry, W - 0.3, 2));
  });

  it("peakPoint is the middle of the ridge for both axes", () => {
    expect(peakPoint(room({ ceiling: "double", ridge: "x" }))).toEqual([W / 2, D / 2, P]);
    expect(peakPoint(room({ ceiling: "double", ridge: "y" }))).toEqual([W / 2, D / 2, P]);
  });

  it("lowCorner is the first corner [w, 0] since all four sit at wall height", () => {
    expect(lowCorner(room({ ceiling: "double", ridge: "x" }))).toEqual([W, 0]);
    expect(lowCorner(room({ ceiling: "double", ridge: "y" }))).toEqual([W, 0]);
  });
});

describe("peak below wall height is treated as flat", () => {
  it("single pitch with peak < h is wall height everywhere", () => {
    const r = room({ ceiling: "single", low: "x0", peak: 2.0 });
    expect(peakZ(r)).toBeCloseTo(H); // max(2.0, 2.4)
    expect(at(r, 0, 0)).toBeCloseTo(H);
    expect(at(r, W, D)).toBeCloseTo(H);
    expect(at(r, W / 2, D / 2)).toBeCloseTo(H);
  });

  it("double pitch with peak < h is wall height everywhere", () => {
    const r = room({ ceiling: "double", ridge: "y", peak: 1.0 });
    expect(at(r, W / 2, D / 2)).toBeCloseTo(H);
    expect(at(r, 0, 0)).toBeCloseTo(H);
    expect(at(r, W / 4, 1)).toBeCloseTo(H);
  });

  it("peakPoint z is clamped to wall height", () => {
    expect(peakPoint(room({ ceiling: "single", low: "yD", peak: 1.5 }))[2]).toBeCloseTo(H);
    expect(peakPoint(room({ ceiling: "double", peak: 1.5 }))[2]).toBeCloseTo(H);
  });

  it("peak equal to h is flat too", () => {
    const r = room({ ceiling: "single", low: "y0", peak: H });
    expect(at(r, 2, D)).toBeCloseTo(H);
  });
});

describe("ceilPlaneAt", () => {
  it("picks the lower plane on each side of an x ridge", () => {
    const planes = ceilPlanes(room({ ceiling: "double", ridge: "x" }));
    // planes[0] rises from y=0, planes[1] falls toward y=d
    expect(ceilPlaneAt(planes, 2, 1)).toBe(planes[0]);
    expect(ceilPlaneAt(planes, 2, 5)).toBe(planes[1]);
  });

  it("picks the lower plane on each side of a y ridge", () => {
    const planes = ceilPlanes(room({ ceiling: "double", ridge: "y" }));
    expect(ceilPlaneAt(planes, 0.5, 3)).toBe(planes[0]);
    expect(ceilPlaneAt(planes, 3.5, 3)).toBe(planes[1]);
  });

  it("its plane evaluates to ceilAt", () => {
    const planes = ceilPlanes(room({ ceiling: "double", ridge: "x" }));
    for (const [x, y] of [[1, 1], [3, 4.2], [0, 5.9]]) {
      const q = ceilPlaneAt(planes, x, y);
      expect(q.a * x + q.b * y + q.c).toBeCloseTo(ceilAt(planes, x, y));
    }
  });

  it("returns the only plane for flat and single", () => {
    const flat = ceilPlanes(room());
    expect(ceilPlaneAt(flat, 1, 1)).toBe(flat[0]);
    const single = ceilPlanes(room({ ceiling: "single", low: "yD" }));
    expect(ceilPlaneAt(single, 3, 2)).toBe(single[0]);
  });

  it("works with hand-built planes", () => {
    const planes = [{ a: 0, b: 0, c: 5 }, { a: 1, b: 0, c: 0 }];
    expect(ceilPlaneAt(planes, 2, 0)).toBe(planes[1]); // 2 < 5
    expect(ceilPlaneAt(planes, 7, 0)).toBe(planes[0]); // 7 > 5
    expect(ceilAt(planes, 7, 0)).toBe(5);
  });
});
