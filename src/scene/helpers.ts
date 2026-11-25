import { BufferGeometry, Color, Float32BufferAttribute, Line, LineBasicMaterial, Vector3 } from "three";
import type { Vec3 } from "../model/types";

// User frame (X width, Y depth, Z up) <-> three.js (Y up). (x, y, z) -> (x, z, -y) is a proper rotation.
export const U2T = (x: number, y: number, z: number): Vector3 => new Vector3(x, z, -y);
export const V2T = (a: Vec3): Vector3 => new Vector3(a[0], a[2], -a[1]);
export const T2U = (v: Vector3) => ({ x: v.x, y: -v.z, z: v.y });

export function lineGeom(arr: number[] | Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(arr, 3));
  return g;
}

/** A vertical line from an object down to the floor: a depth cue. */
export function makeDrop(mat: LineBasicMaterial): Line {
  return new Line(lineGeom(new Float32Array(6)), mat);
}

export function setDrop(line: Line, p: { x: number; y: number; z: number }): void {
  const a = line.geometry.attributes.position;
  const top = U2T(p.x, p.y, p.z), bot = U2T(p.x, p.y, 0);
  a.setXYZ(0, top.x, top.y, top.z);
  a.setXYZ(1, bot.x, bot.y, bot.z);
  a.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}

/** Colors read from the component's CSS custom properties, so the 3D view follows the page theme. */
export const THEME_KEYS = [
  "scene-bg", "floor", "grid", "grid-major", "room-edge", "in", "out", "blocked", "overlap",
  "obstacle", "accent", "ax-x", "ax-y", "ax-z", "s1", "s2", "s3", "s4"
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export type Theme = Record<ThemeKey, Color>;

export function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const t = {} as Theme;
  for (const k of THEME_KEYS) t[k] = new Color(cs.getPropertyValue("--" + k).trim() || "#888888");
  return t;
}

export const sensorColor = (theme: Theme, s: { color: number }): Color => theme[("s" + (s.color || 1)) as ThemeKey];
export const sensorCss = (s: { color: number }): string => "var(--s" + (s.color || 1) + ")";

/** An HTML label that the scene positions over the canvas each frame. */
export interface Label {
  el: HTMLDivElement;
  anchor: () => Vector3 | null;
}
