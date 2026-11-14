import type { PageLayer } from "@zakka/editor-core";

export type CanvasPoint = { x: number; y: number };
export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export type TransformMode = "move" | "resize" | "rotate" | "pan";

export type ActiveTransform = {
  center: CanvasPoint;
  handle: ResizeHandle | undefined;
  layerId: string;
  mode: TransformMode;
  pointerId: number;
  startClientPointer: CanvasPoint;
  startLayer: PageLayer;
  startPointer: CanvasPoint;
  startPointerAngle: number;
};

export type EditorSaveStatus = "loading" | "saved" | "unsaved" | "saving" | "error";
