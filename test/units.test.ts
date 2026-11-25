import { describe, it, expect } from "vitest";
import { fmtFtIn, fmtLen, fieldLen, parseLen, M_PER_FT, M_PER_IN } from "../src/model/units";
import { round, fmt, wrapDeg, clamp, pick, num, nextId } from "../src/model/math";

describe("fmtFtIn", () => {
  it("formats whole feet and inches", () => {
    // 5.25 ft = 63 in = 5' 3"
    expect(fmtFtIn(5.25 * M_PER_FT)).toBe(`5' 3"`);
  });
  it("formats zero", () => {
    expect(fmtFtIn(0)).toBe(`0' 0"`);
  });
  it("rounds to the nearest half inch", () => {
    // 63.3 in -> 126.6 half-inches -> 127 -> 63.5 in = 5' 3.5"
    expect(fmtFtIn(63.3 * M_PER_IN)).toBe(`5' 3.5"`);
    // 63.2 in -> 126.4 -> 126 -> 63 in
    expect(fmtFtIn(63.2 * M_PER_IN)).toBe(`5' 3"`);
  });
  it("rolls 11.75 in up to the next foot", () => {
    // 11.75 in -> 23.5 half-inches -> rounds to 24 -> 12 in = 1' 0"
    expect(fmtFtIn(11.75 * M_PER_IN)).toBe(`1' 0"`);
    // 5' 11.8" -> 71.8 in -> 143.6 -> 144 -> 72 in = 6' 0"
    expect(fmtFtIn(71.8 * M_PER_IN)).toBe(`6' 0"`);
  });
  it("prefixes negatives with a minus", () => {
    expect(fmtFtIn(-2 * M_PER_FT)).toBe(`-2' 0"`);
  });
  it("drops the minus when a tiny negative rounds to zero", () => {
    // -0.1 in -> 0 half-inches
    expect(fmtFtIn(-0.1 * M_PER_IN)).toBe(`0' 0"`);
  });
});

describe("fmtLen / fieldLen", () => {
  it("fmtLen imperial uses ft/in", () => {
    expect(fmtLen(3 * M_PER_FT, "ftin")).toBe(`3' 0"`);
  });
  it("fmtLen metric uses fixed decimals plus unit", () => {
    expect(fmtLen(1.2345, "m")).toBe("1.23 m");
    expect(fmtLen(1.2346, "m", 3)).toBe("1.235 m");
    expect(fmtLen(2, "m")).toBe("2.00 m");
  });
  it("fmtLen metric avoids -0.00", () => {
    expect(fmtLen(-0.001, "m")).toBe("0.00 m");
  });
  it("fieldLen imperial matches fmtFtIn", () => {
    expect(fieldLen(5.25 * M_PER_FT, "ftin")).toBe(`5' 3"`);
  });
  it("fieldLen metric has no suffix and trims trailing zeros", () => {
    expect(fieldLen(2, "m")).toBe("2");
    expect(fieldLen(1.5, "m")).toBe("1.5");
    // 1.23456 -> toFixed(2) "1.23" -> Number -> "1.23"
    expect(fieldLen(1.23456, "m")).toBe("1.23");
    expect(fieldLen(1.23456, "m", 3)).toBe("1.235");
  });
});

