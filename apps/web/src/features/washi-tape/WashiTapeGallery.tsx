import { Button, Field, Input } from "@fluentui/react-components";
import { AddRegular, DeleteRegular, EditRegular, PaintBrushRegular } from "@fluentui/react-icons";
import type { WashiTapeDesign } from "@zakka/editor-core";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { AppModal } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";
import type { Asset, CustomWashiTape } from "../../types";
import { formatWashiTapeOutline, formatWashiTapePattern } from "../editor/WashiTapeControls";
import { useWashiTapeLibrary } from "./useWashiTapeLibrary";
import { WashiTapeCreator } from "./WashiTapeCreator";
import { WashiTapePreview } from "./WashiTapePreview";
import { washiTapePresets } from "./washiTapePresets";

type CreatorState = { initialDesign?: WashiTapeDesign; initialName?: string };

const describeDesign = (design: WashiTapeDesign) =>
  `${formatWashiTapePattern(design.pattern.kind)} / ${formatWashiTapeOutline(design.outline)}`;

const matchesQuery = (name: string, design: WashiTapeDesign, query: string) =>
  !query || `${name} ${describeDesign(design)}`.toLocaleLowerCase().includes(query);

function WashiTapeTile({
  actions,
  assetById,
  design,
  isHighlighted = false,
  name,
  tileId,
  onAdd,
}: {
  actions?: ReactNode;
  assetById: Map<string, Asset>;
  design: WashiTapeDesign;
  isHighlighted?: boolean;
  name: string;
  tileId: string;
  onAdd?: (() => void) | undefined;
}) {
  const content = (
    <>
      <WashiTapePreview assetById={assetById} design={design} />
      <span className="washi-tape-tile-copy">
        <span>{name}</span>
        <span>{describeDesign(design)}</span>
      </span>
    </>
  );

  return (
    <li
      className="washi-tape-tile-wrap"
      data-washi-tape-id={tileId}
      data-highlighted={isHighlighted || undefined}
    >
      {onAdd ? (
        <button
          type="button"
          className="washi-tape-tile"
          aria-label={`Add ${name}`}
          title={`Add ${name}`}
          onClick={onAdd}
        >
          {content}
          <span className="primary-button washi-tape-tile-add-indicator" aria-hidden="true">
            <AddRegular />
            Add
          </span>
        </button>
      ) : (
        <div className="washi-tape-tile" title={name}>
          {content}
          {actions ? <div className="washi-tape-tile-actions">{actions}</div> : null}
        </div>
      )}
    </li>
  );
}

/**
 * The washi tape gallery: a "Create custom washi tape" editor at the top, the account's saved
 * tapes, and the built-in designs. `onAddWashiTape` turns tiles into "add to page" buttons;
 * without it the gallery offers edit, delete, and customize actions instead.
 */
