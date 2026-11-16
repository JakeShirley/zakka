import { Button } from "@fluentui/react-components";
import {
  AddRegular,
  EmojiSparkleRegular,
  ImageAddRegular,
  LayoutCellFourRegular,
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

type AssetRailActionCallbacks = {
  isPhotoPickerDisabled?: boolean;
  isStickerPickerDisabled?: boolean;
  onAddMap: () => void;
  onAddText: () => void;
  onOpenLayoutPicker?: (() => void) | undefined;
  onOpenStickerPicker: () => void;
  onOpenWashiTapePicker: () => void;
  onOpenBackgroundPanel?: () => void;
};

type AssetRailCommonProps = AssetRailActionCallbacks & {
  inspector?: AssetRailInspector | null;
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

type AssetRailPhotoListProps = {
  assets: Asset[];
  isDisabled?: boolean;
};

/** Draggable thumbnails of the photos referenced by a book. */
export function AssetRailPhotoList({ assets, isDisabled = false }: AssetRailPhotoListProps) {
  return (
    <ul className="asset-rail-photos" aria-label="Photos referenced by this book">
      {assets.length === 0 ? (
        <li className="asset-rail-photos-empty-item">
          <p className="asset-rail-photos-empty">
            No photos yet. Click <em>Add more photos</em> to add some from your library.
          </p>
        </li>
      ) : (
        assets.map((asset) => (
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
              <img src={asset.thumbnailUrl ?? asset.originalContentUrl} alt="" draggable={false} />
            </button>
          </li>
        ))
      )}
    </ul>
  );
}

type AssetRailActionsProps = AssetRailActionCallbacks & {
  /** Shows an "Add photo" button first (single-page editor). */
  onOpenPhotoPicker?: (() => void) | undefined;
  /** Shows an "Add more photos" button last (book editor). */
  onOpenLibraryPicker?: (() => void) | undefined;
};

/** Buttons that add content (photos, text, stickers, ...) to the current page. */
export function AssetRailActions({
  isPhotoPickerDisabled = false,
  isStickerPickerDisabled = false,
  onAddMap,
  onAddText,
  onOpenBackgroundPanel,
  onOpenLayoutPicker,
  onOpenLibraryPicker,
  onOpenPhotoPicker,
  onOpenStickerPicker,
  onOpenWashiTapePicker,
}: AssetRailActionsProps) {
  return (
    <div className="asset-rail-actions">
      {onOpenPhotoPicker ? (
        <Button
          appearance="primary"
          type="button"
          className="primary-button full-width-button"
          disabled={isPhotoPickerDisabled}
          icon={<AddRegular />}
          onClick={onOpenPhotoPicker}
        >
          Add photo
        </Button>
      ) : null}
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
      {onOpenLayoutPicker ? (
        <Button
          type="button"
          className="secondary-button full-width-button"
          icon={<LayoutCellFourRegular />}
          onClick={onOpenLayoutPicker}
        >
          Page layout
        </Button>
      ) : null}
      {onOpenLibraryPicker ? (
        <Button
          appearance="primary"
          type="button"
          className="primary-button full-width-button"
          icon={<ImageAddRegular />}
          onClick={onOpenLibraryPicker}
        >
          Add more photos
        </Button>
      ) : null}
    </div>
  );
}

export function AssetRail(props: AssetRailProps) {
  const { inspector, ...actionProps } = props;
  const isReferencedMode = props.mode === "referenced";
  const photoCount = isReferencedMode ? props.referencedAssets.length : props.assetCount;
  const showInspector = Boolean(inspector);

  return (
    <aside className="editor-panel editor-asset-rail" aria-label="Editor sidebar">
      <AssetRailActions
        {...actionProps}
        onOpenLibraryPicker={isReferencedMode ? props.onOpenLibraryPicker : undefined}
        onOpenPhotoPicker={isReferencedMode ? undefined : props.onOpenPhotoPicker}
      />
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
          <AssetRailPhotoList
            assets={props.referencedAssets}
            isDisabled={props.isPhotoPickerDisabled ?? false}
          />
        </section>
      ) : null}
    </aside>
  );
}
