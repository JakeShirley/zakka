import { Button, Field, Input } from "@fluentui/react-components";
import {
  ArrowUploadRegular,
  CheckmarkRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
} from "@fluentui/react-icons";
import {
  builtInBackgroundCategories,
  builtInBackgroundCategoryLabels,
  builtInBackgrounds,
} from "@zakka/editor-core";
import { type ChangeEvent, type ReactNode, useMemo, useRef, useState } from "react";

import { getErrorMessage } from "../../lib/errors";
import type { CustomBackground } from "../../types";
import { BackgroundSwatch } from "./BackgroundSwatch";
import { supportedBackgroundAccept, useBackgroundLibrary } from "./useBackgroundLibrary";

const describeSource = (background: CustomBackground) =>
  background.source === "shutterfly" ? "Imported from Shutterfly" : "Uploaded";

function BackgroundTile({
  actions,
  backgroundId,
  caption,
  isSelected,
  name,
  thumbnailUrl,
  onSelect,
}: {
  actions?: ReactNode;
  backgroundId: string;
  caption?: string | undefined;
  isSelected: boolean;
  name: string;
  thumbnailUrl?: string | undefined;
  onSelect?: (() => void) | undefined;
}) {
  const content = (
    <>
      <BackgroundSwatch backgroundId={backgroundId} thumbnailUrl={thumbnailUrl} />
      <span className="background-tile-copy">
        <span>{name}</span>
        {caption ? <span>{caption}</span> : null}
      </span>
    </>
  );

  return (
    <li
      className="background-tile-wrap"
      data-background-id={backgroundId}
      data-selected={isSelected || undefined}
    >
      {onSelect ? (
        <button
          type="button"
          className="background-tile"
          aria-label={`Use ${name} background`}
          aria-pressed={isSelected}
          title={name}
          onClick={onSelect}
        >
          {content}
        </button>
      ) : (
        <div className="background-tile" title={name}>
          {content}
        </div>
      )}
      {actions ? <div className="background-tile-actions">{actions}</div> : null}
    </li>
  );
}

