import { noChange } from "lit";
import { Directive, directive, PartType, type ElementPart, type PartInfo } from "lit/directive.js";

/**
 * Sets an <input>'s value from state, except while the user has it focused, so a re-render never
 * rewrites what they are typing (e.g. "4." would otherwise snap back to "4").
 * Usage: <input ${fieldValue(text)}>
 */
class FieldValue extends Directive {
  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error("fieldValue() must be used as an element directive");
  }
  render(_value: string) {
    return noChange;
  }
  update(part: ElementPart, [value]: [string]) {
    const el = part.element as HTMLInputElement;
    const root = el.getRootNode() as Document | ShadowRoot;
    if (root.activeElement !== el && el.value !== value) el.value = value;
    return noChange;
  }
}

export const fieldValue = directive(FieldValue);
