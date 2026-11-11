import { commands, type Locator, page } from "vitest/browser";

import type { PointerDragOptions } from "../../vitest.commands";

declare module "vitest/browser" {
  interface BrowserCommands {
    pointerDrag: (options: PointerDragOptions) => Promise<void>;
  }
}

type DragOptions = Pick<PointerDragOptions, "at" | "modifiers" | "steps">;

export const canvasLocator = (): Locator =>
  page.getByRole("group", { name: "Editable page canvas" });

/** Real mouse drag; `by` is a fraction of the canvas size, so 0.1 means 10% of the page. */
export async function dragOnCanvas(
  target: Locator,
  by: { x: number; y: number },
  options: DragOptions = {},
): Promise<void> {
  await commands.pointerDrag({
    ...options,
    by,
    relativeTo: canvasLocator().selector,
    selector: target.selector,
  });
}

export function layerElement(layerId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `.canvas-layer[data-layer-id="${CSS.escape(layerId)}"]`,
  );

  if (!element) throw new Error(`Canvas layer ${layerId} is not rendered`);

  return element;
}

/** The clickable hitbox users press to select and drag a layer. */
export const layerHitbox = (layerId: string): Locator =>
  page.elementLocator(layerElement(layerId).querySelector(".canvas-layer-hitbox") as Element);

/** A transform handle (resize, crop, rotate, pan) that belongs to the given layer. */
export const layerHandle = (layerId: string, name: string): Locator =>
  page.elementLocator(layerElement(layerId)).getByRole("button", { name, exact: true });