function RenameBackgroundForm({
  background,
  onCancel,
  onSubmit,
}: {
  background: CustomBackground;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(background.name);
  const [isSaving, setIsSaving] = useState(false);
  const trimmed = name.trim();

  return (
    <form
      className="background-rename-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!trimmed) return;
        setIsSaving(true);
        try {
          await onSubmit(trimmed);
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <Input
        aria-label={`Name for ${background.name}`}
        autoFocus
        maxLength={120}
        size="small"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Button
        type="submit"
        size="small"
        appearance="subtle"
        aria-label="Save name"
        disabled={!trimmed || isSaving}
        icon={<CheckmarkRegular />}
      />
      <Button
        type="button"
        size="small"
        appearance="subtle"
        aria-label="Cancel rename"
        icon={<DismissRegular />}
        onClick={onCancel}
      />
    </form>
  );
}

/**
 * The background library: the account's uploaded and imported backgrounds plus the built-in
 * catalog grouped by category. With `onSelect` the tiles apply a background; without it the
 * gallery manages the account's custom backgrounds.
 */
export function BackgroundGallery({
  layout = "page",
  selectedBackgroundId = null,
  onSelect,
}: {
  layout?: "page" | "rail";
  selectedBackgroundId?: string | null;
  onSelect?: ((backgroundId: string) => void) | undefined;
}) {
  const library = useBackgroundLibrary();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const isPicker = Boolean(onSelect);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visibleCustomBackgrounds = useMemo(
    () =>
      library.customBackgrounds.filter(
        (background) =>
          !normalizedQuery || background.name.toLocaleLowerCase().includes(normalizedQuery),
      ),
    [library.customBackgrounds, normalizedQuery],
  );
  const visibleCategories = useMemo(
    () =>
      builtInBackgroundCategories
        .map((category) => ({
          category,
          backgrounds: builtInBackgrounds.filter(
            (background) =>
              background.category === category &&
              (!normalizedQuery ||
                `${background.name} ${builtInBackgroundCategoryLabels[category]}`
                  .toLocaleLowerCase()
                  .includes(normalizedQuery)),
          ),
        }))
        .filter(({ backgrounds }) => backgrounds.length > 0),
    [normalizedQuery],
  );

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;

    const uploaded = await library.uploadBackgrounds(files);
    const first = uploaded[0];
    if (first && onSelect && uploaded.length === 1) {
      onSelect(first.backgroundId);
    }
  };

  const removeBackground = async (background: CustomBackground) => {
    library.setError(null);
    try {
      await library.deleteBackground(background.id);
    } catch (deleteError) {
      library.setError(getErrorMessage(deleteError));
    }
  };

  const isUploading = library.uploadProgress !== null;

  return (
    <div className="background-gallery" data-layout={layout}>
      <div className="photo-picker-toolbar background-gallery-toolbar">
        <Field label="Search backgrounds">
          <Input
            type="search"
            size={layout === "rail" ? "small" : "medium"}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </Field>
      </div>
      {library.error ? (
        <p className="panel-alert" role="alert">
          {library.error}
        </p>
      ) : null}
      <section className="background-gallery-section" aria-label="My backgrounds">
        <div className="background-gallery-heading">
          <h4>My backgrounds</h4>
          <input
            ref={fileInputRef}
            accept={supportedBackgroundAccept}
            className="visually-hidden"
            multiple
            type="file"
            aria-label="Background image files"
            onChange={(event) => void uploadFiles(event)}
          />
          <Button
            type="button"
            size="small"
            className="secondary-button"
            disabled={isUploading}
            icon={<ArrowUploadRegular />}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading
              ? `Uploading ${Math.round((library.uploadProgress ?? 0) * 100)}%`
              : "Upload"}
          </Button>
        </div>
        {library.isLoading ? <p className="empty-state">Loading your backgrounds</p> : null}
        {!library.isLoading && library.customBackgrounds.length === 0 ? (
          <p className="empty-state">
            Upload an image to use it as a background. Backgrounds imported from Shutterfly appear
            here too.
          </p>
        ) : null}
        {!library.isLoading &&
        library.customBackgrounds.length > 0 &&
        visibleCustomBackgrounds.length === 0 ? (
          <p className="empty-state">None of your backgrounds match.</p>
        ) : null}
        {visibleCustomBackgrounds.length > 0 ? (
          <ul className="background-grid">
            {visibleCustomBackgrounds.map((background) => (
              <BackgroundTile
                key={background.id}
                backgroundId={background.backgroundId}
                caption={layout === "page" ? describeSource(background) : undefined}
                isSelected={selectedBackgroundId === background.backgroundId}
                name={background.name}
                thumbnailUrl={background.thumbnailUrl}
                onSelect={onSelect ? () => onSelect(background.backgroundId) : undefined}
                actions={
                  isPicker ? null : renamingId === background.id ? (
                    <RenameBackgroundForm
                      background={background}
                      onCancel={() => setRenamingId(null)}
                      onSubmit={async (name) => {
                        library.setError(null);
                        try {
                          await library.renameBackground(background.id, name);
                          setRenamingId(null);
                        } catch (renameError) {
                          library.setError(getErrorMessage(renameError));
                        }
                      }}
                    />
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="small"
                        className="secondary-button"
                        icon={<EditRegular />}
                        aria-label={`Rename ${background.name}`}
                        title="Rename"
                        onClick={() => setRenamingId(background.id)}
                      />
                      <Button
                        type="button"
                        size="small"
                        className="secondary-button"
                        icon={<DeleteRegular />}
                        aria-label={`Delete ${background.name}`}
                        title="Delete"
                        onClick={() => void removeBackground(background)}
                      />
                    </>
                  )
                }
              />
            ))}
          </ul>
        ) : null}
      </section>
      {visibleCategories.length === 0 && normalizedQuery ? (
        <p className="empty-state">No built-in backgrounds match.</p>
      ) : null}
      {visibleCategories.map(({ category, backgrounds }) => (
        <section
          key={category}
          className="background-gallery-section"
          aria-label={builtInBackgroundCategoryLabels[category]}
        >
          <div className="background-gallery-heading">
            <h4>{builtInBackgroundCategoryLabels[category]}</h4>
          </div>
          <ul className="background-grid">
            {backgrounds.map((background) => (
              <BackgroundTile
                key={background.id}
                backgroundId={background.id}
                caption={
                  layout === "page" && background.kind === "texture"
                    ? `${background.source.author} · CC0`
                    : undefined
                }
                isSelected={selectedBackgroundId === background.id}
                name={background.name}
                onSelect={onSelect ? () => onSelect(background.id) : undefined}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
