# mmWave Coverage Planner

A 3D planner for mmWave presence sensors. Set up a room (flat, single-pitch or gable ceiling), place one or more sensors, add furniture that blocks the radar, and see:

- each sensor's coverage cone, from its field of view, max distance, pan, tilt and roll
- where sensors overlap, on a floor-plan "coverage slice" at any height
- dead spots: in range, but hidden behind an obstacle
- whether named test points are detected, and if not, why

It ships as a standards-based web component, `<mmwave-planner>`, so the same build works as its own page or inside any docs site.

## Develop

```sh
npm install
npm run dev        # standalone page at http://localhost:5173, embed demo at /examples/embed.html
npm test           # model tests (Vitest)
npm run build      # typecheck, then dist/ (site) and dist-lib/mmwave-planner.js (embeddable bundle)
```

## Embed it

Copy `dist-lib/mmwave-planner.js` into your site's static files and load it once:

```html
<script type="module" src="/js/mmwave-planner.js"></script>

<!-- a room from a JSON file (export one from the planner's "Export JSON" button) -->
<mmwave-planner src="/rooms/living-room.json"></mmwave-planner>

<!-- or inline -->
<mmwave-planner>
  <script type="application/json">{ "room": { "w": 4, "d": 3, "h": 2.4 } }</script>
</mmwave-planner>
```

Most docs generators (Docusaurus, VitePress, MkDocs Material, Hugo) let you drop raw HTML into a Markdown page, so the tag above works as-is.

| Attribute | What it does |
|---|---|
| `src="url"` | Load the starting setup from a JSON file. |
| `persist` or `persist="key"` | Remember the visitor's edits in `localStorage` (default key `mmwave-planner`). |
| `use-hash` | Read a setup from a `#config=...` share link, and let "Copy share link" update the address bar. |
| `theme="auto\|light\|dark"` | `auto` (default) follows `html[data-theme]` (Docusaurus), `html.dark` (VitePress), then the OS. |
| `hide-panel` | Show only the 3D view, for illustrations. |
| `page` | Standalone-page layout: on phones the page scrolls past the 3D view to the controls instead of fitting one fixed-height box. |

Starting setup, first match wins: a `state` assigned from JavaScript, a `#config=` share link (with `use-hash`), the visitor's saved edits (with `persist`), inline JSON, `src`, then the built-in example room.

Size and look are set with CSS custom properties:

```css
mmwave-planner {
  --mmwave-height: 600px;   /* default 680px; the standalone page uses 100dvh */
  --mmwave-radius: 8px;
  --accent: #c05;           /* any color token in src/ui/styles.ts can be overridden */
}
```

JavaScript API: `el.state` (a copy of the setup; assign to replace it), `el.reset()`, `el.exportJSON()`, `el.toggleFullscreen()`, and a `change` event whose `detail` is the new setup.

### Full screen

The toolbar's **Full screen** button uses the browser's full screen mode. Where that isn't available (iPhone Safari, or an `<iframe>` without `allowfullscreen`) the planner fills the browser window instead. Esc, or **Exit full screen**, returns it to its place on the page.

## Publish on GitHub Pages

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to `main`. One-time setup on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site appears at `https://<your-user>.github.io/<repo>/`, with the embed demo at `.../examples/embed.html`.

## Project layout

```
src/
  model/   pure TypeScript, no DOM: units, ceiling shape, radar math, line of sight,
           classification, coverage grid, presets, JSON validation, state edits
  scene/   three.js view: room, sensor cones, points, obstacles, coverage slice, labels, dragging
  ui/      the <mmwave-planner> Lit component and its styles
  index.ts registers the element and re-exports the model
test/      Vitest suites for src/model
examples/  embed.html (docs-site style demo); public/examples/*.json sample rooms
```

The model is the source of truth: the scene and panel only display it, and every change goes through `src/model/edits.ts`. The cone drawn in 3D is built from the same angles `classifyFor()` tests, so what you see is what is computed.

### Adding a sensor model

Add an entry to `SENSOR_MODELS` in `src/model/presets.ts` (field of view, range and a short note). It appears in the "Sensor model" menu.

## How detection is decided

A spot is in a sensor's cone when it is within max distance, its azimuth `atan2(right, forward)` is within ±HFOV/2, and its elevation `asin(up / range)` is within ±VFOV/2, all in the sensor's own frame. It is detected when the straight line from the sensor to it also misses every obstacle box. This is a rough guide: real radar partly passes through thin furniture and reflects off walls.

Sensor presets: LD2450 values (±60° × ±35°, 6 m) are from Hi-Link's manual. LD2412 listings give a single ±75° angle and 9 m, applied to both axes.