describe("parseLen imperial", () => {
  const in63 = 63 * M_PER_IN; // 5' 3" = 63 in = 1.6002 m
  const forms = [`5' 3"`, `5'3`, `5'3"`, `5 ft 3 in`, `5ft 3in`, `5 feet 3 inches`, `5 3`, `5 3"`, `63"`, `63in`, `63 in`, `  5' 3"  `];
  for (const f of forms) {
    it(`reads ${JSON.stringify(f)} as 63 in`, () => {
      expect(parseLen(f, "ftin")).toBeCloseTo(in63, 9);
    });
  }
  it("reads curly quotes", () => {
    // ’ / ” and prime ′ / ″ map to ' and "
    expect(parseLen("5’ 3”", "ftin")).toBeCloseTo(in63, 9);
    expect(parseLen("5′ 3″", "ftin")).toBeCloseTo(in63, 9);
  });
  it("reads feet only with a mark", () => {
    // 5' = 60 in
    expect(parseLen(`5'`, "ftin")).toBeCloseTo(60 * M_PER_IN, 9);
    expect(parseLen(`5 ft`, "ftin")).toBeCloseTo(60 * M_PER_IN, 9);
  });
  it("reads a plain number as feet", () => {
    // 5.25 ft * 0.3048 = 1.6002 m
    expect(parseLen("5.25", "ftin")).toBeCloseTo(1.6002, 9);
    expect(parseLen(".5", "ftin")).toBeCloseTo(0.1524, 9);
  });
  it("reads fractional inches", () => {
    // 5' 3.5" = 63.5 in
    expect(parseLen(`5' 3.5"`, "ftin")).toBeCloseTo(63.5 * M_PER_IN, 9);
  });
  it("rejects junk", () => {
    for (const junk of ["", "abc", "5x", "5' 3' ", "-5", "5 3 2", `"5`, "5..3", "ft"]) {
      expect(parseLen(junk, "ftin"), junk).toBeNaN();
    }
  });
  it("round-trips through fmtFtIn", () => {
    const m = 7.5 * M_PER_FT; // 90 in = 7' 6"
    expect(parseLen(fmtFtIn(m), "ftin")).toBeCloseTo(m, 9);
  });
});

describe("parseLen metric", () => {
  it("parses plain numbers as meters", () => {
    expect(parseLen("2.5", "m")).toBe(2.5);
    expect(parseLen("  1.25 ", "m")).toBe(1.25);
    expect(parseLen("-0.5", "m")).toBe(-0.5);
  });
  it("returns NaN for junk", () => {
    expect(parseLen("abc", "m")).toBeNaN();
    expect(parseLen("", "m")).toBeNaN();
  });
});

describe("math helpers", () => {
  it("round", () => {
    expect(round(1.23456, 3)).toBe(1.235);
    expect(round(2.5, 0)).toBe(3);
    expect(round(-1.005, 1)).toBe(-1);
  });
  it("fmt fixes decimals and avoids -0", () => {
    expect(fmt(1.5)).toBe("1.50");
    expect(fmt(1.2345, 1)).toBe("1.2");
    expect(fmt(-0.004)).toBe("0.00"); // |v| < 0.005
    expect(fmt(-0.006)).toBe("-0.01");
  });
  it("wrapDeg wraps into [-180, 180)", () => {
    expect(wrapDeg(0)).toBe(0);
    expect(wrapDeg(190)).toBe(-170); // 190 - 360
    expect(wrapDeg(-190)).toBe(170); // -190 + 360
    expect(wrapDeg(180)).toBe(-180);
    expect(wrapDeg(-180)).toBe(-180);
    expect(wrapDeg(720 + 45)).toBe(45);
    expect(wrapDeg(-540)).toBe(-180);
  });
  it("clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
  it("pick returns allowed values or the fallback", () => {
    const allowed = ["m", "ftin"] as const;
    expect(pick("ftin", allowed, "m")).toBe("ftin");
    expect(pick("yards", allowed, "m")).toBe("m");
    expect(pick(3, allowed, "m")).toBe("m");
    expect(pick(undefined, allowed, "ftin")).toBe("ftin");
  });
  it("num accepts only finite numbers", () => {
    expect(num(3.5, 0)).toBe(3.5);
    expect(num(0, 9)).toBe(0);
    expect(num("3", 9)).toBe(9);
    expect(num(NaN, 9)).toBe(9);
    expect(num(Infinity, 9)).toBe(9);
    expect(num(null, 9)).toBe(9);
  });
  it("nextId is max id + 1", () => {
    expect(nextId([])).toBe(1);
    expect(nextId([{ id: 3 }, { id: 7 }, { id: 2 }])).toBe(8);
  });
});
