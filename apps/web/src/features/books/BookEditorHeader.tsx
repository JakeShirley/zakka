import { Button } from "@fluentui/react-components";
import { ArrowDownloadRegular, DocumentPdfRegular, EditRegular } from "@fluentui/react-icons";

import { WorkspaceHeader } from "../../components/layout";
import type { BookPrintWarningGroup, BookPrintWarningPhoto } from "../editor/photoResolution";
import { BookPrintWarnings } from "./BookPrintWarnings";

type BookEditorHeaderProps = {
  hasPages: boolean;
  isWorking: boolean;
  onEditPrintWarning: (photo: BookPrintWarningPhoto) => void;
  onEditSettings: () => void;
  onExportBookPdf: () => void;
  onExportBookPng: () => void;
  printWarnings: BookPrintWarningGroup[];
  title: string;
};

export function BookEditorHeader({
  hasPages,
  isWorking,
  onEditPrintWarning,
  onEditSettings,
  onExportBookPdf,
  onExportBookPng,
  printWarnings,
  title,
}: BookEditorHeaderProps) {
  return (
    <WorkspaceHeader
      title={title}
      titleActions={
        <Button
          type="button"
          className="secondary-button compact-icon-button"
          aria-label="Edit book settings"
          aria-haspopup="dialog"
          title="Edit book settings"
          icon={<EditRegular />}
          onClick={onEditSettings}
        />
      }
    >
      <BookPrintWarnings groups={printWarnings} onEdit={onEditPrintWarning} />
      <Button
        type="button"
        className="secondary-button"
        disabled={isWorking || !hasPages}
        icon={<ArrowDownloadRegular />}
        onClick={onExportBookPng}
      >
        Export book PNG
      </Button>
      <Button
        type="button"
        className="secondary-button"
        disabled={isWorking || !hasPages}
        icon={<DocumentPdfRegular />}
        onClick={onExportBookPdf}
      >
        Export book PDF
      </Button>
    </WorkspaceHeader>
  );
}
