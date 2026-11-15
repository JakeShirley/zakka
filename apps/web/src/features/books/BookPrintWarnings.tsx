import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { WarningFilled } from "@fluentui/react-icons";
import { useState } from "react";

import type { BookPrintWarningGroup, BookPrintWarningPhoto } from "../editor/photoResolution";

const maxThumbnails = 3;

const pluralize = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

const describeIssues = (photos: BookPrintWarningPhoto[]) => {
  const veryLowCount = photos.filter((photo) => photo.quality === "veryLow").length;
  const lowCount = photos.length - veryLowCount;

  return [
    veryLowCount > 0
      ? {
          quality: "veryLow" as const,
          title: pluralize(veryLowCount, "very low resolution photo", "very low resolution photos"),
          detail: "Will likely print blurry",
        }
      : null,
    lowCount > 0
      ? {
          quality: "low" as const,
          title: pluralize(lowCount, "low resolution photo", "low resolution photos"),
          detail: "May appear blurry when printed",
        }
      : null,
  ].filter((issue) => issue !== null);
};

type BookPrintWarningsProps = {
  groups: BookPrintWarningGroup[];
  onEdit: (photo: BookPrintWarningPhoto) => void;
};

/** Header button that lists every print-quality problem in the book, one card per spread. */
export function BookPrintWarnings({ groups, onEdit }: BookPrintWarningsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const warningCount = groups.reduce((count, group) => count + group.photos.length, 0);

  if (warningCount === 0) {
    return null;
  }

  const hasVeryLow = groups.some((group) =>
    group.photos.some((photo) => photo.quality === "veryLow"),
  );

  return (
    <Popover
      open={isOpen}
      positioning="below-end"
      withArrow
      onOpenChange={(_event, data) => setIsOpen(data.open)}
    >
      <PopoverTrigger disableButtonEnhancement>
        <Button
          type="button"
          className="secondary-button book-print-warnings-button"
          data-quality={hasVeryLow ? "veryLow" : "low"}
          aria-expanded={isOpen}
          icon={<WarningFilled />}
        >
          {pluralize(warningCount, "warning", "warnings")}
        </Button>
      </PopoverTrigger>
      <PopoverSurface className="book-print-warnings" aria-label="Print warnings">
        <h2 className="book-print-warnings-title">Print warnings</h2>
        <ul className="book-print-warnings-list">
          {groups.map((group) => (
            <li key={group.pageIds.join(" ")} className="book-print-warning">
              <span className="book-print-warning-photos" aria-hidden="true">
                {group.photos.slice(0, maxThumbnails).map((photo) => (
                  <img
                    key={`${photo.pageId}:${photo.layerId}`}
                    src={photo.asset.thumbnailUrl ?? photo.asset.originalContentUrl}
                    alt=""
                    draggable={false}
                  />
                ))}
              </span>
              <div className="book-print-warning-body">
                <h3>{group.label}</h3>
                <ul>
                  {describeIssues(group.photos).map((issue) => (
                    <li key={issue.quality} data-quality={issue.quality}>
                      <span className="book-print-warning-issue">{issue.title}</span>
                      <span className="book-print-warning-detail">{issue.detail}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  appearance="transparent"
                  size="small"
                  className="book-print-warning-edit"
                  aria-label={`Go to ${group.label}`}
                  onClick={() => {
                    const [firstPhoto] = group.photos;
                    if (firstPhoto) onEdit(firstPhoto);
                    setIsOpen(false);
                  }}
                >
                  Go to page
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </PopoverSurface>
    </Popover>
  );
}
