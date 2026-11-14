import { Button, Field, Input } from "@fluentui/react-components";
import { DeleteRegular, DismissRegular, RenameRegular } from "@fluentui/react-icons";
import type { PageResizeAnchor, PageResizeMode } from "@zakka/editor-core";
import type { FormEvent } from "react";

import { AppModal } from "../../components/layout";
import type { BookDetail } from "../../types";
import {
  commonBookPageSizes,
  customBookPageSizeKey,
  formatBookPageSize,
  getBookPageSizeByKey,
  getBookPageSizeKey,
} from "./pageSizes";
import { PageResizeContentPicker } from "./PageResizeContentPicker";

type BookSettingsModalProps = {
  book: BookDetail;
  closeDisabled: boolean;
  coverSpreadEnabledDraft: boolean;
  pageResizeAnchor: PageResizeAnchor;
  pageResizeMode: PageResizeMode;
  pageSizeDraft: string;
  titleDraft: string;
  onClose: () => void;
  onCoverSpreadEnabledDraftChange: (enabled: boolean) => void;
  onDeleteRequest: () => void;
  onPageResizeAnchorChange: (anchor: PageResizeAnchor) => void;
  onPageResizeModeChange: (mode: PageResizeMode) => void;
  onPageSizeDraftChange: (pageSizeKey: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleDraftChange: (title: string) => void;
};

export function BookSettingsModal({
  book,
  closeDisabled,
  coverSpreadEnabledDraft,
  pageResizeAnchor,
  pageResizeMode,
  pageSizeDraft,
  titleDraft,
  onClose,
  onCoverSpreadEnabledDraftChange,
  onDeleteRequest,
  onPageResizeAnchorChange,
  onPageResizeModeChange,
  onPageSizeDraftChange,
  onSubmit,
  onTitleDraftChange,
}: BookSettingsModalProps) {
  const nextPageSize =
    pageSizeDraft === customBookPageSizeKey ? null : getBookPageSizeByKey(pageSizeDraft);
  const pageSizeChanged = Boolean(
    nextPageSize &&
      (nextPageSize.width !== book.pageWidth || nextPageSize.height !== book.pageHeight),
  );

  return (
    <AppModal title="Book settings" size="compact" closeDisabled={closeDisabled} onClose={onClose}>
      <form className="book-settings-form" onSubmit={onSubmit}>
        <Field label="Book title">
          <Input
            maxLength={120}
            value={titleDraft}
            onChange={(event) => onTitleDraftChange(event.currentTarget.value)}
          />
        </Field>
        <Field label="Page size">
          <select
            aria-label="Page size"
            className="book-size-select"
            value={pageSizeDraft}
            onChange={(event) => onPageSizeDraftChange(event.currentTarget.value)}
          >
            {getBookPageSizeKey(book) === customBookPageSizeKey ? (
              <option value={customBookPageSizeKey}>{formatBookPageSize(book)}</option>
            ) : null}
            {commonBookPageSizes.map((pageSize) => (
              <option key={pageSize.key} value={pageSize.key}>
                {pageSize.label}
              </option>
            ))}
          </select>
        </Field>
        {pageSizeChanged && nextPageSize ? (
          <PageResizeContentPicker
            anchor={pageResizeAnchor}
            from={{ width: book.pageWidth, height: book.pageHeight }}
            mode={pageResizeMode}
            to={{ width: nextPageSize.width, height: nextPageSize.height }}
            onAnchorChange={onPageResizeAnchorChange}
            onModeChange={onPageResizeModeChange}
          />
        ) : null}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={coverSpreadEnabledDraft}
            onChange={(event) => onCoverSpreadEnabledDraftChange(event.currentTarget.checked)}
          />
          <span>Keep front and back covers together</span>
        </label>
        <div className="book-settings-danger">
          <div>
            <strong>Delete book</strong>
            <p>Remove this book from the library. This action cannot be undone.</p>
          </div>
          <Button
            type="button"
            className="danger-button"
            disabled={closeDisabled}
            icon={<DeleteRegular />}
            onClick={onDeleteRequest}
          >
            Delete
          </Button>
        </div>
        <div className="book-settings-actions">
          <Button
            type="button"
            className="secondary-button"
            disabled={closeDisabled}
            icon={<DismissRegular />}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="secondary-button"
            disabled={closeDisabled}
            icon={<RenameRegular />}
          >
            Save
          </Button>
        </div>
      </form>
    </AppModal>
  );
}
