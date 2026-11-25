import { DoubleSide, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, RingGeometry, Scene, SphereGeometry, Vector3 } from "three";
import type { PointResult } from "../model/classify";
import type { TestPoint } from "../model/types";
import { makeDrop, setDrop, U2T, type Label, type Theme } from "./helpers";
import { hitMat } from "./sensors";

const ptGeo = new SphereGeometry(0.06, 20, 14);
const hitGeo = new SphereGeometry(0.18, 10, 8); // a larger invisible target, easier to tap
const footGeo = new RingGeometry(0.05, 0.08, 24);

interface PointObj { mesh: Mesh; hit: Mesh; foot: Mesh; drop: Line; label: Label }

export const pointClass = (r: PointResult): "in" | "blocked" | "out" => (r.inside ? "in" : r.blocked ? "blocked" : "out");

export class PointViews {
  private objs = new Map<number, PointObj>();
  constructor(private scene: Scene, private labels: HTMLElement, private dropMat: LineBasicMaterial) {}

  sync(points: TestPoint[]): void {
    for (const [id, o] of this.objs) {
      if (points.some((p) => p.id === id)) continue;
      this.scene.remove(o.mesh, o.foot, o.drop);
      (o.mesh.material as MeshLambertMaterial).dispose();
      (o.foot.material as MeshBasicMaterial).dispose();
      o.drop.geometry.dispose();
      o.label.el.remove();
      this.objs.delete(id);
    }
    for (const p of points) {
      if (this.objs.has(p.id)) continue;
      const mesh = new Mesh(ptGeo, new MeshLambertMaterial());
      const hit = new Mesh(hitGeo, hitMat);
      hit.userData = { kind: "point", id: p.id };
      mesh.add(hit);
      const foot = new Mesh(footGeo, new MeshBasicMaterial({ side: DoubleSide, transparent: true, opacity: 0.8 }));
      foot.rotation.x = -Math.PI / 2;
      const drop = makeDrop(this.dropMat);
      this.scene.add(mesh, foot, drop);
      const el = document.createElement("div");
      el.className = "lbl";
      this.labels.appendChild(el);
      this.objs.set(p.id, { mesh, hit, foot, drop, label: { el, anchor: () => mesh.position.clone().add(new Vector3(0, 0.05, 0)) } });
    }
  }

  update(points: TestPoint[], results: Map<number, PointResult>, selected: number | null, theme: Theme): void {
    for (const p of points) {
      const o = this.objs.get(p.id), r = results.get(p.id);
      if (!o || !r) continue;
      o.mesh.position.copy(U2T(p.x, p.y, p.z));
      o.foot.position.copy(U2T(p.x, p.y, 0.003));
      const cls = pointClass(r);
      const col = cls === "in" ? theme.in : cls === "blocked" ? theme.blocked : theme.out;
      const mat = o.mesh.material as MeshLambertMaterial;
      mat.color.copy(col);
      mat.emissive.copy(col).multiplyScalar(0.25);
      (o.foot.material as MeshBasicMaterial).color.copy(col);
      setDrop(o.drop, p);
      const isSel = selected === p.id;
      o.mesh.scale.setScalar(isSel ? 1.35 : 1);
      o.label.el.textContent = (p.name || "Point") + (r.seenBy.length > 1 ? " ×" + r.seenBy.length : "");
      o.label.el.className = "lbl " + cls + (isSel ? " sel" : "");
    }
  }

  hitTargets(): Object3D[] {
    return [...this.objs.values()].map((o) => o.hit);
  }

  labelList(): Label[] {
    return [...this.objs.values()].map((o) => o.label);
  }
}