export function WashiTapeGallery({
  onAddWashiTape,
  onPhotoPickerOpenChange,
}: {
  onAddWashiTape?: ((design: WashiTapeDesign) => void) | undefined;
  onPhotoPickerOpenChange?: (isOpen: boolean) => void;
}) {
  const library = useWashiTapeLibrary();
  const [creator, setCreator] = useState<CreatorState | null>(null);
  const [creatorKey, setCreatorKey] = useState(0);
  const [editingWashiTape, setEditingWashiTape] = useState<CustomWashiTape | null>(null);
  const [isEditPhotoPickerOpen, setIsEditPhotoPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const isPicker = Boolean(onAddWashiTape);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visibleCustomWashiTapes = useMemo(
    () =>
      library.customWashiTapes.filter((washiTape) =>
        matchesQuery(washiTape.name, washiTape.design, normalizedQuery),
      ),
    [library.customWashiTapes, normalizedQuery],
  );
  const visiblePresets = useMemo(
    () =>
      washiTapePresets.filter((preset) =>
        matchesQuery(preset.name, preset.design, normalizedQuery),
      ),
    [normalizedQuery],
  );

  useEffect(() => {
    if (!highlightedId) return;
    galleryRef.current
      ?.querySelector(`[data-washi-tape-id="${highlightedId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlightedId]);

  const openCreator = (next: CreatorState) => {
    setCreator(next);
    setCreatorKey((current) => current + 1);
    galleryRef.current?.scrollIntoView?.({ block: "start" });
  };

  const closeCreator = () => {
    setCreator(null);
    onPhotoPickerOpenChange?.(false);
  };

  const removeWashiTape = async (washiTape: CustomWashiTape) => {
    library.setError(null);
    try {
      await library.deleteWashiTape(washiTape.id);
      if (editingWashiTape?.id === washiTape.id) {
        setEditingWashiTape(null);
      }
    } catch (deleteError) {
      library.setError(getErrorMessage(deleteError));
    }
  };

  const totalCount = library.customWashiTapes.length + washiTapePresets.length;
  const visibleCount = visibleCustomWashiTapes.length + visiblePresets.length;

  return (
    <div className="washi-tape-gallery" ref={galleryRef}>
      {creator ? (
        <WashiTapeCreator
          key={creatorKey}
          assetById={library.assetById}
          assets={library.assets}
          {...(creator.initialDesign ? { initialDesign: creator.initialDesign } : {})}
          {...(creator.initialName ? { initialName: creator.initialName } : {})}
          onCancel={closeCreator}
          {...(onPhotoPickerOpenChange ? { onPhotoPickerOpenChange } : {})}
          onSubmit={async (draft) => {
            const saved = await library.createWashiTape(draft);
            closeCreator();
            setQuery("");
            setHighlightedId(saved.id);
          }}
        />
      ) : (
        <button type="button" className="washi-tape-create-card" onClick={() => openCreator({})}>
          <span className="washi-tape-create-card-icon" aria-hidden="true">
            <AddRegular />
          </span>
          <span className="washi-tape-create-card-copy">
            <strong>Create custom washi tape</strong>
            <span>Pick an edge, pattern, colors, or your own photo, then save it here.</span>
          </span>
        </button>
      )}
      <div className="photo-picker-toolbar washi-tape-gallery-toolbar">
        <Field label="Search washi tape">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </Field>
        <span className="photo-picker-count">
          {normalizedQuery ? `${visibleCount} of ${totalCount}` : `${totalCount} tapes`}
        </span>
      </div>
      {library.error ? (
        <p className="panel-alert" role="alert">
          {library.error}
        </p>
      ) : null}
      <section className="washi-tape-gallery-section" aria-label="My washi tape">
        <h4>My washi tape</h4>
        {library.isLoading ? <p className="empty-state">Loading your washi tape</p> : null}
        {!library.isLoading && library.customWashiTapes.length === 0 ? (
          <p className="empty-state">
            Tape you create is saved here so you can use it on any page.
          </p>
        ) : null}
        {!library.isLoading &&
        library.customWashiTapes.length > 0 &&
        visibleCustomWashiTapes.length === 0 ? (
          <p className="empty-state">None of your washi tape matches.</p>
        ) : null}
        {visibleCustomWashiTapes.length > 0 ? (
          <ul className="washi-tape-grid">
            {visibleCustomWashiTapes.map((washiTape) => (
              <WashiTapeTile
                key={washiTape.id}
                tileId={washiTape.id}
                assetById={library.assetById}
                design={washiTape.design}
                isHighlighted={highlightedId === washiTape.id}
                name={washiTape.name}
                onAdd={onAddWashiTape ? () => onAddWashiTape(washiTape.design) : undefined}
                actions={
                  isPicker ? null : (
                    <>
                      <Button
                        type="button"
                        size="small"
                        className="secondary-button"
                        icon={<EditRegular />}
                        aria-label={`Edit ${washiTape.name}`}
                        onClick={() => setEditingWashiTape(washiTape)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        className="secondary-button"
                        icon={<DeleteRegular />}
                        aria-label={`Delete ${washiTape.name}`}
                        onClick={() => removeWashiTape(washiTape)}
                      >
                        Delete
                      </Button>
                    </>
                  )
                }
              />
            ))}
          </ul>
        ) : null}
      </section>
      <section className="washi-tape-gallery-section" aria-label="Designs">
        <h4>Designs</h4>
        {visiblePresets.length === 0 ? (
          <p className="empty-state">No designs match.</p>
        ) : (
          <ul className="washi-tape-grid">
            {visiblePresets.map((preset) => (
              <WashiTapeTile
                key={preset.id}
                tileId={preset.id}
                assetById={library.assetById}
                design={preset.design}
                name={preset.name}
                onAdd={onAddWashiTape ? () => onAddWashiTape(preset.design) : undefined}
                actions={
                  isPicker ? null : (
                    <Button
                      type="button"
                      size="small"
                      className="secondary-button"
                      icon={<PaintBrushRegular />}
                      aria-label={`Customize ${preset.name}`}
                      onClick={() =>
                        openCreator({
                          initialDesign: preset.design,
                          initialName: `My ${preset.name.toLocaleLowerCase()}`,
                        })
                      }
                    >
                      Customize
                    </Button>
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>
      {editingWashiTape ? (
        <AppModal
          title="Edit washi tape"
          closeDisabled={isEditPhotoPickerOpen}
          onClose={() => setEditingWashiTape(null)}
        >
          <WashiTapeCreator
            key={editingWashiTape.id}
            assetById={library.assetById}
            assets={library.assets}
            initialDesign={editingWashiTape.design}
            initialName={editingWashiTape.name}
            showHeading={false}
            submitLabel="Save changes"
            title="Edit washi tape"
            onCancel={() => setEditingWashiTape(null)}
            onPhotoPickerOpenChange={setIsEditPhotoPickerOpen}
            onSubmit={async (draft) => {
              const saved = await library.updateWashiTape(editingWashiTape.id, draft);
              setEditingWashiTape(null);
              setIsEditPhotoPickerOpen(false);
              setHighlightedId(saved.id);
            }}
          />
        </AppModal>
      ) : null}
    </div>
  );
}
