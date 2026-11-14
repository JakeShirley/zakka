import {
  createPageDocument,
  getBuiltInBackground,
  renderPageDocumentSvg,
} from "@zakka/editor-core";
import { useId, useMemo } from "react";

import { resolveBrowserBackgroundHref } from "./backgroundHrefs";

// Two inches at 300 dpi, so pattern tiles read at roughly the size they print.
const swatchSize = 600;

/** A square preview of a built-in or custom background. */
export function BackgroundSwatch({
  backgroundId,
  thumbnailUrl,
}: {
  backgroundId: string;
  thumbnailUrl?: string | undefined;
}) {
  const idPrefix = useId();
  const builtIn = getBuiltInBackground(backgroundId);
  const svg = useMemo(() => {
    if (!builtIn || builtIn.kind === "texture") {
      return null;
    }

    const document = createPageDocument({
      canvas: {
        width: swatchSize,
        height: swatchSize,
        backgroundColor: builtIn.baseColor,
        background: {
          backgroundId,
          x: 0,
          y: 0,
          width: swatchSize,
          height: swatchSize,
          scale: 1,
        },
      },
    });

    return renderPageDocumentSvg(document, { idPrefix });
  }, [backgroundId, builtIn, idPrefix]);

  if (svg) {
    return (
      <span
        className="background-swatch"
        aria-hidden="true"
        /* biome-ignore lint/security/noDangerouslySetInnerHtml: Rendered by editor-core from a built-in catalog entry. */
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  const src = thumbnailUrl ?? resolveBrowserBackgroundHref(backgroundId, "thumbnail");

  return (
    <span
      className="background-swatch"
      aria-hidden="true"
      style={builtIn ? { backgroundColor: builtIn.baseColor } : undefined}
    >
      {src ? <img src={src} alt="" draggable={false} loading="lazy" /> : null}
    </span>
  );
}
