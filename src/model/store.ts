import { cloneState, parseState } from "./serialize";
import type { PlannerState } from "./types";

export type Listener = (state: PlannerState) => void;

/** Holds the planner state; `update` mutates it and tells subscribers once. */
export class Store {
  private listeners = new Set<Listener>();
  constructor(public state: PlannerState) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(mutate?: (s: PlannerState) => void): void {
    mutate?.(this.state);
    for (const fn of this.listeners) fn(this.state);
  }

  /** Replace the whole state (load, import, reset). Input is validated. */
  replace(next: unknown): void {
    this.state = parseState(next);
    this.update();
  }

  snapshot(): PlannerState {
    return cloneState(this.state);
  }
}
