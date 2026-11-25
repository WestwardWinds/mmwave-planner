import {
  AmbientLight, DirectionalLight, LineBasicMaterial, Mesh, Object3D, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { isPitched, lowCorner, peakPoint, peakZ } from "../model/ceiling";
import type { PointResult } from "../model/classify";
import type { Coverage } from "../model/coverage";
import type { PlannerState } from "../model/types";
import { fmtLen, snapStep } from "../model/units";
import { T2U, U2T, type Label, type Theme } from "./helpers";
import { ObstacleViews } from "./obstacles";
import { PointViews } from "./points";
import { roomClipPlanes, RoomView } from "./room";
import { SensorViews } from "./sensors";
import { SliceView } from "./slice";

export type Selection = { kind: "sensor" | "point" | "box"; id: number } | null;
export type ViewName = "iso" | "top" | "front" | "side";

export interface SceneHandlers {
  /** the user clicked an object (or empty space: null) */
  select(sel: Selection): void;
  /** the user dragged the selected object to a new spot (user frame; the anchor of a box is its center) */
  move(sel: NonNullable<Selection>, pos: { x: number; y: number; z: number }): void;
  /** the camera was moved by hand, so no named view is current */
  viewCleared(): void;
}

export interface SceneInput {
  state: PlannerState;
  results: Map<number, PointResult>;
  coverage: Coverage | null;
  selection: Selection;
  theme: Theme;
}

/** Owns the WebGL view. Fed a full SceneInput on every change; never mutates the state itself. */
export class SceneView {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(45, 1, 0.02, 500);
  private controls: OrbitControls;
  private tc: TransformControls;
  /** The drag arrows attach to this unrotated stand-in placed on the selected object. */
  private proxy = new Object3D();
  private dropMat = new LineBasicMaterial({ transparent: true, opacity: 0.55 });
  private room = new RoomView();
  private sensors: SensorViews;
  private points: PointViews;
  private obstacles: ObstacleViews;
  private slice = new SliceView();
  private fixedLabels: (Label & { when?: () => boolean })[] = [];
  private dims: Record<"w" | "d" | "h" | "peak", HTMLDivElement>;
  private input: SceneInput | null = null;
  private roomKey = "";
  private clip: Plane[] = [];
  private raf = 0;
  private resizeObs: ResizeObserver;
  private downAt: { x: number; y: number } | null = null;
  private ray = new Raycaster();
  private ndc = new Vector2();

  constructor(private canvas: HTMLCanvasElement, private labelsEl: HTMLElement, private handlers: SceneHandlers) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    // physically based lights: intensities are π times the old "legacy" values
    this.scene.add(new AmbientLight(0xffffff, 0.75 * Math.PI));
    const sun = new DirectionalLight(0xffffff, 0.6 * Math.PI);
    sun.position.set(4, 8, 6);
    this.scene.add(sun, this.room.group, this.slice.mesh, this.proxy);

    this.sensors = new SensorViews(this.scene, labelsEl, this.dropMat);
    this.points = new PointViews(this.scene, labelsEl, this.dropMat);
    this.obstacles = new ObstacleViews(this.scene, labelsEl);

    this.tc = new TransformControls(this.camera, canvas);
    this.tc.setSize(0.75);
    this.tc.setSpace("world");
    this.tc.addEventListener("dragging-changed", (e) => { this.controls.enabled = !e.value; });
    this.tc.addEventListener("objectChange", () => {
      const sel = this.input?.selection;
      if (sel) this.handlers.move(sel, T2U(this.proxy.position));
    });
    this.scene.add(this.tc.getHelper());
    this.singleArrowheads();

    this.buildFixedLabels();
    this.dims = {
      w: this.addFixed("dim", "", () => this.st && U2T(this.st.room.w / 2, -0.25, 0)),
      d: this.addFixed("dim", "", () => this.st && U2T(this.st.room.w + 0.15, this.st.room.d / 2, 0)),
      h: this.addFixed("dim", "", () => {
        if (!this.st) return null;
        const [x, y] = lowCorner(this.st.room);
        return U2T(x + (x ? 0.1 : -0.1), y, this.st.room.h / 2);
      }),
      peak: this.addFixed("dim", "", () => {
        if (!this.st) return null;
        const p = peakPoint(this.st.room);
        return U2T(p[0], p[1], p[2] + 0.12);
      }, () => !!this.st && isPitched(this.st.room))
    };

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: true });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  private get st(): PlannerState | null {
    return this.input?.state ?? null;
  }

  update(input: SceneInput): void {
    const first = !this.input;
    this.input = input;
    const { state, theme } = input;
    this.scene.background = theme["scene-bg"];
    this.dropMat.color.copy(theme["room-edge"]);
    this.room.applyTheme(theme);
    const key = JSON.stringify(state.room) + state.view.units;
    if (key !== this.roomKey) {
      this.roomKey = key;
      this.room.build(state.room, state.view.units);
      this.clip = roomClipPlanes(state.room);
    }
    const sel = input.selection;
    this.sensors.sync(state.sensors);
    this.sensors.update(state.sensors, {
      active: state.active, selected: sel?.kind === "sensor" ? sel.id : null, cones: state.view.cones,
      rings: state.view.rings, units: state.view.units, clip: state.view.clip ? this.clip : [], theme
    });
    this.points.sync(state.points);
    this.points.update(state.points, input.results, sel?.kind === "point" ? sel.id : null, theme);
    this.obstacles.sync(state.obstacles);
    this.obstacles.update(state.obstacles, sel?.kind === "box" ? sel.id : null, theme);
    this.slice.update(input.coverage, state, theme);

    const u = state.view.units;
    this.dims.w.textContent = fmtLen(state.room.w, u);
    this.dims.d.textContent = fmtLen(state.room.d, u);
    this.dims.h.textContent = (isPitched(state.room) ? "wall " : "") + fmtLen(state.room.h, u);
    this.dims.peak.textContent = "peak " + fmtLen(peakZ(state.room), u);

    this.tc.setTranslationSnap(state.view.snap ? snapStep(u) : null);
    const anchor = this.anchorOf(sel);
    if (anchor) {
      this.proxy.position.copy(anchor);
      if (this.tc.object !== this.proxy) this.tc.attach(this.proxy);
    } else if (this.tc.object) {
      this.tc.detach();
    }
    if (first) this.setView("iso");
  }

  setView(name: ViewName): void {
    if (!this.st) return;
    const { w, d } = this.st.room;
    const H = peakZ(this.st.room);
    const c = U2T(w / 2, d / 2, H / 2 - H * 0.1);
    const dist = Math.max(w, d, H) * 1.9;
    const off = {
      iso: new Vector3(0.75, 0.75, 1.05).normalize().multiplyScalar(dist),
      top: new Vector3(0, dist * 1.05, 0.001),
      front: new Vector3(0, 0, dist),
      side: new Vector3(-dist, 0, 0)
    }[name];
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(off);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    // drop every object (and its label) so a new SceneView can take over the same canvas
    this.sensors.sync([]);
    this.points.sync([]);
    this.obstacles.sync([]);
    for (const L of this.fixedLabels) L.el.remove();
    this.fixedLabels = [];
    this.tc.detach();
    this.tc.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }

  /**
   * three.js r170 draws a translate arrowhead at both ends of each axis. Keep only the one on the
   * positive side (the arrow points outward, the direction the coordinate grows), as in the earlier
   * single-file version. The matching grab handle on the negative side is turned off too.
   */
  private singleArrowheads(): void {
    const gizmo = (this.tc as unknown as { _gizmo?: { gizmo: Record<string, Object3D>; picker: Record<string, Object3D>; updateMatrixWorld: (f?: boolean) => void } })._gizmo;
    if (!gizmo) return;
    const axisIndex: Record<string, number> = { X: 0, Y: 1, Z: 2 };
    const hidden: Object3D[] = [];
    for (const group of [gizmo.gizmo.translate, gizmo.picker.translate]) {
      for (const h of group.children as Mesh[]) {
        const i = axisIndex[h.name];
        if (i === undefined || !h.geometry) continue;
        h.geometry.computeBoundingBox();
        const c = new Vector3();
        h.geometry.boundingBox!.getCenter(c);
        if (c.getComponent(i) < -0.1) hidden.push(h); // geometry is baked in place, so its center tells the side
      }
    }
    const original = gizmo.updateMatrixWorld.bind(gizmo);
    gizmo.updateMatrixWorld = (force?: boolean) => {
      original(force);
      for (const h of hidden) h.visible = false;
    };
  }

  private anchorOf(sel: Selection): Vector3 | null {
    const st = this.st;
    if (!sel || !st) return null;
    if (sel.kind === "sensor") { const s = st.sensors.find((x) => x.id === sel.id); return s ? U2T(s.x, s.y, s.z) : null; }
    if (sel.kind === "point") { const p = st.points.find((x) => x.id === sel.id); return p ? U2T(p.x, p.y, p.z) : null; }
    const b = st.obstacles.find((x) => x.id === sel.id);
    return b ? U2T(b.x, b.y, b.z + b.h / 2) : null;
  }

  private buildFixedLabels(): void {
    const axLen = () => (this.st ? RoomView.axisLength(this.st.room) + 0.12 : 0.7);
    this.addFixed("axis", "X", () => U2T(axLen(), 0, 0));
    this.addFixed("axis", "Y", () => U2T(0, axLen(), 0));
    this.addFixed("axis", "Z", () => U2T(0, 0, axLen()));
  }

  private addFixed(cls: string, text: string, anchor: () => Vector3 | null, when?: () => boolean): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "lbl " + cls;
    el.textContent = text;
    this.labelsEl.appendChild(el);
    this.fixedLabels.push({ el, anchor, when });
    return el;
  }

  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = (): void => {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.raf = requestAnimationFrame(this.frame);
  };

  private _v = new Vector3();
  private placeLabels(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const all: (Label & { when?: () => boolean })[] = [
      ...this.fixedLabels, ...this.sensors.labelList(), ...this.points.labelList(), ...this.obstacles.labelList()
    ];
    for (const L of all) {
      const pos = L.when && !L.when() ? null : L.anchor();
      if (!pos) { L.el.hidden = true; continue; }
      this._v.copy(pos).project(this.camera);
      if (this._v.z > 1 || this._v.z < -1) { L.el.hidden = true; continue; }
      L.el.hidden = false;
      const x = (this._v.x * 0.5 + 0.5) * w, y = (-this._v.y * 0.5 + 0.5) * h;
      L.el.style.transform = `translate(${Math.round(x + 8)}px,${Math.round(y - 10)}px)`;
    }
  }

  // a click (not a drag) selects whatever is under the pointer; sensors and points win over boxes
  private onPointerDown = (e: PointerEvent): void => {
    this.downAt = this.tc.axis || e.button !== 0 ? null : { x: e.clientX, y: e.clientY };
  };
  private onWheel = (): void => this.handlers.viewCleared();
  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) { this.handlers.viewCleared(); return; }
    if (!this.downAt || this.tc.dragging) { this.downAt = null; return; }
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 5) { this.handlers.viewCleared(); return; }
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit =
      this.ray.intersectObjects([...this.sensors.hitTargets(), ...this.points.hitTargets()], false)[0] ??
      this.ray.intersectObjects(this.obstacles.hitTargets(), false)[0];
    const ud = hit?.object.userData as { kind?: "sensor" | "point" | "box"; id?: number } | undefined;
    this.handlers.select(ud?.kind && ud.id !== undefined ? { kind: ud.kind, id: ud.id } : null);
  };
}
