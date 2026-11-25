import { MmwavePlanner } from "./ui/MmwavePlanner";

// Registers <mmwave-planner>. Safe to load twice (e.g. a docs site that includes the script on several pages).
if (!customElements.get("mmwave-planner")) customElements.define("mmwave-planner", MmwavePlanner);

export { MmwavePlanner };
export * from "./model";

declare global {
  interface HTMLElementTagNameMap {
    "mmwave-planner": MmwavePlanner;
  }
}
