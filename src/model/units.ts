import { fmt } from "./math";
import type { Units } from "./types";

export const M_PER_FT = 0.3048;
export const M_PER_IN = 0.0254;

/** 5.25 ft -> 5' 3" (rounded to the nearest half inch). */
export function fmtFtIn(m: number): string {
  const totalIn = Math.round((Math.abs(m) / M_PER_IN) * 2) / 2;
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  return (m < 0 && totalIn > 0 ? "-" : "") + ft + "' " + (inch % 1 ? inch.toFixed(1) : inch) + '"';
}

/** A length for display, with its unit. */
export const fmtLen = (m: number, units: Units, d = 2): string => (units === "ftin" ? fmtFtIn(m) : fmt(m, d) + " m");

/** A length for an input field: metric fields show the unit beside the box, so no suffix. */
export const fieldLen = (m: number, units: Units, d = 2): string =>
  units === "ftin" ? fmtFtIn(m) : String(Number(m.toFixed(d)));

/**
 * Parse a typed length into meters (NaN if it can't be read).
 * Metric: a plain number. Imperial accepts 5' 3", 5'3, 5 ft 3 in, 5 3, 63", 63in, 5.25 (plain number = feet).
 */
export function parseLen(raw: string, units: Units): number {
  let str = String(raw).trim();
  if (units !== "ftin") return parseFloat(str);
  str = str
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/\s*(feet|foot|ft)\b\.?/gi, "'")
    .replace(/\s*(inches|inch|in)\b\.?/gi, '"')
    .trim();
  const n = "(\\d*\\.?\\d+)";
  let m: RegExpMatchArray | null;
  if ((m = str.match(new RegExp("^" + n + "\\s*'\\s*(?:" + n + '\\s*"?)?$'))))
    return (parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0)) * M_PER_IN;
  if ((m = str.match(new RegExp("^" + n + '\\s*"$')))) return parseFloat(m[1]) * M_PER_IN;
  if ((m = str.match(new RegExp("^" + n + "\\s+" + n + '"?$')))) return (parseFloat(m[1]) * 12 + parseFloat(m[2])) * M_PER_IN;
  if ((m = str.match(new RegExp("^" + n + "$")))) return parseFloat(m[1]) * M_PER_FT;
  return NaN;
}

export const gridSteps = (units: Units) => (units === "ftin" ? { minor: M_PER_FT, major: 5 * M_PER_FT } : { minor: 0.5, major: 1 });
export const ringStep = (units: Units) => (units === "ftin" ? 3 * M_PER_FT : 1);
export const snapStep = (units: Units) => (units === "ftin" ? M_PER_IN : 0.05);
