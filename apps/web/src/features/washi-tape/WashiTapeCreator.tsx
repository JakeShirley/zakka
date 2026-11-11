import { Button, Field, Input } from "@fluentui/react-components";
import { SaveRegular } from "@fluentui/react-icons";
import {
  createWashiTapeLayer,
  type WashiTapeDesign,
  type WashiTapeLayer,
} from "@zakka/editor-core";
import { type FormEvent, useState } from "react";
import { createPortal } from "react-dom";

import { getErrorMessage } from "../../lib/errors";
import type { Asset } from "../../types";
import { PhotoPickerModal } from "../editor/PhotoPickerModal";
import { formatWashiTapePattern, WashiTapeControls } from "../editor/WashiTapeControls";
import type { WashiTapeDraft } from "./useWashiTapeLibrary";
import { WashiTapePreview } from "./WashiTapePreview";

export const defaultWashiTapeDesign: WashiTapeDesign = {
  outline: "torn",
  pattern: { kind: "polkaDot", primaryColor: "#fffdf7", secondaryColor: "#79a9a4" },
  tile: { scale: 1, scaleX: 1, scaleY: 1, rotation: 0, offsetX: 0, offsetY: 0 },
};

const toDraftLayer = (design: WashiTapeDesign): WashiTapeLayer =>
  createWashiTapeLayer({ id: "washi-tape-creator", ...design });

const toDesign = (layer: WashiTapeLayer): WashiTapeDesign => ({
  outline: layer.outline,
  pattern: layer.pattern,
  tile: layer.tile,
});

export function WashiTapeCreator({
  assetById,
  assets,
  initialDesign = defaultWashiTapeDesign,
  initialName = "",
  showHeading = true,
  submitLabel = "Save to gallery",
  title = "Create custom washi tape",
  onCancel,
  onPhotoPickerOpenChange,
  onSubmit,
}: {
  assetById: Map<string, Asset>;
  assets: Asset[];
  initialDesign?: WashiTapeDesign;
  initialName?: string;
  showHeading?: boolean;
  submitLabel?: string;
  title?: string;
  onCancel: () => void;
  /** Lets a host modal ignore Escape while the stacked photo picker is open. */
  onPhotoPickerOpenChange?: (isOpen: boolean) => void;
  onSubmit: (draft: WashiTapeDraft) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [layer, setLayer] = useState(() => toDraftLayer(initialDesign));
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const design = toDesign(layer);
  const suggestedName = `${formatWashiTapePattern(layer.pattern.kind)} washi tape`;
  const needsPhoto = layer.pattern.kind === "customPhoto" && !layer.pattern.assetId;

  const setPhotoPickerOpen = (isOpen: boolean) => {
    setIsPhotoPickerOpen(isOpen);
    onPhotoPickerOpenChange?.(isOpen);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (needsPhoto || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      await onSubmit({ name: name.trim() || suggestedName, design });
    } catch (submitError) {
      setError(getErrorMessage(submitError));
      setIsSaving(false);
    }
  };

  return (
    <form className="washi-tape-creator" aria-label={title} onSubmit={submit}>
      {showHeading ? (
        <div className="washi-tape-creator-heading">
          <h4>{title}</h4>
        </div>
      ) : null}
      <div className="washi-tape-creator-body">
        <div className="washi-tape-creator-preview-column">
          <div className="washi-tape-creator-preview">
            <WashiTapePreview assetById={assetById} design={design} />
          </div>
          <Field label="Name">
            <Input
              value={name}
              placeholder={suggestedName}
              maxLength={120}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          {needsPhoto ? (
            <p className="washi-tape-creator-hint">Choose a photo to use as the pattern.</p>
          ) : null}
          {error ? (
            <p className="panel-alert" role="alert">
              {error}
            </p>
          ) : null}
          <div className="washi-tape-creator-actions">
            <Button type="button" className="secondary-button" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              type="submit"
              className="primary-button"
              disabled={needsPhoto || isSaving}
              icon={<SaveRegular />}
            >
              {isSaving ? "Saving" : submitLabel}
            </Button>
          </div>
        </div>
        <div className="inspector-form washi-tape-creator-controls">
          <WashiTapeControls
            layer={layer}
            onChange={(update) => setLayer((current) => ({ ...current, ...update }))}
            onChoosePhoto={() => setPhotoPickerOpen(true)}
          />
        </div>
      </div>
      {isPhotoPickerOpen
        ? createPortal(
            <PhotoPickerModal
              actionLabel="Use as pattern"
              assets={assets}
              title="Choose pattern photo"
              onAddPhoto={(asset) =>
                setLayer((current) => ({
                  ...current,
                  pattern: { ...current.pattern, assetId: asset.id, kind: "customPhoto" },
                }))
              }
              onClose={() => setPhotoPickerOpen(false)}
            />,
            document.body,
          )
        : null}
    </form>
  );
}
