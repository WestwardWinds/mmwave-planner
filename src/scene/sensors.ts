import {
  BoxGeometry, BufferGeometry, DoubleSide, Group, Line, LineBasicMaterial, LineDashedMaterial, LineSegments,
  Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, Plane, Scene, SphereGeometry, Vector3
} from "three";
import { D2R } from "../model/math";
import { sensorBasis } from "../model/radar";
import type { Sensor, Units } from "../model/types";
import { ringDistances } from "../model/presets";
import { ringStep } from "../model/units";
import { lineGeom, makeDrop, sensorColor, sensorCss, setDrop, U2T, V2T, type Label, type Theme } from "./helpers";

const bodyGeo = new BoxGeometry(0.1, 0.07, 0.025);
const lensGeo = new BoxGeometry(0.05, 0.03, 0.004);
const lensMat = new MeshBasicMaterial({ color: 0x111111 });
const hitGeo = new SphereGeometry(0.14, 12, 8);
export const hitMat = new MeshBasicMaterial({ visible: false });

interface Rig {
  root: Group;
  cone: Group;
  coneMesh: Mesh;
  edges: LineSegments;
  capGrid: LineSegments;
  rings: LineSegments;
  bore: Line;
  body: Mesh;
  hit: Mesh;
  drop: Line;
  mats: { cone: MeshBasicMaterial; edge: LineBasicMaterial; grid: LineBasicMaterial; ring: LineBasicMaterial; bore: LineDashedMaterial };
  label: Label;
  key: string;
}

// cone geometry is built in the sensor's own frame: x = right, y = up, z = -forward
const dir = (az: number, el: number, rho: number): [number, number, number] =>
  [rho * Math.cos(el) * Math.sin(az), rho * Math.sin(el), -rho * Math.cos(el) * Math.cos(az)];

/** One body + coverage cone per sensor. The cone is exactly the region classifyFor() tests. */
export class SensorViews {
  private rigs = new Map<number, Rig>();
  private _m = new Matrix4();
  constructor(private scene: Scene, private labels: HTMLElement, private dropMat: LineBasicMaterial) {}

  sync(sensors: Sensor[]): void {
    for (const [id, r] of this.rigs) if (!sensors.some((s) => s.id === id)) { this.dispose(r); this.rigs.delete(id); }
    for (const s of sensors) if (!this.rigs.has(s.id)) this.rigs.set(s.id, this.create(s));
  }

  update(sensors: Sensor[], opts: { active: number; selected: number | null; cones: "all" | "active"; rings: boolean; units: Units; clip: Plane[]; theme: Theme }): void {
    for (const s of sensors) {
      const r = this.rigs.get(s.id);
      if (!r) continue;
      this.buildCone(r, s, opts.units);
      const b = sensorBasis(s);
      r.root.position.copy(U2T(s.x, s.y, s.z));
      this._m.makeBasis(V2T(b.r), V2T(b.u), V2T(b.f).negate());
      r.root.quaternion.setFromRotationMatrix(this._m);
      r.rings.visible = opts.rings;
      r.cone.visible = opts.cones === "all" || s.id === opts.active;
      const col = sensorColor(opts.theme, s);
      for (const m of Object.values(r.mats)) {
        m.color.copy(col);
        if (m.clippingPlanes !== opts.clip) { m.clippingPlanes = opts.clip; m.needsUpdate = true; }
      }
      (r.body.material as MeshLambertMaterial).color.copy(col);
      setDrop(r.drop, s);
      r.label.el.textContent = s.name || "Sensor";
      r.label.el.className = "lbl sensor" + (opts.selected === s.id ? " sel" : "") + (opts.active === s.id ? " active" : "");
      r.label.el.style.borderColor = sensorCss(s);
    }
  }

  hitTargets(): Object3D[] {
    return [...this.rigs.values()].map((r) => r.hit);
  }

  labelList(): Label[] {
    return [...this.rigs.values()].map((r) => r.label);
  }

  private create(s: Sensor): Rig {
    const root = new Group();
    const cone = new Group();
    root.add(cone);
    const mats = {
      cone: new MeshBasicMaterial({ transparent: true, opacity: 0.14, side: DoubleSide, depthWrite: false }),
      edge: new LineBasicMaterial({ transparent: true, opacity: 0.9 }),
      grid: new LineBasicMaterial({ transparent: true, opacity: 0.28 }),
      ring: new LineBasicMaterial({ transparent: true, opacity: 0.45 }),
      bore: new LineDashedMaterial({ dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.9 })
    };
    const coneMesh = new Mesh(new BufferGeometry(), mats.cone);
    coneMesh.renderOrder = 2;
    const edges = new LineSegments(new BufferGeometry(), mats.edge);
    const capGrid = new LineSegments(new BufferGeometry(), mats.grid);
    const rings = new LineSegments(new BufferGeometry(), mats.ring);
    const bore = new Line(new BufferGeometry(), mats.bore);
    cone.add(coneMesh, edges, capGrid, rings, bore);
    const body = new Mesh(bodyGeo, new MeshLambertMaterial());
    body.position.z = 0.0125;
    const lens = new Mesh(lensGeo, lensMat);
    lens.position.z = -0.002;
    const hit = new Mesh(hitGeo, hitMat);
    hit.userData = { kind: "sensor", id: s.id };
    root.add(body, lens, hit);
    const drop = makeDrop(this.dropMat);
    this.scene.add(root, drop);
    const el = document.createElement("div");
    el.className = "lbl sensor";
    this.labels.appendChild(el);
    const label: Label = { el, anchor: () => root.position.clone().add(new Vector3(0, 0.12, 0)) };
    return { root, cone, coneMesh, edges, capGrid, rings, bore, body, hit, drop, mats, label, key: "" };
  }

