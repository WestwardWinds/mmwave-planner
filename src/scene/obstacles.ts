import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial, Object3D, Scene, Vector3 } from "three";
import { D2R } from "../model/math";
import type { Obstacle } from "../model/types";
import { U2T, type Label, type Theme } from "./helpers";

const unitBox = new BoxGeometry(1, 1, 1);
const unitEdges = new EdgesGeometry(unitBox);

interface BoxObj { mesh: Mesh; edges: LineSegments; label: Label; h: number }

export class ObstacleViews {
  private objs = new Map<number, BoxObj>();
  constructor(private scene: Scene, private labels: HTMLElement) {}

  sync(obstacles: Obstacle[]): void {
    for (const [id, o] of this.objs) {
      if (obstacles.some((b) => b.id === id)) continue;
      this.scene.remove(o.mesh);
      (o.mesh.material as MeshLambertMaterial).dispose();
      (o.edges.material as LineBasicMaterial).dispose();
      o.label.el.remove();
      this.objs.delete(id);
    }
    for (const b of obstacles) {
      if (this.objs.has(b.id)) continue;
      const mesh = new Mesh(unitBox, new MeshLambertMaterial({ transparent: true, opacity: 0.82 }));
      mesh.userData = { kind: "box", id: b.id };
      const edges = new LineSegments(unitEdges, new LineBasicMaterial());
      mesh.add(edges);
      this.scene.add(mesh);
      const el = document.createElement("div");
      el.className = "lbl box";
      this.labels.appendChild(el);
      const o: BoxObj = { mesh, edges, h: b.h, label: { el, anchor: () => mesh.position.clone().add(new Vector3(0, o.h / 2 + 0.02, 0)) } };
      this.objs.set(b.id, o);
    }
  }

  update(obstacles: Obstacle[], selected: number | null, theme: Theme): void {
    for (const b of obstacles) {
      const o = this.objs.get(b.id);
      if (!o) continue;
      o.h = b.h;
      o.mesh.position.copy(U2T(b.x, b.y, b.z + b.h / 2));
      o.mesh.rotation.set(0, b.rot * D2R, 0); // user rotation about Z, counterclockwise from above
      o.mesh.scale.set(b.w, b.h, b.d); // three.js axes: x = width, y = height, z = depth
      const isSel = selected === b.id;
      (o.mesh.material as MeshLambertMaterial).color.copy(theme.obstacle);
      (o.edges.material as LineBasicMaterial).color.copy(isSel ? theme.accent : theme["room-edge"]);
      o.label.el.textContent = b.name || "Box";
      o.label.el.className = "lbl box" + (isSel ? " sel" : "");
    }
  }

  hitTargets(): Object3D[] {
    return [...this.objs.values()].map((o) => o.mesh);
  }

  labelList(): Label[] {
    return [...this.objs.values()].map((o) => o.label);
  }
}
