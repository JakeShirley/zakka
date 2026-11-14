import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import {
  createPageDocument,
  deleteLayer,
  type PageDocument,
  type PageLayer,
  reorderLayer,
  updateLayer,
} from "@zakka/editor-core";
import { useState } from "react";
import { render } from "vitest-browser-react";

import { assetDragMimeType } from "../features/editor/AssetRail";
import type { CanvasPoint } from "../features/editor/editorTypes";
import {
  type CanvasPreviewLayer,
  PageCanvas,
  type PhotoPlaceholderDropTarget,
  type ReorderLayerCommand,
  type SelectionPanel,
} from "../features/editor/PageCanvas";
import type { Asset } from "../types";

const testImageUrl = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#7aa"/><circle cx="200" cy="150" r="90" fill="#fd8"/></svg>',
)}`;

export function createTestAsset(id = "asset_test"): Asset {
  const timestamp = "2026-05-25T12:00:00.000Z";

  return {
    byteSize: 1024,
    cameraMake: null,
    cameraModel: null,
    checksumSha256: `sha256-${id}`,
    createdAt: timestamp,
    dateTaken: null,
    exposureTimeSeconds: null,
    fNumber: null,
    focalLength35mmMm: null,
    focalLengthMm: null,
    gpsAltitudeMeters: null,
    gpsLatitude: null,
    gpsLongitude: null,
    height: 300,
    id,
    isoSpeed: null,
    lensModel: null,
    mimeType: "image/svg+xml",
    orientation: null,
    originalContentUrl: testImageUrl,
    originalFilename: `${id}.svg`,
    thumbnailUrl: testImageUrl,
    updatedAt: timestamp,
    variants: [],
    width: 400,
  };
}

export type CanvasProbe = {
  activeSelectionPanel: SelectionPanel | null;
  choosePhotoRequests: string[];
  document: PageDocument;
  droppedAssets: Array<{
    assetId: string;
    placeholder?: PhotoPlaceholderDropTarget;
    point: CanvasPoint;
  }>;
  reorders: Array<{ command: ReorderLayerCommand; layerId: string }>;
  selectedLayerIds: string[];
};

type RenderCanvasOptions = {
  assets?: Asset[];
  layers: PageLayer[];
  previewLayers?: CanvasPreviewLayer[];
  selectedLayerIds?: string[];
};

/**
 * Mounts PageCanvas with the selection and layer-command wiring the book editor uses, and exposes
 * the live document and selection so tests can assert on the model the UI produces.
 */
export async function renderCanvas({
  assets = [createTestAsset()],
  layers,
  previewLayers = [],
  selectedLayerIds = [],
}: RenderCanvasOptions) {
  const probe: CanvasProbe = {
    activeSelectionPanel: null,
    choosePhotoRequests: [],
    document: createPageDocument({ canvas: { width: 2000, height: 2000 }, layers }),
    droppedAssets: [],
    reorders: [],
    selectedLayerIds,
  };
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  function CanvasHarness() {
    const [document, setDocument] = useState(probe.document);
    const [selection, setSelection] = useState(probe.selectedLayerIds);
    const [panel, setPanel] = useState<SelectionPanel | null>(null);

    probe.document = document;
    probe.selectedLayerIds = selection;
    probe.activeSelectionPanel = panel;

    const applyUpdate = (layerId: string, update: Partial<PageLayer>) =>
      setDocument((current) => updateLayer(current, layerId, update));

    return (
      <div style={{ padding: 48, width: 900 }}>
        <div
          draggable
          role="img"
          aria-label="Draggable test asset"
          style={{ height: 40, width: 40, background: "#ccc" }}
          onDragStart={(event) => {
            event.dataTransfer.setData(assetDragMimeType, "asset_test");
            event.dataTransfer.effectAllowed = "copy";
          }}
        />
        <PageCanvas
          activeSelectionPanel={panel}
          assetById={assetById}
          document={document}
          previewLayers={previewLayers}
          selectedLayerIds={selection}
          onActiveSelectionPanelChange={setPanel}
          onChangeLayer={applyUpdate}
          onChoosePhoto={(layerId) => probe.choosePhotoRequests.push(layerId)}
          onDeleteLayer={(layerId) => {
            setDocument((current) => deleteLayer(current, layerId));
            setSelection((current) => current.filter((id) => id !== layerId));
          }}
          onDropAsset={(assetId, point, placeholder) =>
            probe.droppedAssets.push({
              assetId,
              point,
              ...(placeholder ? { placeholder } : {}),
            })
          }
          onReorderLayer={(layerId, command) => {
            probe.reorders.push({ command, layerId });
            setDocument((current) => {
              const index = current.layers.findIndex((layer) => layer.id === layerId);
              const last = current.layers.length - 1;
              const toIndex =
                command === "top"
                  ? last
                  : command === "bottom"
                    ? 0
                    : command === "up"
                      ? Math.min(last, index + 1)
                      : Math.max(0, index - 1);
              return reorderLayer(current, layerId, toIndex);
            });
          }}
          onSelectLayer={(layerId, options) => {
            if (layerId === null) {
              setSelection([]);
              return;
            }
            if (options?.additive) {
              setSelection((current) =>
                current.includes(layerId)
                  ? current.filter((id) => id !== layerId)
                  : [...current, layerId],
              );
              return;
            }
            setSelection([layerId]);
          }}
          onTransformLayer={applyUpdate}
          onTransformLayers={(updates) =>
            setDocument((current) =>
              updates.reduce(
                (next, { layerId, update }) => updateLayer(next, layerId, update),
                current,
              ),
            )
          }
        />
      </div>
    );
  }

  const screen = await render(
    <FluentProvider theme={webLightTheme}>
      <CanvasHarness />
    </FluentProvider>,
  );

  const layer = <Kind extends PageLayer["kind"]>(layerId: string, kind?: Kind) => {
    const found = probe.document.layers.find((candidate) => candidate.id === layerId);
    if (!found || (kind && found.kind !== kind)) {
      throw new Error(`Layer ${layerId}${kind ? ` (${kind})` : ""} not found`);
    }
    return found as Extract<PageLayer, { kind: Kind }>;
  };

  return { layer, probe, screen };
}
