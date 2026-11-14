import { useCallback, useEffect, useState } from "react";

import { apiClient } from "../../apiClient";
import { getErrorMessage } from "../../lib/errors";
import type { CustomBackground } from "../../types";

export const supportedBackgroundAccept =
  "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,image/svg+xml";

/** Loads the account's custom backgrounds (uploads and imports) and keeps them in sync with edits. */
export function useBackgroundLibrary() {
  const [customBackgrounds, setCustomBackgrounds] = useState<CustomBackground[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  useEffect(() => {
    let isCancelled = false;

    apiClient
      .listCustomBackgrounds()
      .then((response) => {
        if (isCancelled) return;
        // Keep backgrounds uploaded while this initial load was still in flight.
        setCustomBackgrounds((current) => {
          const loadedIds = new Set(response.backgrounds.map((background) => background.id));
          return [
            ...current.filter((background) => !loadedIds.has(background.id)),
            ...response.backgrounds,
          ];
        });
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

  /** Uploads files one at a time and returns the backgrounds that were saved. */
  const uploadBackgrounds = useCallback(async (files: File[]) => {
    const uploaded: CustomBackground[] = [];
    const failures: string[] = [];

    setError(null);
    setUploadProgress(0);

    for (const [index, file] of files.entries()) {
      try {
        const background = await apiClient.uploadCustomBackground(file, {
          onProgress: (fileProgress) => {
            setUploadProgress((index + (fileProgress ?? 0)) / files.length);
          },
        });
        uploaded.push(background);
      } catch (uploadError: unknown) {
        failures.push(`${file.name}: ${getErrorMessage(uploadError)}`);
      }
    }

    if (uploaded.length > 0) {
      const uploadedIds = new Set(uploaded.map((background) => background.id));
      setCustomBackgrounds((current) => [
        ...uploaded,
        ...current.filter((background) => !uploadedIds.has(background.id)),
      ]);
    }

    setError(failures.length > 0 ? failures.join(" ") : null);
    setUploadProgress(null);

    return uploaded;
  }, []);

  const renameBackground = useCallback(async (backgroundId: string, name: string) => {
    const updated = await apiClient.renameCustomBackground(backgroundId, { name });
    setCustomBackgrounds((current) =>
      current.map((background) => (background.id === updated.id ? updated : background)),
    );
    return updated;
  }, []);

  const deleteBackground = useCallback(async (backgroundId: string) => {
    await apiClient.deleteCustomBackground(backgroundId);
    setCustomBackgrounds((current) =>
      current.filter((background) => background.id !== backgroundId),
    );
  }, []);

  return {
    customBackgrounds,
    deleteBackground,
    error,
    isLoading,
    renameBackground,
    setError,
    uploadBackgrounds,
    uploadProgress,
  };
}
