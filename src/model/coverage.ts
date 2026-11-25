import { ceilAt, ceilPlanes, peakZ } from "./ceiling";
import { clamp, EPS } from "./math";
import { insideBox, prepareOccluders, segmentHits } from "./occlusion";
import { localCoords, sensorBasis } from "./radar";
import type { PlannerState } from "./types";

/** What the sensors make of one floor-plan cell at the slice height. */
export enum Cell {
  /** above a sloped ceiling or inside an obstacle: not room space, left out of the totals */
  NotRoom = 0,
  /** no sensor's cone reaches it */
  None = 1,
  /** in at least one cone, but every view is blocked: a dead spot */
  Blocked = 2,
  /** seen by exactly one sensor (see `who`) */
  One = 3,
  /** seen by two or more sensors (see `count`) */
  Overlap = 4
}

export interface Coverage {
  cols: number;
  rows: number;
  /** slice height actually used (clamped to the room) */
  z: number;
  /** row-major, row 0 at the BACK of the room (y = d), column 0 at x = 0 — the layout of an image */
  kind: Uint8Array;
  /** index into state.sensors of the one sensor that sees a Cell.One cell */
  who: Int16Array;
  /** how many sensors see the cell */
  count: Uint8Array;
  /** percentages of room-space cells */
  coveredPct: number;
  overlapPct: number;
  hiddenPct: number;
}

/** About 220 cells along the longer side, at least 2 cm each. */
export function sliceGrid(w: number, d: number) {
  const cell = Math.max(0.02, Math.max(w, d) / 220);
  return { cols: Math.max(1, Math.ceil(w / cell)), rows: Math.max(1, Math.ceil(d / cell)) };
}

export function computeCoverage(state: PlannerState, height = state.view.sliceH): Coverage {
  const { w, d } = state.room;
  const z = clamp(height, 0, peakZ(state.room));
  const { cols, rows } = sliceGrid(w, d);
  const n = cols * rows;
  const kind = new Uint8Array(n), who = new Int16Array(n).fill(-1), count = new Uint8Array(n);
  const sens = state.sensors.map((s) => ({
    s,
    b: sensorBasis(s),
    occ: prepareOccluders(state.obstacles, s),
    hh: s.hfov / 2 + EPS,
    vh: s.vfov / 2 + EPS,
    R: s.range + EPS
  }));
  const solid = prepareOccluders(state.obstacles, { x: 0, y: 0, z: 0 }); // only toLocal/half are used
  const cp = ceilPlanes(state.room);
  let total = 0, covered = 0, overlap = 0, hidden = 0;
  for (let j = 0; j < rows; j++) {
    const y = d - (j + 0.5) * (d / rows);
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * (w / cols);
      const k = j * cols + i;
      if (z > ceilAt(cp, x, y) + 1e-9 || solid.some((o) => insideBox(o, o.toLocal(x, y, z)))) {
        kind[k] = Cell.NotRoom;
        continue;
      }
      total++;
      let seen = 0, inAny = false, last = -1;
      for (let si = 0; si < sens.length; si++) {
        const S = sens[si];
        const c = localCoords(S.b, S.s, x, y, z);
        if (c.range > S.R || Math.abs(c.az) > S.hh || Math.abs(c.el) > S.vh) continue;
        inAny = true;
        if (!S.occ.some((o) => segmentHits(o, o.toLocal(x, y, z)))) { seen++; last = si; }
      }
      count[k] = seen;
      if (seen >= 2) { kind[k] = Cell.Overlap; covered++; overlap++; }
      else if (seen === 1) { kind[k] = Cell.One; who[k] = last; covered++; }
      else if (inAny) { kind[k] = Cell.Blocked; hidden++; }
      else kind[k] = Cell.None;
    }
  }
  const pct = (v: number) => (total ? (100 * v) / total : 0);
  return { cols, rows, z, kind, who, count, coveredPct: pct(covered), overlapPct: pct(overlap), hiddenPct: pct(hidden) };
}
