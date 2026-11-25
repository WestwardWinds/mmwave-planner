import { describe, it, expect } from "vitest";
import { sensorBasis, localCoords, aimAngles, anglesFromDirection } from "../src/model/radar";
import { classifyFor, classifyAll, formatReason } from "../src/model/classify";
import type { Obstacle, Sensor, Vec3 } from "../src/model/types";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const expectVec = (a: Vec3, b: Vec3, d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

function sensor(over: Partial<Sensor> = {}): Sensor {
  return { id: 1, name: "S1", color: 1, x: 0, y: 0, z: 0, pan: 0, tilt: 0, roll: 0, hfov: 120, vfov: 60, range: 6, ...over };
}
function box(over: Partial<Obstacle> = {}): Obstacle {
  return { id: 1, name: "Sofa", x: 0, y: 0, z: 0, w: 1, d: 1, h: 1, rot: 0, ...over };
}

describe("sensorBasis", () => {
  const cases: [number, number, number][] = [
    [0, 0, 0], [90, 0, 0], [30, -20, 0], [-135, 45, 15], [200, -90, 0], [10, 89, 90], [-60, -35, -170],
  ];
  for (const [pan, tilt, roll] of cases) {
    it(`is orthonormal and right-handed (r x f = u) for pan ${pan} tilt ${tilt} roll ${roll}`, () => {
      const { f, r, u } = sensorBasis({ pan, tilt, roll });
      expect(dot(f, f)).toBeCloseTo(1, 12);
      expect(dot(r, r)).toBeCloseTo(1, 12);
      expect(dot(u, u)).toBeCloseTo(1, 12);
      expect(dot(f, r)).toBeCloseTo(0, 12);
      expect(dot(f, u)).toBeCloseTo(0, 12);
      expect(dot(r, u)).toBeCloseTo(0, 12);
      expectVec(cross(r, f), u, 12);
    });
  }

  it("pan 0 faces +Y with right = +X, up = +Z", () => {
    const b = sensorBasis({ pan: 0, tilt: 0, roll: 0 });
    expectVec(b.f, [0, 1, 0]);
    expectVec(b.r, [1, 0, 0]);
    expectVec(b.u, [0, 0, 1]);
  });

  it("pan 90 faces +X with right = -Y", () => {
    const b = sensorBasis({ pan: 90, tilt: 0, roll: 0 });
    expectVec(b.f, [1, 0, 0]);
    expectVec(b.r, [0, -1, 0]);
  });

  it("tilt -90 faces straight down; up then points along the old facing (+Y for pan 0)", () => {
    const b = sensorBasis({ pan: 0, tilt: -90, roll: 0 });
    expectVec(b.f, [0, 0, -1]);
    expectVec(b.u, [0, 1, 0]);
  });
});

describe("localCoords", () => {
  const s = sensor({ x: 1, y: 1, z: 1 });
  const b = sensorBasis(s);

  it("a point straight ahead has az 0, el 0 and its distance as range", () => {
    const c = localCoords(b, s, 1, 4, 1); // 3 m along +Y
    expect(c.range).toBeCloseTo(3);
    expect(c.az).toBeCloseTo(0);
    expect(c.el).toBeCloseTo(0);
  });

  it("a point ahead-right is at +az", () => {
    const c = localCoords(b, s, 2, 2, 1); // (1,1,0): atan2(1,1) = 45, range sqrt 2
    expect(c.az).toBeCloseTo(45);
    expect(c.el).toBeCloseTo(0);
    expect(c.range).toBeCloseTo(Math.SQRT2);
  });

  it("a point ahead-up is at +el", () => {
    const c = localCoords(b, s, 1, 2, 2); // (0,1,1): asin(1/sqrt2) = 45
    expect(c.az).toBeCloseTo(0);
    expect(c.el).toBeCloseTo(45);
  });

  it("a point behind is at |az| 180", () => {
    const c = localCoords(b, s, 1, -1, 1); // (0,-2,0): atan2(0,-2) = 180
    expect(Math.abs(c.az)).toBeCloseTo(180);
    expect(c.range).toBeCloseTo(2);
  });

  it("the sensor's own position returns zeros", () => {
    expect(localCoords(b, s, 1, 1, 1)).toEqual({ range: 0, az: 0, el: 0 });
  });

  it("roll 90 swaps az and el roles", () => {
    // roll 90: r = old up (+Z), u = -old right (-X)
    const rb = sensorBasis({ pan: 0, tilt: 0, roll: 90 });
    const up = localCoords(rb, s, 1, 2, 2); // (0,1,1) -> lx = 1, lz = 0
    expect(up.az).toBeCloseTo(45);
    expect(up.el).toBeCloseTo(0);
    const right = localCoords(rb, s, 2, 2, 1); // (1,1,0) -> lx = 0, lz = -1
    expect(right.az).toBeCloseTo(0);
    expect(right.el).toBeCloseTo(-45);
  });

  it("reproduces the reference example azimuths", () => {
    // sensor (2.5,0.02,2.0) pan 0 tilt -20: r = (1,0,0), f = (0, cos20, -sin20)
    const rs = sensor({ x: 2.5, y: 0.02, z: 2.0, tilt: -20 });
    const rb = sensorBasis(rs);
    // (4.6,0.5,1.0): d = (2.1,0.48,-1); ly = 0.48*0.9397 + 0.342 = 0.793; atan2(2.1, 0.793) = 69.3
    expect(localCoords(rb, rs, 4.6, 0.5, 1.0).az).toBeCloseTo(69.3, 1);
    // (1.2,3.2,0.9): d = (-1.3,3.18,-1.1); ly = 2.988 + 0.376 = 3.364; atan2(-1.3, 3.364) = -21.1
    expect(localCoords(rb, rs, 1.2, 3.2, 0.9).az).toBeCloseTo(-21.1, 1);
  });
});

describe("aimAngles / anglesFromDirection", () => {
  it("aims at a point ahead-right and below", () => {
    // d = (1,1,-sqrt2): pan atan2(1,1) = 45, tilt atan2(-sqrt2, sqrt2) = -45
    const a = aimAngles(sensor({ z: 2 }), 1, 1, 2 - Math.SQRT2)!;
    expect(a.pan).toBeCloseTo(45);
    expect(a.tilt).toBeCloseTo(-45);
  });

  it("keeps pan when the target is straight below", () => {
    const a = aimAngles(sensor({ x: 1, y: 1, z: 2, pan: 37 }), 1, 1, 0)!;
    expect(a.pan).toBe(37);
    expect(a.tilt).toBeCloseTo(-90);
  });

  it("returns null when the target is the sensor itself", () => {
    expect(aimAngles(sensor({ x: 1, y: 2, z: 3 }), 1, 2, 3)).toBeNull();
  });

  it("anglesFromDirection works on a non-unit direction", () => {
    // (-2,0,2): pan atan2(-2,0) = -90, tilt asin(2/sqrt8) = 45
    const a = anglesFromDirection([-2, 0, 2], 0);
    expect(a.pan).toBeCloseTo(-90);
    expect(a.tilt).toBeCloseTo(45);
  });

  it("anglesFromDirection straight down keeps the fallback pan", () => {
    const a = anglesFromDirection([0, 0, -3], 123);
    expect(a.pan).toBe(123);
    expect(a.tilt).toBeCloseTo(-90);
  });

  it("anglesFromDirection inverts sensorBasis forward", () => {
    const f = sensorBasis({ pan: -40, tilt: 25, roll: 70 }).f;
    const a = anglesFromDirection(f, 0);
    expect(a.pan).toBeCloseTo(-40);
    expect(a.tilt).toBeCloseTo(25);
  });
});

describe("classifyFor", () => {
  const s = sensor({ hfov: 90, vfov: 60, range: 6 });

  it("a point straight ahead in range is inside with no reasons", () => {
    const r = classifyFor(s, [], 0, 3, 0);
    expect(r.inCone).toBe(true);
    expect(r.inside).toBe(true);
    expect(r.blocked).toBeNull();
    expect(r.reasons).toEqual([]);
  });

  it("reports range overshoot", () => {
    const r = classifyFor(s, [], 0, 7.5, 0); // 7.5 - 6 = 1.5
    expect(r.inCone).toBe(false);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe("range");
    expect((r.reasons[0] as { by: number }).by).toBeCloseTo(1.5);
  });

  it("is inclusive at exactly max range", () => {
    expect(classifyFor(s, [], 0, 6, 0).inside).toBe(true);
  });

  it("is inclusive at exactly HFOV/2", () => {
    // (1,1,0): az = 45 = 90/2
    const r = classifyFor(s, [], 1, 1, 0);
    expect(r.az).toBeCloseTo(45);
    expect(r.inside).toBe(true);
  });

  it("reports hfov miss to the side, not behind", () => {
    // (sqrt3,1,0): az = 60, by = 60 - 45 = 15
    const r = classifyFor(s, [], Math.sqrt(3), 1, 0);
    expect(r.reasons).toHaveLength(1);
    const h = r.reasons[0] as { kind: string; by: number; behind: boolean };
    expect(h.kind).toBe("hfov");
    expect(h.by).toBeCloseTo(15);
    expect(h.behind).toBe(false);
  });

  it("flags a hfov miss behind the sensor", () => {
    // (1,-1,0): az = 135, by = 90
    const h = classifyFor(s, [], 1, -1, 0).reasons[0] as { kind: string; by: number; behind: boolean };
    expect(h.kind).toBe("hfov");
    expect(h.by).toBeCloseTo(90);
    expect(h.behind).toBe(true);
  });

  it("reports vfov above and below", () => {
    // (0,1,sqrt3): el = 60, by = 30 ; (0,1,-sqrt3): el = -60
    const above = classifyFor(s, [], 0, 1, Math.sqrt(3)).reasons[0] as { kind: string; by: number; above: boolean };
    expect(above).toMatchObject({ kind: "vfov", above: true });
    expect(above.by).toBeCloseTo(30);
    const below = classifyFor(s, [], 0, 1, -Math.sqrt(3)).reasons[0] as { kind: string; above: boolean };
    expect(below).toMatchObject({ kind: "vfov", above: false });
  });

  it("collects several reasons at once", () => {
    // (0,-10,0): range 10 > 6 and az 180
    const kinds = classifyFor(s, [], 0, -10, 0).reasons.map((r) => r.kind);
    expect(kinds).toEqual(["range", "hfov"]);
  });

  it("reports a box in the line of sight as blocked", () => {
    const wall = box({ name: "Wall", x: 0, y: 2, z: -1, w: 2, d: 0.2, h: 2 });
    const r = classifyFor(s, [wall], 0, 4, 0);
    expect(r.inCone).toBe(true);
    expect(r.inside).toBe(false);
    expect(r.blocked).toBe(wall);
    expect(r.reasons).toEqual([{ kind: "blocked", by: "Wall" }]);
  });

  it("reports a point inside a box as inside it, with a fallback name", () => {
    const cab = box({ name: "", x: 0, y: 3, z: -0.5, w: 1, d: 1, h: 1 });
    const r = classifyFor(s, [cab], 0, 3, 0);
    expect(r.blocked).toBe(cab);
    expect(r.reasons).toEqual([{ kind: "inside", of: "an obstacle" }]);
  });

  it("does not test obstacles when the point is outside the cone", () => {
    const wall = box({ x: 0, y: -2, z: -1, w: 2, d: 0.2, h: 2 });
    const r = classifyFor(s, [wall], 0, -4, 0);
    expect(r.blocked).toBeNull();
    expect(r.reasons.map((x) => x.kind)).toEqual(["hfov"]);
  });

  it("reference example: (4.6,0.5,1.0) outside HFOV, (1.2,3.2,0.9) inside", () => {
    const rs = sensor({ x: 2.5, y: 0.02, z: 2.0, tilt: -20, hfov: 120, vfov: 60, range: 6 });
    const out = classifyFor(rs, [], 4.6, 0.5, 1.0);
    expect(out.inside).toBe(false);
    expect(out.reasons[0].kind).toBe("hfov"); // 69.3 > 60
    const ok = classifyFor(rs, [], 1.2, 3.2, 0.9);
    expect(ok.inside).toBe(true);
  });
});

describe("classifyAll", () => {
  const a = sensor({ id: 1, name: "A", hfov: 90 }); // at origin facing +Y
  const b = sensor({ id: 2, name: "B", x: 4, y: 4, pan: -90, hfov: 90 }); // facing -X

  it("seenBy lists every sensor that detects the point", () => {
    const r = classifyAll([a, b], [], { x: 1, y: 4, z: 0 });
    expect(r.seenBy.map((s) => s.name)).toEqual(["A", "B"]);
    expect(r.inside).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.per).toHaveLength(2);
  });

  it("a point seen by one sensor and blocked for the other is inside, not blocked", () => {
    // box between B (4,4) and the point (1,4), off A's line (0,0)->(1,4)
    const wall = box({ name: "Wall", x: 2.5, y: 4, z: -1, w: 0.2, d: 1, h: 2 });
    const r = classifyAll([a, b], [wall], { x: 1, y: 4, z: 0 });
    expect(r.seenBy.map((s) => s.name)).toEqual(["A"]);
    expect(r.per[1].result.blocked).toBe(wall);
    expect(r.inside).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it("a point no sensor sees but one would without the obstacle is blocked", () => {
    // (0,3,0) is straight ahead of A, 3 m away; the wall at y = 1.5 sits on that line
    const wall = box({ name: "Wall", x: 0, y: 1.5, z: -1, w: 1, d: 0.2, h: 2 });
    const r1 = classifyAll([a], [wall], { x: 0, y: 3, z: 0 });
    expect(r1.inside).toBe(false);
    expect(r1.blocked).toBe(true);
    expect(r1.seenBy).toEqual([]);
  });

  it("a point outside every cone is neither inside nor blocked", () => {
    const r = classifyAll([a, b], [], { x: 0, y: -3, z: 0 });
    expect(r.inside).toBe(false);
    expect(r.blocked).toBe(false);
  });
});

describe("formatReason", () => {
  it("range in meters and feet/inches", () => {
    expect(formatReason({ kind: "range", by: 1.5 }, "m")).toBe("1.50 m beyond max distance");
    expect(formatReason({ kind: "range", by: 0.3048 }, "ftin")).toBe("1' 0\" beyond max distance"); // 12 in
  });

  it("hfov with and without the behind note (unit independent)", () => {
    expect(formatReason({ kind: "hfov", by: 9.26, behind: false }, "m")).toBe("9.3° outside horizontal FOV");
    expect(formatReason({ kind: "hfov", by: 90, behind: true }, "ftin")).toBe("90.0° outside horizontal FOV (behind the sensor)");
  });

  it("vfov above / below", () => {
    expect(formatReason({ kind: "vfov", by: 30, above: true }, "m")).toBe("30.0° above vertical FOV");
    expect(formatReason({ kind: "vfov", by: 2.04, above: false }, "ftin")).toBe("2.0° below vertical FOV");
  });

  it("blocked and inside", () => {
    expect(formatReason({ kind: "blocked", by: "Wall" }, "m")).toBe("Line of sight blocked by Wall");
    expect(formatReason({ kind: "inside", of: "Sofa" }, "ftin")).toBe("Inside Sofa");
  });
});
