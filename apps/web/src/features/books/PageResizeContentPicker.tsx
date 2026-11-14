import {
  getPageResizeContentRect,
  pageResizeAnchors,
  type PageResizeAnchor,
  type PageResizeMode,
} from "@zakka/editor-core";

type PageSize = { width: number; height: number };

type PageResizeContentPickerProps = {
  anchor: PageResizeAnchor;
  from: PageSize;
  mode: PageResizeMode;
  to: PageSize;
  onAnchorChange: (anchor: PageResizeAnchor) => void;
  onModeChange: (mode: PageResizeMode) => void;
};

const pageResizeModeOptions: { value: PageResizeMode; label: string }[] = [
  { value: "keep", label: "Keep original size" },
  { value: "fit", label: "Scale to fit" },
  { value: "fill", label: "Scale to fill" },
  { value: "stretch", label: "Stretch to page" },
];

const anchorLabels: Record<PageResizeAnchor, string> = {
  "top-left": "Top left",
  top: "Top",
  "top-right": "Top right",
  left: "Left",
  center: "Center",
  right: "Right",
  "bottom-left": "Bottom left",
  bottom: "Bottom",
  "bottom-right": "Bottom right",
};

const arrowsByOffset: Record<string, string> = {
  "-1,-1": "↖",
  "0,-1": "↑",
  "1,-1": "↗",
  "-1,0": "←",
  "1,0": "→",
  "-1,1": "↙",
  "0,1": "↓",
  "1,1": "↘",
};

const anchorCell = (anchor: PageResizeAnchor) => {
  const index = pageResizeAnchors.indexOf(anchor);

  return { column: index % 3, row: Math.floor(index / 3) };
};

/** Photoshop-style hint: arrows on the cells next to the anchor show which way the page grows. */
const anchorCellGlyph = (cell: PageResizeAnchor, selected: PageResizeAnchor): string => {
  const from = anchorCell(selected);
  const to = anchorCell(cell);

  return arrowsByOffset[`${to.column - from.column},${to.row - from.row}`] ?? "";
};

export function PageResizeContentPicker({
  anchor,
  from,
  mode,
  to,
  onAnchorChange,
  onModeChange,
}: PageResizeContentPickerProps) {
  const content = getPageResizeContentRect(from, to, { anchor, mode });
  const minX = Math.min(0, content.x);
  const minY = Math.min(0, content.y);
  const maxX = Math.max(to.width, content.x + content.width);
  const maxY = Math.max(to.height, content.y + content.height);
  const padding = Math.max(maxX - minX, maxY - minY) * 0.04;
  const strokeWidth = Math.max(maxX - minX, maxY - minY) * 0.012;
  const anchorDisabled = mode === "stretch";

  return (
    <fieldset className="page-resize-content">
      <legend>Existing content</legend>
      <div className="page-resize-content-body">
        <div className="page-resize-content-controls">
          <label>
            <span>Sizing</span>
            <select
              aria-label="Content sizing"
              value={mode}
              onChange={(event) => onModeChange(event.currentTarget.value as PageResizeMode)}
            >
              {pageResizeModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="page-resize-anchor-field" disabled={anchorDisabled}>
            <legend>Anchor</legend>
            <div className="page-resize-anchor-grid">
              {pageResizeAnchors.map((cell) => (
                <button
                  key={cell}
                  type="button"
                  aria-pressed={cell === anchor}
                  aria-label={anchorLabels[cell]}
                  className="page-resize-anchor-cell"
                  title={anchorLabels[cell]}
                  onClick={() => onAnchorChange(cell)}
                >
                  {cell === anchor ? null : anchorCellGlyph(cell, anchor)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <svg
          aria-label="Resize preview"
          className="page-resize-preview"
          role="img"
          viewBox={`${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${
            maxY - minY + padding * 2
          }`}
        >
          <rect
            className="page-resize-preview-page"
            x={0}
            y={0}
            width={to.width}
            height={to.height}
            strokeWidth={strokeWidth}
          />
          <rect
            className="page-resize-preview-content"
            x={content.x}
            y={content.y}
            width={content.width}
            height={content.height}
            strokeDasharray={`${strokeWidth * 3} ${strokeWidth * 2}`}
            strokeWidth={strokeWidth}
          />
        </svg>
      </div>
    </fieldset>
  );
}
