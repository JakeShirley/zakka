import type { WashiTapeDesign } from "@zakka/editor-core";

import type { Repositories } from "./persistence/repositories.js";

export type WashiTapeDesignValidation = "ok" | "photo_required" | "asset_not_found";

export const validateWashiTapeDesign = (
  accountId: string,
  design: WashiTapeDesign,
  repositories: Repositories,
): WashiTapeDesignValidation => {
  if (design.pattern.kind === "customPhoto" && !design.pattern.assetId) {
    return "photo_required";
  }

  if (
    design.pattern.assetId &&
    !repositories.assets.findByIdForAccount(accountId, design.pattern.assetId)
  ) {
    return "asset_not_found";
  }

  return "ok";
};

export const washiTapeDesignErrorMessages: Record<
  Exclude<WashiTapeDesignValidation, "ok">,
  string
> = {
  photo_required: "Custom photo washi tape needs a pattern photo",
  asset_not_found: "Washi tape pattern photos must be assets owned by the account",
};
