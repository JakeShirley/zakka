import {
  createPageDocument,
  createWashiTapeLayer,
  renderPageDocumentSvg,
  type WashiTapeDesign,
} from "@zakka/editor-core";
import { useId, useMemo } from "react";

import type { Asset } from "../../types";
import { resolveBrowserWashiTapeHref } from "../editor/PageCanvas";

// Matches the size of tape added to a full page so tile scale reads the same as on the canvas.
const previewCanvas = { width: 1200, height: 320, backgroundColor: "#ffffff" };
const previewTape = { x: 40, y: 50, width: 1120, height: 220 };

export function WashiTapePreview({
  assetById,
  design,
}: {
  assetById: Map<string, Asset>;
  design: WashiTapeDesign;
}) {
  const idPrefix = useId();
  const svg = useMemo(() => {
    const layer = createWashiTapeLayer({
      ...previewTape,
      id: "washi-preview",
      opacity: 0.92,
      outline: design.outline,
      pattern: design.pattern,
      rotation: 0,
      tile: design.tile,
    });

    return renderPageDocumentSvg(createPageDocument({ canvas: previewCanvas, layers: [layer] }), {
      idPrefix,
      includeBackground: false,
      resolveWashiTapeHref: (washiLayer) => resolveBrowserWashiTapeHref(assetById, washiLayer),
    });
  }, [assetById, design, idPrefix]);

  return (
    <span
      className="washi-tape-preview"
      aria-hidden="true"
      /* biome-ignore lint/security/noDangerouslySetInnerHtml: Generated from a schema-validated design and escaped by editor-core. */
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
