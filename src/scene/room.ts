import { ArrowHelper, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Vector3 } from "three";
import { ceilAt, ceilPlanes, isPitched } from "../model/ceiling";
import type { Room, Units } from "../model/types";
import { gridSteps } from "../model/units";
import { lineGeom, U2T, V2T, type Theme } from "./helpers";

/** Clipping planes for the room: walls, floor and ceiling plane(s), normals pointing inward. */
export function roomClipPlanes(room: Room): Plane[] {
  const { w, d } = room, e = 0.001;
  const planes = ([[1, 0, 0, e], [-1, 0, 0, w + e], [0, 1, 0, e], [0, 0, -1, e], [0, 0, 1, d + e]] as const).map(
    ([x, y, z, c]) => new Plane(new Vector3(x, y, z), c)
  );
  // user ceiling z <= a*x + b*y + c  ->  three.js: a*X - Y - b*Z + c >= 0
  for (const q of ceilPlanes(room)) planes.push(new Plane(new Vector3(q.a, -1, -q.b), q.c + e).normalize());
  return planes;
}

/** Floor, grid, the room outline following the ceiling, a faint roof for pitched ceilings, and axis arrows. */
export class RoomView {
  readonly group = new Group();
  private mats = {
    floor: new MeshBasicMaterial({ side: DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
    grid: new LineBasicMaterial({ transparent: true, opacity: 0.9 }),
    major: new LineBasicMaterial({ transparent: true, opacity: 0.9 }),
    edge: new LineBasicMaterial(),
    roof: new MeshBasicMaterial({ side: DoubleSide, transparent: true, opacity: 0.07, depthWrite: false })
  };
  private axes: { arrow: ArrowHelper; key: "ax-x" | "ax-y" | "ax-z" }[] = [];
  private theme: Theme | null = null;

  build(room: Room, units: Units): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if ("geometry" in c) (c as Mesh).geometry.dispose();
      if (c instanceof ArrowHelper) c.dispose();
    }
    this.axes = [];
    const { w, d, h } = room;
    const cp = ceilPlanes(room);
    const cz = (x: number, y: number) => ceilAt(cp, x, y);

    const floor = new Mesh(new PlaneGeometry(w, d), this.mats.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(U2T(w / 2, d / 2, -0.002));
    floor.renderOrder = -2;
    this.group.add(floor);

    const minor: number[] = [], major: number[] = [];
    const gs = gridSteps(units), per = Math.round(gs.major / gs.minor);
    for (let i = 0; i * gs.minor <= w + 1e-6; i++) (i % per === 0 ? major : minor).push(...U2T(i * gs.minor, 0, 0).toArray(), ...U2T(i * gs.minor, d, 0).toArray());
    for (let i = 0; i * gs.minor <= d + 1e-6; i++) (i % per === 0 ? major : minor).push(...U2T(0, i * gs.minor, 0).toArray(), ...U2T(w, i * gs.minor, 0).toArray());
    for (const [arr, mat] of [[minor, this.mats.grid], [major, this.mats.major]] as const) {
      const l = new LineSegments(lineGeom(arr), mat);
      l.renderOrder = -1;
      this.group.add(l);
    }

    // outline: floor, corner posts, each wall's top edge following the ceiling (its midpoint catches a gable peak)
    const E: number[] = [];
    const seg = (a: number[], b: number[]) => E.push(...U2T(a[0], a[1], a[2]).toArray(), ...U2T(b[0], b[1], b[2]).toArray());
    const C = [[0, 0], [w, 0], [w, d], [0, d]];
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = C[i], [x2, y2] = C[(i + 1) % 4], xm = (x1 + x2) / 2, ym = (y1 + y2) / 2;
      seg([x1, y1, 0], [x2, y2, 0]);
      seg([x1, y1, 0], [x1, y1, cz(x1, y1)]);
      seg([x1, y1, cz(x1, y1)], [xm, ym, cz(xm, ym)]);
      seg([xm, ym, cz(xm, ym)], [x2, y2, cz(x2, y2)]);
    }
    if (room.ceiling === "double") {
      if (room.ridge === "x") seg([0, d / 2, cz(0, d / 2)], [w, d / 2, cz(w, d / 2)]);
      else seg([w / 2, 0, cz(w / 2, 0)], [w / 2, d, cz(w / 2, d)]);
    }
    this.group.add(new LineSegments(lineGeom(E), this.mats.edge));

    if (isPitched(room)) {
      // a 2x2 grid keeps every quad planar, since a gable ridge sits on the center line
      const xs = [0, w / 2, w], ys = [0, d / 2, d], T: number[] = [];
      const v = (x: number, y: number) => U2T(x, y, cz(x, y)).toArray();
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const a = v(xs[i], ys[j]), b = v(xs[i + 1], ys[j]), c = v(xs[i + 1], ys[j + 1]), e = v(xs[i], ys[j + 1]);
        T.push(...a, ...b, ...c, ...a, ...c, ...e);
      }
      const roof = new Mesh(lineGeom(T), this.mats.roof);
      roof.renderOrder = 3;
      this.group.add(roof);
    }

    const L = Math.min(0.6, Math.min(w, d, h) * 0.3);
    for (const [key, v] of [["ax-x", [1, 0, 0]], ["ax-y", [0, 1, 0]], ["ax-z", [0, 0, 1]]] as const) {
      const arrow = new ArrowHelper(V2T([v[0], v[1], v[2]]).normalize(), U2T(0, 0, 0), L, 0x888888, L * 0.25, L * 0.12);
      this.group.add(arrow);
      this.axes.push({ arrow, key });
    }
    if (this.theme) this.applyTheme(this.theme);
  }

  applyTheme(t: Theme): void {
    this.theme = t;
    this.mats.floor.color.copy(t.floor);
    this.mats.grid.color.copy(t.grid);
    this.mats.major.color.copy(t["grid-major"]);
    this.mats.edge.color.copy(t["room-edge"]);
    this.mats.roof.color.copy(t["room-edge"]);
    for (const a of this.axes) a.arrow.setColor(t[a.key]);
  }

  /** Length of the axis arrows, for placing their X/Y/Z labels. */
  static axisLength(room: Room): number {
    return Math.min(0.6, Math.min(room.w, room.d, room.h) * 0.3);
  }
}
