import type { WashiTapeDesign } from "@zakka/editor-core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiClient } from "../../apiClient";
import { getErrorMessage } from "../../lib/errors";
import type { Asset, CustomWashiTape } from "../../types";

export type WashiTapeDraft = { name: string; design: WashiTapeDesign };

/**
 * Loads the account's saved washi tapes plus the photo library, which custom-photo tapes need
 * both to render previews and to pick a pattern photo while designing.
 */
export function useWashiTapeLibrary() {
  const [customWashiTapes, setCustomWashiTapes] = useState<CustomWashiTape[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    Promise.all([apiClient.listCustomWashiTapes(), apiClient.listAssets()])
      .then(([washiTapeResponse, assetResponse]) => {
        if (isCancelled) return;
        setCustomWashiTapes(washiTapeResponse.washiTapes);
        setAssets(assetResponse.assets);
      })
      .catch((loadError: unknown) => {
        if (!isCancelled) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const createWashiTape = useCallback(async (draft: WashiTapeDraft) => {
    const created = await apiClient.createCustomWashiTape(draft);
    setCustomWashiTapes((current) => [created, ...current]);
    return created;
  }, []);

  const updateWashiTape = useCallback(async (washiTapeId: string, draft: WashiTapeDraft) => {
    const updated = await apiClient.updateCustomWashiTape(washiTapeId, draft);
    setCustomWashiTapes((current) =>
      current.map((washiTape) => (washiTape.id === updated.id ? updated : washiTape)),
    );
    return updated;
  }, []);

  const deleteWashiTape = useCallback(async (washiTapeId: string) => {
    await apiClient.deleteCustomWashiTape(washiTapeId);
    setCustomWashiTapes((current) => current.filter((washiTape) => washiTape.id !== washiTapeId));
  }, []);

  return {
    assetById,
    assets,
    createWashiTape,
    customWashiTapes,
    deleteWashiTape,
    error,
    isLoading,
    setError,
    updateWashiTape,
  };
}
