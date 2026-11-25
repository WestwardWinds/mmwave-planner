import { css } from "lit";

// Theming: every color is a custom property on :host. The light palette is the default;
// [scheme="dark"] (set by the component from the page theme or the OS) swaps in the dark one.
// Pages can override any token from outside, e.g. mmwave-planner { --accent: #c05; }.
// Layout: one-screen instrument — 3D viewport plus a 360px control rail; stacks below 820px of component width.
export const styles = css`
  :host {
    --bg: #eef1f5; --panel: #fbfcfd; --line: #d5dbe3; --fg: #17202b; --muted: #5b6676;
    --accent: #0b7f8c; --accent-soft: #d9eef0; --in: #1b8a4b; --out: #c93c3c;
    --scene-bg: #e6eaf0; --floor: #dde3ea; --grid: #c3ccd7; --grid-major: #a7b2bf; --room-edge: #6f7b8a;
    --s1: #0b8f9e; --s2: #d0711f; --s3: #3366cc; --s4: #c2408a; --overlap: #1f2a5c;
    --obstacle: #8b7d6b; --blocked: #7b4fc9; --ax-x: #d04848; --ax-y: #3a6fd6; --ax-z: #2f9a4f;
    --chip-bg: rgba(251, 252, 253, 0.9);
    --font-ui: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-num: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;

    display: block;
    position: relative;
    height: var(--mmwave-height, 680px);
    min-height: 420px;
    container-type: inline-size;
    color-scheme: light;
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.4 var(--font-ui);
    border-radius: var(--mmwave-radius, 0);
    overflow: hidden;
  }
  :host([scheme="dark"]) {
    --bg: #0e1217; --panel: #141920; --line: #28313c; --fg: #e2e7ee; --muted: #8b97a6;
    --accent: #3cc3cf; --accent-soft: #123238; --in: #3fca7a; --out: #f06a6a;
    --scene-bg: #0b0f14; --floor: #131a22; --grid: #1f2832; --grid-major: #2e3946; --room-edge: #6b7787;
    --s1: #33c0cc; --s2: #f0954a; --s3: #7aa2ff; --s4: #ef6fb6; --overlap: #f3efe4;
    --obstacle: #8f8270; --blocked: #b28cff; --ax-x: #f06a6a; --ax-y: #6b9cff; --ax-z: #4fd07f;
    --chip-bg: rgba(20, 25, 32, 0.88);
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }

  /* full screen: [full] is set in browser full screen and in the window-filling fallback ([expanded]) */
  /* !important because the embedding page's own rules (margins, sizes) outrank :host styles */
  :host([full]) { height: 100dvh !important; width: 100vw !important; max-width: none !important; min-height: 0 !important; border-radius: 0 !important; }
  /* the fallback is shown as a manual popover (top layer); these also undo the browser's default popover box */
  :host([expanded]) {
    position: fixed !important; inset: 0 !important; z-index: 2147483000 !important; margin: 0 !important;
    padding: 0 !important; border: 0 !important; max-height: none !important; background: var(--bg) !important; overflow: hidden !important;
  }
  .fs-btn { display: inline-flex; align-items: center; gap: 6px; }
  .fs-btn svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

  .app { display: grid; grid-template-columns: minmax(0, 1fr) 360px; height: 100%; }
  :host([hide-panel]) .app { grid-template-columns: minmax(0, 1fr); }
  :host([hide-panel]) .panel { display: none; }
  .viewport { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--scene-bg); }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
  .labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .lbl { position: absolute; left: 0; top: 0; white-space: nowrap; font: 500 11px/1.2 var(--font-num); color: var(--fg);
    background: var(--chip-bg); border: 1px solid var(--line); padding: 2px 6px; border-radius: 4px; }
  .lbl.axis { background: none; border: none; font-weight: 600; font-size: 12px; padding: 0; }
  .lbl.dim { background: none; border: none; color: var(--muted); padding: 0; }
  .lbl.in { border-color: var(--in); }
  .lbl.out { border-color: var(--out); }
  .lbl.blocked { border-color: var(--blocked); }
  .lbl.sensor { border-width: 2px; }
  .lbl.active { font-weight: 600; }
  .lbl.box { border-color: var(--obstacle); color: var(--muted); }
  .lbl.sel { font-weight: 600; box-shadow: 0 0 0 2px var(--accent); }

  .toolbar { position: absolute; top: 12px; left: 12px; max-width: calc(100% - 230px); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .seg { display: inline-flex; background: var(--chip-bg); border: 1px solid var(--line); border-radius: 8px; padding: 2px; }
  .seg button { font: 500 12px var(--font-ui); color: var(--muted); background: none; border: 0; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
  .seg button:hover { color: var(--fg); }
  .seg button[aria-pressed="true"] { background: var(--accent-soft); color: var(--fg); }
  .hint { font-size: 12px; color: var(--muted); background: var(--chip-bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
  .summary { position: absolute; left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; gap: 8px; max-width: calc(100% - 24px); }
  .chip { font: 500 12px var(--font-ui); background: var(--chip-bg); border: 1px solid var(--line); border-radius: 999px; padding: 5px 11px; font-variant-numeric: tabular-nums; }
  .legend { position: absolute; right: 12px; top: 12px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted);
    background: var(--chip-bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  .legend span, .legend-inline span { display: flex; align-items: center; gap: 6px; }
  .legend-inline { display: none; }
  .sw { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
  .sw.sq { border-radius: 2px; }
  .sw.split { border-radius: 2px; background: linear-gradient(90deg, var(--s1) 0 50%, var(--s2) 50% 100%); }

  .panel { min-width: 0; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--line); padding: 16px 16px 32px; }
  header { display: flex; flex-direction: column; gap: 2px; padding-bottom: 12px; }
  h1 { font-size: 17px; font-weight: 600; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
  .sub { color: var(--muted); font-size: 12px; margin: 0; }
  section { border-top: 1px solid var(--line); padding-block: 14px; display: flex; flex-direction: column; gap: 10px; }
  h2 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0;
    display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .sec-toggle { display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0; margin: -4px 0; padding: 4px 0;
    background: none; border: 0; font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit; text-align: left; cursor: pointer; }
  .sec-toggle:hover { color: var(--fg); }
  .sec-toggle svg { width: 10px; height: 10px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.15s; }
  .sec-toggle[aria-expanded="false"] svg { transform: rotate(-90deg); }
  /* a folded section keeps only its header row */
  section.collapsed { gap: 0; }
  section.collapsed > :not(h2) { display: none !important; }
  h2 .act-name { text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 12px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .field > label { font-size: 12px; color: var(--muted); }
  .field > label b { color: var(--fg); font-weight: 500; }
  .pair { display: grid; grid-template-columns: minmax(0, 1fr) 74px; gap: 8px; align-items: center; }
  .help { font-size: 11px; color: var(--muted); margin: 0; }
  input[type="number"], input[type="text"], select {
    width: 100%; min-width: 0; font: 500 13px var(--font-num); color: var(--fg); background: var(--bg);
    border: 1px solid var(--line); border-radius: 6px; padding: 6px 7px; font-variant-numeric: tabular-nums; }
  input[type="text"], select { font-family: var(--font-ui); }
  input.num-text { font-family: var(--font-num); }
  input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  input[type="range"] { width: 100%; accent-color: var(--accent); }
  .unitwrap { position: relative; }
  .unitwrap input { padding-right: 22px; }
  .unitwrap i { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); font-style: normal; font-size: 11px; color: var(--muted); pointer-events: none; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .btn { font: 500 12px var(--font-ui); color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
  .btn:hover { border-color: var(--accent); }
  .btn:disabled { opacity: 0.45; cursor: default; border-color: var(--line); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--panel); }
  .btn.small { padding: 4px 8px; font-size: 11px; }
  .btn.active { border-color: var(--accent); background: var(--accent-soft); }
  .units { align-self: flex-start; margin-top: 8px; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
  .check input { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; }
  .add-sel { width: auto; font: 500 12px var(--font-ui); padding: 4px 6px; text-transform: none; letter-spacing: 0; }

  .sensor-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
  .stab { display: inline-flex; align-items: center; gap: 6px; font: 500 12px var(--font-ui); padding: 5px 10px; border: 1px solid var(--line);
    border-radius: 999px; background: var(--bg); color: var(--fg); cursor: pointer; max-width: 100%; }
  .stab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stab[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); font-weight: 600; }
  .name-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; }

  .list { display: flex; flex-direction: column; gap: 8px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; border-left-width: 4px; }
  .card.in { border-left-color: var(--in); }
  .card.out { border-left-color: var(--out); }
  .card.blocked { border-left-color: var(--blocked); }
  .card.box { border-left-color: var(--obstacle); }
  .card.sel { box-shadow: 0 0 0 2px var(--accent-soft); border-color: var(--accent); }
  .card .top { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 6px; align-items: center; }
  .card .top.three { grid-template-columns: minmax(0, 1fr) auto auto; }
  .lab-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 8px; }
  .lab-grid label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); min-width: 0; }
  .status { font-size: 12px; font-variant-numeric: tabular-nums; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
  .pill { font: 600 10px var(--font-ui); text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 7px; border-radius: 999px; color: var(--panel); }
  .pill.in { background: var(--in); }
  .pill.out { background: var(--out); }
  .pill.blocked { background: var(--blocked); }
  .status .num { font-family: var(--font-num); font-size: 11px; color: var(--muted); }
  .status .why { width: 100%; color: var(--out); font-size: 11px; }
  .status .why.blocked { color: var(--blocked); }
  .per { width: 100%; display: flex; gap: 6px; align-items: baseline; font-size: 11px; color: var(--muted); min-width: 0; }
  .per .sw { width: 8px; height: 8px; align-self: center; }
  .per b { color: var(--fg); font-weight: 500; }
  .per .ok { color: var(--in); }
  .per .no { color: var(--out); }
  .per .bl { color: var(--blocked); }
  .per .txt { min-width: 0; overflow-wrap: anywhere; }
  .empty { font-size: 12px; color: var(--muted); margin: 0; }
  .note { font-size: 12px; color: var(--accent); }
  .fail { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; color: var(--muted); }

  /* standalone page on a phone: the page grows and scrolls past the 3D view to the controls (as in v5) */
  @media (max-width: 820px) {
    :host([page]) { height: auto; min-height: 100dvh; overflow: visible; }
    :host([page]) .app { height: auto; grid-template-rows: 58vh auto; }
    :host([page]) .panel { overflow: visible; }
    /* ...but in full screen it stays one screen: 3D view on top, scrolling controls below */
    :host([page][full]) { height: 100dvh; overflow: hidden; }
    :host([page][full]) .app { height: 100%; grid-template-rows: 55% 45%; }
    :host([page][full]) .panel { overflow-y: auto; }
  }
  @container (max-width: 820px) {
    .app { grid-template-columns: minmax(0, 1fr); grid-template-rows: 55% 45%; }
    :host([hide-panel]) .app { grid-template-rows: 100%; }
    .panel { border-left: 0; border-top: 1px solid var(--line); }
    .legend { display: none; }
    .legend-inline { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: var(--muted); padding-bottom: 12px; }
    .toolbar { max-width: calc(100% - 24px); }
    .hint { display: none; }
    .viewport.has-sel .hint { display: block; }
    input[type="number"], input[type="text"], select { font-size: 16px; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
