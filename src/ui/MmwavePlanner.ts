import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { isPitched, peakZ, ceilAt, ceilPlanes } from "../model/ceiling";
import { classifyAll, formatReason, type PointResult } from "../model/classify";
import { computeCoverage, type Coverage } from "../model/coverage";
import {
  activeSensor, addObstacle, addPoint, addSensor, aimAt, applyModel, applyMount, CeilingMounts, clampAll,
  clampBox, clampToRoom, removeSensor, setCeiling, type MountPreset
} from "../model/edits";
import { clamp, fmt, round } from "../model/math";
import { DEFAULT_STATE, matchModel, SENSOR_MODELS } from "../model/presets";
import { cloneState, decodeShare, encodeShare, parseState, serializeState } from "../model/serialize";
import { Store } from "../model/store";
import type { CeilingKind, Obstacle, PlannerState, Sensor, TestPoint } from "../model/types";
import { fieldLen, fmtLen, parseLen } from "../model/units";
import { readTheme, sensorCss, type Theme } from "../scene/helpers";
import { pointClass } from "../scene/points";
import { SceneView, type Selection, type ViewName } from "../scene/SceneView";
import { fieldValue } from "./field-value";
import { styles } from "./styles";

// Page scroll is locked while any planner fills the window; the page's own value is restored when the last one closes.
const expandedPlanners = new Set<HTMLElement>();
let pageOverflowBefore = "";
function lockPageScroll(el: HTMLElement): void {
  if (!expandedPlanners.size) {
    pageOverflowBefore = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  expandedPlanners.add(el);
}
function unlockPageScroll(el: HTMLElement): void {
  if (!expandedPlanners.delete(el) || expandedPlanners.size) return;
  if (document.documentElement.style.overflow === "hidden") document.documentElement.style.overflow = pageOverflowBefore;
}

interface NumFieldOpts {
  id: string;
  label: TemplateResult | string;
  get: () => number;
  set: (v: number, committed: boolean) => void;
  /** a length: shown and typed in the current units */
  len?: boolean;
  d?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}
interface PairOpts extends NumFieldOpts {
  sMin: number;
  sMax: number;
  sStep: number;
  help?: string;
}

/**
 * <mmwave-planner> — a 3D coverage planner for mmWave presence sensors.
 *
 * Attributes:
 *   src="room.json"   load a setup from a URL (a docs page's example room)
 *   persist[="key"]   remember the visitor's edits in localStorage under this key
 *   use-hash          read/write share links as #config=... in the page URL
 *   theme="auto|light|dark"  auto follows the page (html[data-theme] or html.dark) or the OS
 *   hide-panel        show only the 3D view
 *   page              standalone-page layout: on narrow screens the page scrolls past the 3D view to the controls
 * An inline <script type="application/json"> child also works as the starting setup.
 * Fires "change" (detail: a copy of the state) after edits.
 */
export class MmwavePlanner extends LitElement {
  static styles = styles;
  static properties = {
    src: { type: String },
    persist: { type: String },
    theme: { type: String },
    useHash: { type: Boolean, attribute: "use-hash" },
    hidePanel: { type: Boolean, attribute: "hide-panel", reflect: true }
  };
  declare src: string | null;
  declare persist: string | null;
  declare theme: "auto" | "light" | "dark";
  declare useHash: boolean;
  declare hidePanel: boolean;

  private store = new Store(cloneState(DEFAULT_STATE));
  private scene: SceneView | null = null;
  private colors: Theme | null = null;
  private selection: Selection = null;
  private view: ViewName | null = "iso";
  private results = new Map<number, PointResult>();
  private coverage: Coverage | null = null;
  private mounts = new CeilingMounts();
  private roomEditing = false;
  private resetArmed = 0;
  private flash = "";
  private saveTimer = 0;
  private themeObs: MutationObserver | null = null;
  private mq: MediaQueryList | null = null;
  private failed = "";

  constructor() {
    super();
    // a `state` assigned before the element was upgraded sits on the instance and would hide the accessor
    const early = (this as unknown as Record<string, unknown>).state;
    if (early !== undefined && Object.prototype.hasOwnProperty.call(this, "state")) {
      delete (this as unknown as Record<string, unknown>).state;
      this.pendingState = early;
    }
    this.theme = "auto";
    this.useHash = false;
    this.hidePanel = false;
    this.src = null;
    this.persist = null;
    this.store.subscribe(() => this.onState());
  }

  // ---------- public API ----------
  /** A copy of the current setup. */
  get state(): PlannerState { return this.store.snapshot(); }
  /** Replace the setup (validated). Before the element is connected, this becomes its starting setup. */
  set state(v: unknown) {
    if (!this.initialized) { this.pendingState = v; return; }
    this.loadState(v);
  }
  exportJSON(): string { return serializeState(this.store.state); }
  reset(): void { this.loadState(DEFAULT_STATE); }

  // ---------- lifecycle ----------
  private initialized = false;
  private pendingState: unknown = undefined;
  /** JSON of the last setup saved / announced; `change` and persistence only fire when it differs. */
  private lastEmitted = "";

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.initialized) {
      // first connection only: moving the element keeps the visitor's edits
      this.initialized = true;
      this.store.state = this.initialState();
    }
    this.watchTheme();
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("hashchange", this.onHash);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    if (this.hasUpdated && !this.scene) {
      this.createScene();
      this.store.update();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("hashchange", this.onHash);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.collapse();
    this.themeObs?.disconnect();
    this.mq?.removeEventListener("change", this.applyScheme);
    this.scene?.dispose();
    this.scene = null;
  }

  protected firstUpdated(): void {
    this.createScene();
    this.colors = readTheme(this);
    clampAll(this.store.state);
    this.lastEmitted = JSON.stringify(this.store.state); // the starting setup is not an edit
    this.store.update();
    if (this.src && !this.hasOwnSetup) void this.fetchSrc(this.src);
  }

  private createScene(): void {
    const canvas = this.renderRoot.querySelector("canvas")!;
    const labels = this.renderRoot.querySelector(".labels") as HTMLElement;
    try {
      this.scene = new SceneView(canvas, labels, {
        select: (sel) => this.select(sel),
        move: (sel, pos) => this.moveSelected(sel, pos),
        viewCleared: () => { if (this.view) { this.view = null; this.requestUpdate(); } }
      });
      this.failed = "";
    } catch {
      this.failed = "This browser could not start WebGL, which the 3D view needs.";
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("theme")) this.applyScheme();
    if (changed.has("src") && changed.get("src") !== undefined && this.src) void this.fetchSrc(this.src);
    // the model menu's options are a dynamic list, so its value is set after they exist
    const model = this.renderRoot.querySelector("#model") as HTMLSelectElement | null;
    if (model) model.value = matchModel(activeSensor(this.store.state))?.id ?? "custom";
  }

  // ---------- state ----------
  private hasOwnSetup = false;

  /** Starting setup, first match wins: assigned `state` > share link > the visitor's saved edits > inline JSON > (src, fetched later) > example. */
  private initialState(): PlannerState {
    if (this.pendingState !== undefined) {
      this.hasOwnSetup = true;
      const s = parseState(this.pendingState);
      this.pendingState = undefined;
      return s;
    }
    const fromHash = this.hashState();
    if (fromHash) { this.hasOwnSetup = true; return fromHash; }
    const key = this.storageKey;
    if (key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) { this.hasOwnSetup = true; return parseState(JSON.parse(raw)); }
      } catch { /* storage unavailable */ }
    }
    const inline = this.querySelector('script[type="application/json"]');
    if (inline?.textContent) {
      try { const s = parseState(JSON.parse(inline.textContent)); this.hasOwnSetup = true; return s; } catch { /* fall through */ }
    }
    return cloneState(DEFAULT_STATE);
  }

  private hashState(): PlannerState | null {
    return this.useHash && location.hash.startsWith("#config=") ? decodeShare(location.hash.slice(8)) : null;
  }

  private onHash = (): void => {
    const s = this.hashState();
    if (s) this.loadState(s);
  };

  private get storageKey(): string | null {
    if (this.persist === null || this.persist === undefined) return null;
    return this.persist || "mmwave-planner";
  }

  private async fetchSrc(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      this.loadState(await res.json());
    } catch {
      this.showFlash("Couldn't load the room from " + url);
    }
  }

  private loadState(v: unknown): void {
    this.selection = null;
    this.roomEditing = false;
    this.store.replace(v);
    clampAll(this.store.state);
    this.store.update();
    this.setView("iso");
  }

  /** Recompute everything derived from the state, redraw, persist. */
  private onState(): void {
    const st = this.store.state;
    if (this.selection && !this.selectionTarget()) this.selection = null;
    this.results = new Map(st.points.map((p) => [p.id, classifyAll(st.sensors, st.obstacles, p)]));
    this.coverage = st.view.slice ? computeCoverage(st) : null;
    if (!this.roomEditing) this.mounts.record(st);
    if (this.scene && this.colors) {
      this.scene.update({ state: st, results: this.results, coverage: this.coverage, selection: this.selection, theme: this.colors });
    }
    this.requestUpdate();
    // selection, theme and redraw-only updates leave the setup unchanged: no save, no "change" event
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const json = JSON.stringify(this.store.state);
      if (json === this.lastEmitted) return;
      this.lastEmitted = json;
      const key = this.storageKey;
      if (key) { try { localStorage.setItem(key, json); } catch { /* ignore */ } }
      this.dispatchEvent(new CustomEvent("change", { detail: this.store.snapshot(), bubbles: true, composed: true }));
    }, 250);
  }

  private edit(fn: (st: PlannerState) => void): void {
    this.store.update(fn);
  }

  /** Room edits redraw live while typing but only pull things inside once committed (Enter / leaving the field). */
  private editRoom(fn: (st: PlannerState) => void, committed: boolean): void {
    this.store.update((st) => {
      this.roomEditing = true;
      fn(st);
      this.mounts.follow(st);
      if (committed) { clampAll(st); this.roomEditing = false; }
    });
  }

  private editActive(fn: (s: Sensor, st: PlannerState) => void): void {
    this.store.update((st) => fn(activeSensor(st), st));
  }

  // ---------- selection & 3D ----------
  private selectionTarget(): Sensor | TestPoint | Obstacle | null {
    const sel = this.selection, st = this.store.state;
    if (!sel) return null;
    if (sel.kind === "sensor") return st.sensors.find((s) => s.id === sel.id) ?? null;
    if (sel.kind === "point") return st.points.find((p) => p.id === sel.id) ?? null;
    return st.obstacles.find((b) => b.id === sel.id) ?? null;
  }

  private select(sel: Selection): void {
    this.selection = sel;
    this.store.update((st) => { if (sel?.kind === "sensor") st.active = sel.id; });
  }

  private moveSelected(sel: NonNullable<Selection>, pos: { x: number; y: number; z: number }): void {
    this.store.update((st) => {
      if (sel.kind === "box") {
        const b = st.obstacles.find((x) => x.id === sel.id);
        if (b) { b.x = pos.x; b.y = pos.y; b.z = pos.z - b.h / 2; clampBox(st, b); }
        return;
      }
      const t = sel.kind === "sensor" ? st.sensors.find((x) => x.id === sel.id) : st.points.find((x) => x.id === sel.id);
      if (t) { Object.assign(t, pos); clampToRoom(st, t); }
    });
  }

  private setView(name: ViewName): void {
    this.view = name;
    this.scene?.setView(name);
    this.requestUpdate();
  }

  private onKey = (e: KeyboardEvent): void => {
    const t = e.composedPath()[0] as HTMLElement | undefined;
    if (t?.matches?.("input, select, textarea")) return;
    if (e.key !== "Escape") return;
    // first Esc deselects; the next one leaves the window-filling mode (the browser handles real full screen itself)
    if (this.selection) this.select(null);
    else if (this.hasAttribute("expanded")) this.collapse();
  };

  // ---------- full screen ----------
  /** In browser full screen. Checked on the element itself, so it also works inside another component's shadow DOM. */
  private get inNativeFullscreen(): boolean {
    try { return this.matches(":fullscreen"); } catch { return (this.getRootNode() as Document | ShadowRoot).fullscreenElement === this; }
  }

  /** True in browser full screen or in the window-filling fallback. */
  private get isFull(): boolean {
    return this.inNativeFullscreen || this.hasAttribute("expanded");
  }

  /** In an iframe that doesn't allow full screen, the fallback could only fill the iframe itself, so the button is hidden. */
  private get canGoFull(): boolean {
    return document.fullscreenEnabled || window.top === window;
  }

  /** the user's latest intent; a full screen request answered after they gave up is undone */
  private wantFull = false;
  private fsPending = false;

  /**
   * Fill the screen. Uses the browser's Fullscreen API where allowed; where it isn't (iPhone Safari,
   * or a request the browser leaves unanswered) the planner fills the browser window instead.
   */
  async toggleFullscreen(): Promise<void> {
    if (this.fsPending) return;
    if (this.isFull) {
      this.wantFull = false;
      if (this.inNativeFullscreen) await document.exitFullscreen().catch(() => undefined);
      this.collapse();
      return;
    }
    if (!this.canGoFull) return;
    this.wantFull = true;
    if (document.fullscreenEnabled && this.requestFullscreen) {
      // some embedded browsers leave the request unanswered, so give it a moment, then fall back
      this.fsPending = true;
      const ok = await Promise.race([
        this.requestFullscreen().then(() => true, () => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 800))
      ]);
      this.fsPending = false;
      if (ok || this.inNativeFullscreen) return;
    }
    if (this.wantFull) this.expand();
  }

  private expand(): void {
    if (this.hasAttribute("expanded")) return;
    this.setAttribute("expanded", "");
    // The top layer (a manual popover) sits above everything on the page and ignores ancestors' transforms,
    // containment and stacking, which would otherwise trap a position:fixed element inside a card or slide.
    if (typeof this.showPopover === "function") {
      this.setAttribute("popover", "manual");
      try { this.showPopover(); } catch { /* the fixed-position styles still apply */ }
    }
    lockPageScroll(this);
    this.onFullscreenChange();
  }

  private collapse(): void {
    if (!this.hasAttribute("expanded")) return;
    if (this.hasAttribute("popover")) {
      try { this.hidePopover(); } catch { /* not showing */ }
      this.removeAttribute("popover");
    }
    this.removeAttribute("expanded");
    unlockPageScroll(this);
    this.onFullscreenChange();
  }

  private onFullscreenChange = (): void => {
    if (this.inNativeFullscreen) {
      // a full screen request answered late: undo it if the user already left, otherwise it replaces the fallback
      if (!this.wantFull) { void document.exitFullscreen().catch(() => undefined); return; }
      this.collapse();
    } else if (!this.hasAttribute("expanded")) {
      this.wantFull = false; // left full screen with the browser's own Esc
    }
    this.toggleAttribute("full", this.isFull);
    this.requestUpdate();
  };

  // ---------- theme ----------
  private watchTheme(): void {
    this.mq = window.matchMedia("(prefers-color-scheme: dark)");
    this.mq.addEventListener("change", this.applyScheme);
    this.themeObs = new MutationObserver(this.applyScheme);
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    this.applyScheme();
  }

  private applyScheme = (): void => {
    let dark: boolean;
    if (this.theme === "dark" || this.theme === "light") dark = this.theme === "dark";
    else {
      const root = document.documentElement;
      const dt = root.getAttribute("data-theme");
      dark = dt === "dark" || (dt !== "light" && (root.classList.contains("dark") || !!this.mq?.matches));
    }
    const next = dark ? "dark" : "light";
    if (this.getAttribute("scheme") === next && this.colors) return;
    this.setAttribute("scheme", next);
    if (this.hasUpdated) { this.colors = readTheme(this); this.store.update(); }
  };

  // ---------- collapsible panel sections ----------
  // Folded sections are a per-visitor preference, remembered in this browser (shared by every planner on the site).
  private static readonly SECTIONS_KEY = "mmwave-planner:collapsed-sections";
  private collapsed: Set<string> = MmwavePlanner.loadCollapsed();

  private static loadCollapsed(): Set<string> {
    try {
      const v = JSON.parse(localStorage.getItem(MmwavePlanner.SECTIONS_KEY) ?? "[]");
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  }

  private toggleSection(key: string): void {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    try { localStorage.setItem(MmwavePlanner.SECTIONS_KEY, JSON.stringify([...this.collapsed])); } catch { /* storage unavailable */ }
    this.requestUpdate();
  }

  private secClass(key: string): string {
    return this.collapsed.has(key) ? "collapsed" : "";
  }

  /** A section title that folds or opens its section. Header buttons beside it (Add sensor, …) don't toggle. */
  private secToggle(key: string, label: string): TemplateResult {
    const open = !this.collapsed.has(key);
    return html`<button type="button" class="sec-toggle" aria-expanded=${String(open)}
      title=${open ? "Hide this section" : "Show this section"} @click=${() => this.toggleSection(key)}>
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" /></svg>${label}
    </button>`;
  }

  // ---------- small helpers ----------
  private get units() { return this.store.state.view.units; }

  private showFlash(msg: string): void {
    this.flash = msg;
    this.requestUpdate();
    setTimeout(() => { if (this.flash === msg) { this.flash = ""; this.requestUpdate(); } }, 2500);
  }

  private numField(o: NumFieldOpts): TemplateResult {
    const imp = o.len && this.units === "ftin";
    const text = o.len ? fieldLen(o.get(), this.units, o.d ?? 2) : String(round(o.get(), o.d ?? 1));
    const onEvt = (e: Event, committed: boolean) => {
      const el = e.target as HTMLInputElement;
      const raw = o.len ? parseLen(el.value, this.units) : parseFloat(el.value);
      if (isFinite(raw)) o.set(clamp(raw, o.min ?? -Infinity, o.max ?? Infinity), committed);
      if (committed) el.value = o.len ? fieldLen(o.get(), this.units, o.d ?? 2) : String(round(o.get(), o.d ?? 1));
    };
    return html`<div class="unitwrap">
      <input id=${o.id} class=${imp ? "num-text" : ""} type=${imp ? "text" : "number"} inputmode="decimal"
        step=${o.step ?? (o.len ? 0.05 : 1)} ${fieldValue(text)}
        @input=${(e: Event) => onEvt(e, false)} @change=${(e: Event) => onEvt(e, true)}
        @blur=${(e: Event) => { if (this.roomEditing) onEvt(e, true); }} />
      <i>${o.unit ?? (o.len ? (imp ? "" : "m") : "")}</i>
    </div>`;
  }

  private field(o: NumFieldOpts): TemplateResult {
    return html`<div class="field"><label for=${o.id}>${o.label}</label>${this.numField(o)}</div>`;
  }

  private pair(o: PairOpts): TemplateResult {
    const v = o.get();
    return html`<div class="field">
      <label for=${o.id}>${o.label}</label>
      <div class="pair">
        <input type="range" min=${o.sMin} max=${Math.max(o.sMax, v)} step=${o.sStep} aria-label=${String(o.label) + " slider"}
          ${fieldValue(String(v))} @input=${(e: Event) => o.set(parseFloat((e.target as HTMLInputElement).value), true)} />
        ${this.numField(o)}
      </div>
      ${o.help ? html`<p class="help">${o.help}</p>` : nothing}
    </div>`;
  }

  // ---------- render ----------
  render(): TemplateResult {
    const st = this.store.state;
    const sel = this.selection;
    const kindName = sel ? { sensor: "the sensor", point: "the point", box: "the box" }[sel.kind] : "";
    return html`
      <div class="app">
        <div class="viewport ${sel ? "has-sel" : ""}">
          <canvas tabindex="0" aria-label="3D view of the room and radar coverage"></canvas>
          <div class="labels"></div>
          ${this.failed ? html`<div class="fail">${this.failed}</div>` : nothing}
          <div class="toolbar">
            <div class="seg" role="group" aria-label="Camera view">
              ${(["iso", "top", "front", "side"] as ViewName[]).map((v) => html`
                <button type="button" aria-pressed=${String(this.view === v)} @click=${() => this.setView(v)}>${{ iso: "3D", top: "Top", front: "Front", side: "Side" }[v]}</button>`)}
            </div>
            <div class="seg" ?hidden=${!this.canGoFull}>
              <button type="button" class="fs-btn" aria-pressed=${String(this.isFull)} title=${this.isFull ? "Exit full screen (Esc)" : "Full screen"} @click=${() => this.toggleFullscreen()}>
                ${this.isFull
                  ? html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" /></svg>Exit full screen`
                  : html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" /></svg>Full screen`}
              </button>
            </div>
            <div class="hint">${sel ? `Drag an arrow to move ${kindName} · Esc or click empty space to finish` : "Drag to orbit · scroll to zoom · click a sensor, point or box to move it"}</div>
          </div>
          <div class="legend" aria-hidden="true">${this.legendItems()}</div>
          <div class="summary">${this.summaryChips()}</div>
        </div>
        <aside class="panel">
          <div class="legend-inline" aria-label="Color key">${this.legendItems()}</div>
          ${this.headerSection()}
          ${this.roomSection(st)}
          ${this.sensorsSection(st)}
          ${this.positionSection(st)}
          ${this.tiltSection(st)}
          ${this.radarSection(st)}
          ${this.pointsSection(st)}
          ${this.obstaclesSection(st)}
          ${this.displaySection(st)}
        </aside>
      </div>`;
  }

  private legendItems(): TemplateResult {
    return html`
      <span><i class="sw split"></i>One sensor (its color)</span>
      <span><i class="sw sq" style="background:var(--overlap)"></i>Seen by 2+ sensors</span>
      <span><i class="sw sq" style="background:var(--blocked)"></i>Blocked (dead spot)</span>
      <span><i class="sw" style="background:var(--in)"></i>Point detected</span>
      <span><i class="sw" style="background:var(--out)"></i>Point not detected</span>
      <span><i class="sw sq" style="background:var(--obstacle)"></i>Obstacle</span>`;
  }

  private summaryChips(): TemplateResult {
    const st = this.store.state, n = st.points.length;
    const k = st.points.filter((p) => this.results.get(p.id)?.inside).length;
    const c = this.coverage;
    return html`
      <span class="chip">${n ? `${k} of ${n} points detected` : "No test points"}</span>
      ${c ? html`<span class="chip">${fmt(c.coveredPct, 0)}% of floor area covered at ${fmtLen(c.z, this.units)}</span>` : nothing}
      ${c && st.sensors.length > 1 ? html`<span class="chip" style="border-color:var(--overlap)">${fmt(c.overlapPct, 0)}% seen by 2+ sensors</span>` : nothing}
      ${c && c.hiddenPct > 0.05 ? html`<span class="chip" style="border-color:var(--blocked)">${fmt(c.hiddenPct, 0)}% hidden behind obstacles</span>` : nothing}`;
  }

  private headerSection(): TemplateResult {
    const imp = this.units === "ftin";
    return html`<header>
      <h1>mmWave Coverage Planner</h1>
      <p class="sub">${imp ? `Feet-inches and degrees. Type lengths like 5' 3", 5 3 or 63".` : "Meters and degrees."} Origin is the front-left floor corner; X runs along the width, Y into the room, Z up.</p>
      <div class="seg units" role="group" aria-label="Units">
        ${(["m", "ftin"] as const).map((u) => html`<button type="button" aria-pressed=${String(this.units === u)}
          @click=${() => { (this.renderRoot as ShadowRoot).activeElement && ((this.renderRoot as ShadowRoot).activeElement as HTMLElement).blur(); this.edit((s) => { s.view.units = u; }); }}>${u === "m" ? "Meters" : "Feet & inches"}</button>`)}
      </div>
    </header>`;
  }

  private roomSection(st: PlannerState): TemplateResult {
    const r = st.room, pitched = isPitched(r);
    const roomField = (id: string, label: TemplateResult | string, k: "w" | "d" | "h" | "peak", max: number) =>
      this.field({ id, label, len: true, min: 0.5, max, step: 0.1, get: () => this.store.state.room[k], set: (v, c) => this.editRoom((s) => { s.room[k] = v; }, c) });
    return html`<section aria-labelledby="h-room" class=${this.secClass("room")}>
      <h2 id="h-room">${this.secToggle("room", "Room")}</h2>
      <div class="grid3">
        ${roomField("room-w", html`Width <b>X</b>`, "w", 50)}
        ${roomField("room-d", html`Depth <b>Y</b>`, "d", 50)}
        ${roomField("room-h", pitched ? "Wall height" : html`Height <b>Z</b>`, "h", 20)}
      </div>
      <div class="field">
        <label for="ceiling">Ceiling</label>
        <select id="ceiling" .value=${r.ceiling} @change=${(e: Event) => this.editRoom((s) => setCeiling(s, (e.target as HTMLSelectElement).value as CeilingKind), true)}>
          <option value="flat">Flat</option>
          <option value="single">Single pitch (slopes one way)</option>
          <option value="double">Double pitch (gable, ridge in the middle)</option>
        </select>
      </div>
      <div class="grid2" ?hidden=${!pitched}>
        ${roomField("room-peak", "Peak height", "peak", 30)}
        <div class="field" ?hidden=${r.ceiling !== "single"}>
          <label for="ceil-low">Low side</label>
          <select id="ceil-low" .value=${r.low} @change=${(e: Event) => this.editRoom((s) => { s.room.low = (e.target as HTMLSelectElement).value as PlannerState["room"]["low"]; }, true)}>
            <option value="y0">Front wall (Y = 0)</option>
            <option value="yD">Back wall</option>
            <option value="x0">Left wall (X = 0)</option>
            <option value="xW">Right wall</option>
          </select>
        </div>
        <div class="field" ?hidden=${r.ceiling !== "double"}>
          <label for="ceil-ridge">Ridge runs along</label>
          <select id="ceil-ridge" .value=${r.ridge} @change=${(e: Event) => this.editRoom((s) => { s.room.ridge = (e.target as HTMLSelectElement).value as "x" | "y"; }, true)}>
            <option value="x">Width (X)</option>
            <option value="y">Depth (Y)</option>
          </select>
        </div>
      </div>
      ${pitched ? html`<p class="help">${r.peak < r.h
        ? "Peak height is below the wall height, so the ceiling is drawn flat until the peak is raised."
        : r.ceiling === "single" ? "The ceiling rises from the wall height on the low side to the peak height on the opposite wall."
        : "Both sides rise from the wall height to the peak along a centered ridge."}</p>` : nothing}
    </section>`;
  }

  private sensorsSection(st: PlannerState): TemplateResult {
    const a = activeSensor(st);
    const selected = this.selection?.kind === "sensor" && this.selection.id === a.id;
    return html`<section aria-labelledby="h-sensors" class=${this.secClass("sensors")}>
      <h2 id="h-sensors">${this.secToggle("sensors", "Sensors")} <button type="button" class="btn small primary" @click=${() => this.edit((s) => {
        const added = addSensor(s, activeSensor(s));
        if (this.selection?.kind === "sensor") this.selection = { kind: "sensor", id: added.id }; // arrows follow to the new sensor
      })}>Add sensor</button></h2>
      <div class="sensor-tabs" role="group" aria-label="Choose the sensor to edit">
        ${st.sensors.map((s) => html`<button type="button" class="stab" aria-pressed=${String(s.id === st.active)}
          @click=${() => { if (this.selection?.kind === "sensor") this.selection = { kind: "sensor", id: s.id }; this.edit((x) => { x.active = s.id; }); }}>
          <i class="sw" style="background:${sensorCss(s)}"></i><span>${s.name || "Sensor"}</span></button>`)}
      </div>
      <div class="name-row">
        <input type="text" aria-label="Selected sensor name" maxlength="40" ${fieldValue(a.name)}
          @input=${(e: Event) => this.editActive((s) => { s.name = (e.target as HTMLInputElement).value; })} />
        <button type="button" class="btn small ${selected ? "active" : ""}" @click=${() => this.select({ kind: "sensor", id: a.id })}>Move in 3D</button>
        <button type="button" class="btn small" ?disabled=${st.sensors.length < 2} @click=${() => this.edit((s) => removeSensor(s, s.active))}>Remove</button>
      </div>
      <p class="help">The settings below apply to the selected sensor. Clicking a sensor in 3D selects it too.</p>
    </section>`;
  }

  private actName(st: PlannerState): TemplateResult {
    const a = activeSensor(st);
    return html`<span class="act-name" style="color:${sensorCss(a)}">${a.name || "Sensor"}</span>`;
  }

  private positionSection(st: PlannerState): TemplateResult {
    const a = activeSensor(st);
    const cp = ceilPlanes(st.room);
    const posField = (k: "x" | "y" | "z", max: number) => this.field({
      id: "s-" + k, label: k.toUpperCase(), len: true, min: 0, max,
      get: () => activeSensor(this.store.state)[k],
      set: (v) => this.editActive((s, sst) => { s[k] = v; if (k !== "z") clampToRoom(sst, s); })
    });
    return html`<section aria-labelledby="h-pos" class=${this.secClass("pos")}>
      <h2 id="h-pos">${this.secToggle("pos", "Position")}${this.actName(st)}</h2>
      <div class="grid3">${posField("x", st.room.w)}${posField("y", st.room.d)}${posField("z", ceilAt(cp, a.x, a.y))}</div>
      <div class="field">
        <label for="preset">Quick mount</label>
        <select id="preset" .value=${""} @change=${(e: Event) => {
          const el = e.target as HTMLSelectElement, v = el.value as MountPreset;
          el.value = "";
          if (v) this.editActive((s, sst) => applyMount(sst, s, v));
        }}>
          <option value="">Choose a mounting spot…</option>
          <option value="front">Front wall, centered, facing in</option>
          <option value="left">Left wall, centered, facing in</option>
          <option value="corner">Ceiling corner, aimed diagonally</option>
          <option value="ceiling">Ceiling center, pointing straight down</option>
          <option value="flush">Flush on the ceiling above its current spot</option>
        </select>
        <p class="help">"Flush on the ceiling" lays the sensor flat against the ceiling, so on a sloped ceiling it faces at right angles to the slope.</p>
      </div>
    </section>`;
  }

  private tiltSection(st: PlannerState): TemplateResult {
    const angle = (k: "pan" | "tilt" | "roll", label: string, min: number, max: number, help: string) => this.pair({
      id: k, label, min, max, sMin: min, sMax: max, sStep: 1, unit: "°", d: 1, help,
      get: () => activeSensor(this.store.state)[k], set: (v) => this.editActive((s) => { s[k] = v; })
    });
    return html`<section aria-labelledby="h-aim" class=${this.secClass("aim")}>
      <h2 id="h-aim">${this.secToggle("aim", "Tilt")}${this.actName(st)}</h2>
      ${angle("pan", "Horizontal tilt (pan)", -180, 180, "0° faces +Y (into the room), 90° faces +X.")}
      ${angle("tilt", "Vertical tilt (pitch)", -90, 90, "Negative aims down. −90° points straight at the floor.")}
      ${angle("roll", "Roll", -180, 180, "Rotates the field of view around the facing direction, e.g. 90° for a sensor mounted on its side.")}
    </section>`;
  }

  private radarSection(st: PlannerState): TemplateResult {
    const a = activeSensor(st);
    const model = matchModel(a);
    const fov = (k: "hfov" | "vfov", label: string) => this.pair({
      id: k, label, min: 1, max: 180, sMin: 1, sMax: 180, sStep: 1, unit: "°", d: 1,
      get: () => activeSensor(this.store.state)[k], set: (v) => this.editActive((s) => { s[k] = v; })
    });
    return html`<section aria-labelledby="h-radar" class=${this.secClass("radar")}>
      <h2 id="h-radar">${this.secToggle("radar", "Radar parameters")}${this.actName(st)}</h2>
      <div class="field">
        <label for="model">Sensor model</label>
        <select id="model" @change=${(e: Event) => this.editActive((s) => applyModel(s, (e.target as HTMLSelectElement).value))}>
          <option value="custom">Custom</option>
          ${SENSOR_MODELS.map((m) => html`<option value=${m.id}>${m.label}</option>`)}
        </select>
        <p class="help">${model ? model.note : "Pick a model to fill in its field of view and range, or set them by hand below."}</p>
      </div>
      ${fov("hfov", "Horizontal field of view")}
      ${fov("vfov", "Vertical field of view")}
      ${this.pair({
        id: "range", label: "Max detection distance", len: true, min: 0.1, max: 50, sMin: 0.5, sMax: 20, sStep: 0.1, step: 0.1,
        get: () => activeSensor(this.store.state).range, set: (v) => this.editActive((s) => { s.range = v; })
      })}
    </section>`;
  }

  private pointsSection(st: PlannerState): TemplateResult {
    const multi = st.sensors.length > 1;
    return html`<section aria-labelledby="h-pts" class=${this.secClass("pts")}>
      <h2 id="h-pts">${this.secToggle("pts", "Test points")} <button type="button" class="btn small primary"
        @click=${() => { let id = 0; this.edit((s) => { id = addPoint(s).id; }); this.select({ kind: "point", id }); }}>Add point</button></h2>
      <div class="list">
        ${st.points.length ? st.points.map((p) => this.pointCard(p, multi)) : html`<p class="empty">No test points yet. Add one, then drag it in the 3D view or type its coordinates.</p>`}
      </div>
    </section>`;
  }

  private pointCard(p: TestPoint, multi: boolean): TemplateResult {
    const r = this.results.get(p.id);
    const cls = r ? pointClass(r) : "out";
    const isSel = this.selection?.kind === "point" && this.selection.id === p.id;
    const coord = (k: "x" | "y" | "z") => html`${this.numField({
      id: `p${k}-${p.id}`, label: k, len: true, unit: k,
      get: () => this.store.state.points.find((q) => q.id === p.id)?.[k] ?? 0,
      set: (v) => this.edit((s) => { const q = s.points.find((x) => x.id === p.id); if (q) { q[k] = v; clampToRoom(s, q); } })
    })}`;
    const label = !r ? "" : r.inside ? (multi && r.seenBy.length > 1 ? "Seen by " + r.seenBy.length : "Detected") : r.blocked ? "Blocked" : "Not detected";
    const u = this.units;
    return html`<div class="card ${cls} ${isSel ? "sel" : ""}">
      <div class="top">
        <input type="text" aria-label="Point name" maxlength="40" ${fieldValue(p.name)}
          @input=${(e: Event) => this.edit((s) => { const q = s.points.find((x) => x.id === p.id); if (q) q.name = (e.target as HTMLInputElement).value; })} />
        <button type="button" class="btn small" title="Select this point to drag it in 3D" @click=${() => this.select({ kind: "point", id: p.id })}>Move</button>
        <button type="button" class="btn small" title="Point the selected sensor at this spot" @click=${() => this.editActive((s) => aimAt(s, p))}>Aim</button>
        <button type="button" class="btn small" aria-label="Remove point" @click=${() => this.edit((s) => { s.points = s.points.filter((x) => x.id !== p.id); })}>✕</button>
      </div>
      <div class="grid3">${coord("x")}${coord("y")}${coord("z")}</div>
      ${r ? html`<div class="status" aria-live="polite">
        <span class="pill ${cls}">${label}</span>
        ${!multi ? (() => {
          const x = r.per[0].result;
          return html`<span class="num" title="Distance from the sensor">${fmtLen(x.range, u)}</span>
            <span class="num" title="Azimuth: + is to the sensor's right">az ${fmt(x.az, 1)}°</span>
            <span class="num" title="Elevation: + is above the sensor's center line">el ${fmt(x.el, 1)}°</span>
            ${x.reasons.length ? html`<span class="why ${x.blocked ? "blocked" : ""}">${x.reasons.map((m) => formatReason(m, u)).join(" · ")}</span>` : nothing}`;
        })() : r.per.map(({ sensor, result: x }) => html`<div class="per">
          <i class="sw" style="background:${sensorCss(sensor)}"></i>
          ${x.inside ? html`<span class="ok">✓</span>` : html`<span class=${x.blocked ? "bl" : "no"}>✕</span>`}
          <span class="txt"><b>${sensor.name || "Sensor"}</b> ${x.inside
            ? `${fmtLen(x.range, u)} · az ${fmt(x.az, 1)}° · el ${fmt(x.el, 1)}°`
            : x.reasons.map((m) => formatReason(m, u)).join(" · ")}</span>
        </div>`)}
      </div>` : nothing}
    </div>`;
  }

  private obstaclesSection(st: PlannerState): TemplateResult {
    return html`<section aria-labelledby="h-obs" class=${this.secClass("obs")}>
      <h2 id="h-obs">${this.secToggle("obs", "Obstacles")}
        <select class="add-sel" aria-label="Add an obstacle" .value=${""} @change=${(e: Event) => {
          const el = e.target as HTMLSelectElement, v = el.value;
          el.value = "";
          let id = 0;
          this.edit((s) => { id = addObstacle(s, v)?.id ?? 0; });
          if (id) this.select({ kind: "box", id });
        }}>
          <option value="">Add box…</option>
          <option value="box">Plain box</option>
          <option value="sofa">Sofa</option>
          <option value="shelf">Bookshelf</option>
          <option value="bed">Bed</option>
          <option value="island">Kitchen island</option>
          <option value="wall">Partition wall</option>
        </select>
      </h2>
      <p class="help">Boxes block the radar completely. Anything in range that no sensor can see in a straight line is a dead spot, shown in purple on points and the coverage slice.</p>
      <div class="list">
        ${st.obstacles.length ? st.obstacles.map((b) => this.boxCard(b)) : html`<p class="empty">No obstacles. Add a box for furniture, a cabinet or a wall that could block the sensors.</p>`}
      </div>
    </section>`;
  }

  private boxCard(b: Obstacle): TemplateResult {
    const isSel = this.selection?.kind === "box" && this.selection.id === b.id;
    const withBox = (fn: (q: Obstacle, s: PlannerState) => void) => this.edit((s) => { const q = s.obstacles.find((x) => x.id === b.id); if (q) fn(q, s); });
    const get = (k: keyof Obstacle) => () => (this.store.state.obstacles.find((x) => x.id === b.id)?.[k] as number) ?? 0;
    const f = (k: "x" | "y" | "z" | "w" | "d" | "h", label: string) => html`<label>${label}${this.numField({
      id: `b${k}-${b.id}`, label, len: true, unit: "", get: get(k),
      set: (v, committed) => withBox((q, s) => {
        q[k] = v;
        if (k === "z") q.z = clamp(v, 0, Math.max(0, ceilAt(ceilPlanes(s.room), q.x, q.y) - q.h));
        else clampBox(s, q);
        if (committed) clampBox(s, q);
      })
    })}</label>`;
    return html`<div class="card box ${isSel ? "sel" : ""}">
      <div class="top three">
        <input type="text" aria-label="Obstacle name" maxlength="40" ${fieldValue(b.name)}
          @input=${(e: Event) => withBox((q) => { q.name = (e.target as HTMLInputElement).value; })} />
        <button type="button" class="btn small" title="Select this box to drag it in 3D" @click=${() => this.select({ kind: "box", id: b.id })}>Move</button>
        <button type="button" class="btn small" aria-label="Remove obstacle" @click=${() => this.edit((s) => { s.obstacles = s.obstacles.filter((x) => x.id !== b.id); })}>✕</button>
      </div>
      <div class="lab-grid">
        ${f("x", "X")}${f("y", "Y")}${f("z", "Bottom")}
        ${f("w", "Width")}${f("d", "Depth")}${f("h", "Height")}
        <label>Rotation °${this.numField({ id: `brot-${b.id}`, label: "Rotation", unit: "", step: 5, d: 1, get: get("rot"), set: (v, c) => withBox((q, s) => { q.rot = v; if (c) clampBox(s, q); }) })}</label>
      </div>
    </div>`;
  }

  private displaySection(st: PlannerState): TemplateResult {
    const v = st.view, imp = this.units === "ftin";
    const check = (k: "clip" | "rings" | "snap" | "slice", label: string) => html`<label class="check">
      <input type="checkbox" .checked=${v[k]} @change=${(e: Event) => this.edit((s) => { s.view[k] = (e.target as HTMLInputElement).checked; })} /> ${label}</label>`;
    return html`<section aria-labelledby="h-disp" class=${this.secClass("disp")}>
      <h2 id="h-disp">${this.secToggle("disp", "Display")}</h2>
      <div class="field">
        <label for="opt-cones">Coverage cones</label>
        <select id="opt-cones" .value=${v.cones} @change=${(e: Event) => this.edit((s) => { s.view.cones = (e.target as HTMLSelectElement).value as "all" | "active"; })}>
          <option value="all">Show every sensor's cone</option>
          <option value="active">Show only the selected sensor's cone</option>
        </select>
      </div>
      ${check("clip", "Clip coverage at the walls and ceiling")}
      ${check("rings", `Show range rings every ${imp ? "3 ft" : "1 m"}`)}
      ${check("snap", `Snap 3D dragging to ${imp ? "1 inch" : "5 cm"}`)}
      ${check("slice", "Show coverage slice")}
      ${this.pair({
        id: "slice-h", label: "Slice height", len: true, min: 0, max: peakZ(st.room), sMin: 0, sMax: peakZ(st.room), sStep: 0.05,
        help: `Colors the room's floor plan at this height by how many sensors see each spot. ${imp ? "3 ft" : "0.9 m"} is roughly a seated person's chest.`,
        get: () => this.store.state.view.sliceH, set: (x) => this.edit((s) => { s.view.sliceH = x; })
      })}
      <div class="row">
        <button type="button" class="btn ${this.resetArmed ? "active" : ""}" @click=${this.onReset}>${this.resetArmed ? "Click again to replace your setup" : "Reset to example room"}</button>
      </div>
      <div class="row">
        <button type="button" class="btn" @click=${this.onExport}>Export JSON</button>
        <button type="button" class="btn" @click=${() => (this.renderRoot.querySelector("#import-file") as HTMLInputElement).click()}>Import JSON</button>
        <button type="button" class="btn" @click=${this.onShare}>Copy share link</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden @change=${this.onImport} />
      </div>
      ${this.flash ? html`<p class="note" role="status">${this.flash}</p>` : nothing}
    </section>`;
  }

  // ---------- file actions ----------
  private onReset = (): void => {
    if (!this.resetArmed) {
      this.resetArmed = window.setTimeout(() => { this.resetArmed = 0; this.requestUpdate(); }, 3000);
      this.requestUpdate();
      return;
    }
    clearTimeout(this.resetArmed);
    this.resetArmed = 0;
    this.reset();
  };

  private onExport = (): void => {
    const blob = new Blob([this.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mmwave-room.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  private onImport = async (e: Event): Promise<void> => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      this.loadState(JSON.parse(await file.text()));
      this.showFlash("Loaded " + file.name);
    } catch {
      this.showFlash(file.name + " isn't a readable room file.");
    }
  };

  private onShare = async (): Promise<void> => {
    const url = location.href.split("#")[0] + "#config=" + encodeShare(this.store.state);
    try {
      await navigator.clipboard.writeText(url);
      this.showFlash("Share link copied.");
    } catch {
      this.showFlash("Couldn't copy automatically. The link is in the address bar.");
      if (this.useHash) history.replaceState(null, "", url);
    }
  };
}
