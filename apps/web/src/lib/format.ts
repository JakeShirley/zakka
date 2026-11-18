import type { Asset } from "../types";

export const formatBytes = (byteSize: number): string => {
  if (byteSize < 1024) {
    return `${byteSize} B`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(1)} KB`;
  }

  if (byteSize < 1024 * 1024 * 1024) {
    return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(byteSize / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const formatDimensions = (asset: Asset): string => {
  if (!asset.width || !asset.height) {
    return "Unknown size";
  }

  return `${asset.width} x ${asset.height}`;
};
