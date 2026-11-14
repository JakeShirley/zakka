import { Button } from "@fluentui/react-components";
import {
  AddRegular,
  EmojiSparkleRegular,
  ImageAddRegular,
  MapRegular,
  TextTRegular,
  WallpaperRegular,
} from "@fluentui/react-icons";
import type { ReactNode } from "react";

import type { Asset } from "../../types";

export type AssetRailInspector = {
  actions?: ReactNode;
  title: string;
  /** Optional tab strip shown between the header and the content. */
  tabs?: ReactNode;
  content: ReactNode;
};

type AssetRailCommonProps = {
  isPhotoPickerDisabled?: boolean;
  isStickerPickerDisabled?: boolean;
  inspector?: AssetRailInspector | null;
  onAddMap: () => void;
  onAddText: () => void;
  onOpenStickerPicker: () => void;
  onOpenWashiTapePicker: () => void;
  onOpenBackgroundPanel?: () => void;
};

type AssetRailModalProps = AssetRailCommonProps & {
  mode?: "modal";
  assetCount: number;
  onOpenPhotoPicker: () => void;
};

type AssetRailReferencedProps = AssetRailCommonProps & {
  mode: "referenced";
  referencedAssets: Asset[];
  onOpenLibraryPicker: () => void;
};

export type AssetRailProps = AssetRailModalProps | AssetRailReferencedProps;

export const assetDragMimeType = "application/x-scrapbook-asset-id";

export function AssetRail(props: AssetRailProps) {
  const {
    isPhotoPickerDisabled = false,
    isStickerPickerDisabled = false,
    inspector,
    onAddMap,
    onAddText,
    onOpenStickerPicker,
    onOpenWashiTapePicker,
    onOpenBackgroundPanel,
  } = props;
  const isReferencedMode = props.mode === "referenced";
  const photoCount = isReferencedMode ? props.referencedAssets.length : props.assetCount;
  const showInspector = Boolean(inspector);

  return (
    <aside className="editor-panel editor-asset-rail" aria-label="Editor sidebar">
      <div className="asset-rail-actions">
        {isReferencedMode ? null : (
          <Button
            appearance="primary"
            type="button"
            className="primary-button full-width-button"
            disabled={isPhotoPickerDisabled}
            icon={<AddRegular />}
            onClick={props.onOpenPhotoPicker}
          >
            Add photo
          </Button>
        )}
        <Button
          type="button"
          className="secondary-button full-width-button"
          disabled={isPhotoPickerDisabled}
          icon={<AddRegular />}
          onClick={onOpenWashiTapePicker}
        >
          Add washi tape
        </Button>
        <Button
          type="button"
          className="secondary-button full-width-button"
          icon={<TextTRegular />}
          onClick={onAddText}
        >
          Add text
        </Button>
        <Button
          type="button"
          className="secondary-button full-width-button"
          disabled={isStickerPickerDisabled}
          icon={<EmojiSparkleRegular />}
          onClick={onOpenStickerPicker}
        >
          Add sticker
        </Button>
        <Button
          type="button"
          className="secondary-button full-width-button"
          icon={<MapRegular />}
          onClick={onAddMap}
        >
          Add map
        </Button>
        {onOpenBackgroundPanel ? (
          <Button
            type="button"
            className="secondary-button full-width-button"
            icon={<WallpaperRegular />}
            onClick={onOpenBackgroundPanel}
          >
            Backgrounds
          </Button>
        ) : null}
        {isReferencedMode ? (
          <Button
            appearance="primary"
            type="button"
            className="primary-button full-width-button"
            icon={<ImageAddRegular />}
            onClick={props.onOpenLibraryPicker}
          >
            Add more photos
          </Button>
        ) : null}
      </div>
      {showInspector && inspector ? (
        <section
          aria-label={inspector.title}
          className="asset-rail-inspector"
          data-has-tabs={inspector.tabs ? true : undefined}
          role="dialog"
        >
          <header className="editor-edit-pane-header">
            <h3>{inspector.title}</h3>
            {inspector.actions ?? null}
          </header>
          {inspector.tabs ?? null}
          <div className="editor-edit-pane-body">{inspector.content}</div>
        </section>
      ) : isReferencedMode ? (
        <section className="asset-rail-photos-section" aria-label="Photos">
          <div className="panel-heading compact-heading asset-rail-photos-heading">
            <h3>Photos</h3>
            <span>{photoCount}</span>
          </div>
          <ul className="asset-rail-photos" aria-label="Photos referenced by this book">
            {props.referencedAssets.length === 0 ? (
              <li className="asset-rail-photos-empty-item">
                <p className="asset-rail-photos-empty">
                  No photos yet. Click <em>Add more photos</em> to add some from your library.
                </p>
              </li>
            ) : (
              props.referencedAssets.map((asset) => {
                const isDisabled = isPhotoPickerDisabled;
                return (
                  <li key={asset.id} className="asset-rail-photo-item">
                    <button
                      type="button"
                      className="asset-rail-photo"
                      title={`Drag ${asset.originalFilename} onto the page`}
                      aria-label={`Drag ${asset.originalFilename} onto the page`}
                      disabled={isDisabled}
                      draggable={!isDisabled}
                      onDragStart={(event) => {
                        if (isDisabled) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData(assetDragMimeType, asset.id);
                        event.dataTransfer.setData("text/plain", asset.id);
                      }}
                    >
                      <img
                        src={asset.thumbnailUrl ?? asset.originalContentUrl}
                        alt=""
                        draggable={false}
                      />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
