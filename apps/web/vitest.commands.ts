import type {} from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";

type Modifier = "Alt" | "Control" | "Meta" | "Shift";

export type PointerDragOptions = {
  /** Playwright selector (use `locator.selector`) for the element to press on. */
  selector: string;
  /** Playwright selector for the element whose size scales `by`, usually the page canvas. */
  relativeTo: string;
  /** Where to press inside the target, as a fraction of its box. Defaults to the center. */
  at?: { x: number; y: number };
  /** How far to move, as a fraction of the `relativeTo` box. */
  by: { x: number; y: number };
  modifiers?: Modifier[];
  steps?: number;
};

/**
 * Drives a real mouse press-move-release through Playwright, so hit testing, pointer capture,
 * and z-order behave exactly as they do for users. Distances are fractions of a reference element
 * so assertions stay independent of the iframe scale Vitest applies.
 */
export const pointerDrag: BrowserCommand<[PointerDragOptions]> = async (context, options) => {
  if (context.provider.name !== "playwright") {
    throw new Error("pointerDrag requires the Playwright browser provider");
  }

  const { page, iframe } = context;
  const [targetBox, referenceBox] = await Promise.all([
    iframe.locator(options.selector).first().boundingBox(),
    iframe.locator(options.relativeTo).first().boundingBox(),
  ]);

  if (!targetBox || !referenceBox) {
    throw new Error(`pointerDrag could not measure ${options.selector}`);
  }

  const startX = targetBox.x + targetBox.width * (options.at?.x ?? 0.5);
  const startY = targetBox.y + targetBox.height * (options.at?.y ?? 0.5);
  const endX = startX + referenceBox.width * options.by.x;
  const endY = startY + referenceBox.height * options.by.y;
  const modifiers = options.modifiers ?? [];

  for (const modifier of modifiers) await page.keyboard.down(modifier);
  try {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: options.steps ?? 8 });
    await page.mouse.up();
  } finally {
    for (const modifier of modifiers) await page.keyboard.up(modifier);
  }
};