  private dispose(r: Rig): void {
    this.scene.remove(r.root, r.drop);
    for (const o of [r.coneMesh, r.edges, r.capGrid, r.rings, r.bore]) o.geometry.dispose();
    for (const m of Object.values(r.mats)) m.dispose();
    (r.body.material as MeshLambertMaterial).dispose();
    r.drop.geometry.dispose();
    r.label.el.remove();
  }

  private buildCone(r: Rig, s: Sensor, units: Units): void {
    const key = [s.hfov, s.vfov, s.range, units, s.model, s.gate].join("|");
    if (key === r.key) return;
    r.key = key;
    const H = s.hfov * D2R, V = s.vfov * D2R, R = s.range;
    const Na = Math.max(8, Math.ceil(s.hfov / 3)), Ne = Math.max(6, Math.ceil(s.vfov / 3));
    const az = (i: number) => -H / 2 + (H * i) / Na, el = (j: number) => -V / 2 + (V * j) / Ne;
    const O: [number, number, number] = [0, 0, 0];

    const tri: number[] = [];
    const push = (...pts: number[][]) => pts.forEach((p) => tri.push(p[0], p[1], p[2]));
    for (let i = 0; i < Na; i++) for (let j = 0; j < Ne; j++) {
      const a = dir(az(i), el(j), R), b = dir(az(i + 1), el(j), R), c = dir(az(i + 1), el(j + 1), R), d = dir(az(i), el(j + 1), R);
      push(a, b, c, a, c, d);
    }
    for (let i = 0; i < Na; i++) {
      push(O, dir(az(i), -V / 2, R), dir(az(i + 1), -V / 2, R));
      push(O, dir(az(i), V / 2, R), dir(az(i + 1), V / 2, R));
    }
    for (let j = 0; j < Ne; j++) {
      push(O, dir(-H / 2, el(j), R), dir(-H / 2, el(j + 1), R));
      push(O, dir(H / 2, el(j), R), dir(H / 2, el(j + 1), R));
    }
    setGeom(r.coneMesh, tri);

    const e: number[] = [];
    const seg = (p: number[], q: number[]) => e.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    for (let i = 0; i < Na; i++) { seg(dir(az(i), -V / 2, R), dir(az(i + 1), -V / 2, R)); seg(dir(az(i), V / 2, R), dir(az(i + 1), V / 2, R)); }
    for (let j = 0; j < Ne; j++) { seg(dir(-H / 2, el(j), R), dir(-H / 2, el(j + 1), R)); seg(dir(H / 2, el(j), R), dir(H / 2, el(j + 1), R)); }
    for (const [a, b] of [[-H / 2, -V / 2], [H / 2, -V / 2], [H / 2, V / 2], [-H / 2, V / 2]]) seg(O, dir(a, b, R));
    setGeom(r.edges, e);

    // faint grid on the far surface every 15°
    const g: number[] = [];
    const gseg = (p: number[], q: number[]) => g.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    const step = 15;
    for (let a = -Math.floor(s.hfov / 2 / step) * step; a <= s.hfov / 2 + 1e-6; a += step) {
      if (Math.abs(Math.abs(a) - s.hfov / 2) < 1e-6) continue;
      for (let j = 0; j < Ne; j++) gseg(dir(a * D2R, el(j), R), dir(a * D2R, el(j + 1), R));
    }
    for (let b = -Math.floor(s.vfov / 2 / step) * step; b <= s.vfov / 2 + 1e-6; b += step) {
      if (Math.abs(Math.abs(b) - s.vfov / 2) < 1e-6) continue;
      for (let i = 0; i < Na; i++) gseg(dir(az(i), b * D2R, R), dir(az(i + 1), b * D2R, R));
    }
    setGeom(r.capGrid, g);

    const rr: number[] = [];
    const rseg = (p: number[], q: number[]) => rr.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    // a ring per gate for gated sensors (LD2410 / LD2412), otherwise every 1 m or 3 ft
    for (const k of ringDistances(s, ringStep(units))) {
      for (let i = 0; i < Na; i++) rseg(dir(az(i), 0, k), dir(az(i + 1), 0, k));
      for (let j = 0; j < Ne; j++) rseg(dir(0, el(j), k), dir(0, el(j + 1), k));
    }
    setGeom(r.rings, rr);
    setGeom(r.bore, [0, 0, 0, 0, 0, -R]);
    r.bore.computeLineDistances();
  }
}

function setGeom(obj: Mesh | LineSegments | Line, arr: number[]): void {
  obj.geometry.dispose();
  obj.geometry = lineGeom(arr);
}
