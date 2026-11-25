import { CanvasTexture, DoubleSide, LinearFilter, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace, type Color } from "three";
import { Cell, type Coverage } from "../model/coverage";
import type { PlannerState } from "../model/types";
import { sensorColor, U2T, type Theme } from "./helpers";

/** The coverage slice: a floor-plan texture at the slice height, colored by how many sensors see each cell. */
export class SliceView {
  readonly mesh: Mesh;
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private tex = new CanvasTexture(this.canvas);

  constructor() {
    this.tex.magFilter = NearestFilter;
    this.tex.minFilter = LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.tex, transparent: true, side: DoubleSide, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
  }

  update(cov: Coverage | null, state: PlannerState, theme: Theme): void {
    this.mesh.visible = !!cov;
    if (!cov) return;
    if (this.canvas.width !== cov.cols || this.canvas.height !== cov.rows) {
      this.canvas.width = cov.cols;
      this.canvas.height = cov.rows;
      this.tex.dispose(); // re-upload at the new size
    }
    // canvas pixels are sRGB: convert the (linear) theme colors back for drawing
    const rgb = (c: Color) => { const s = c.clone().convertLinearToSRGB(); return [s.r * 255, s.g * 255, s.b * 255]; };
    const out = rgb(theme.out), blocked = rgb(theme.blocked), overlap = rgb(theme.overlap);
    const perSensor = state.sensors.map((s) => rgb(sensorColor(theme, s)));
    const img = this.ctx.createImageData(cov.cols, cov.rows), data = img.data;
    for (let k = 0; k < cov.kind.length; k++) {
      let col = out, a = 34;
      switch (cov.kind[k]) {
        case Cell.NotRoom: data[k * 4 + 3] = 0; continue;
        case Cell.Overlap: col = overlap; a = cov.count[k] >= 3 ? 190 : 150; break;
        case Cell.One: col = perSensor[cov.who[k]] ?? out; a = 115; break;
        case Cell.Blocked: col = blocked; a = 150; break;
      }
      data[k * 4] = col[0]; data[k * 4 + 1] = col[1]; data[k * 4 + 2] = col[2]; data[k * 4 + 3] = a;
    }
    this.ctx.putImageData(img, 0, 0);
    this.tex.needsUpdate = true;
    const { w, d } = state.room;
    this.mesh.scale.set(w, d, 1);
    this.mesh.position.copy(U2T(w / 2, d / 2, cov.z));
  }
}
