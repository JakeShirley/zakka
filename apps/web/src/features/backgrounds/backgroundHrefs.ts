import {
  builtInBackgroundIdPrefix,
  getBuiltInBackground,
  getCustomBackgroundStorageId,
} from "@zakka/editor-core";

/** Same-origin URL for a textured built-in or custom library background, or null when drawn inline. */
export const resolveBrowserBackgroundHref = (
  backgroundId: string,
  variant: "content" | "thumbnail" = "content",
): string | null => {
  const customId = getCustomBackgroundStorageId(backgroundId);

  if (customId) {
    return `/api/v1/custom-backgrounds/${customId}/${variant}`;
  }

  const builtIn = getBuiltInBackground(backgroundId);

  if (builtIn?.kind === "texture") {
    const slug = backgroundId.slice(builtInBackgroundIdPrefix.length);
    return `/api/v1/backgrounds/builtin/${slug}/${variant}`;
  }

  return null;
};
