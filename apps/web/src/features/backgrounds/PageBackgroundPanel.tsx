import { Button } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { getBuiltInBackground, type PageBackground } from "@zakka/editor-core";
import { useId } from "react";

import { BackgroundGallery } from "./BackgroundGallery";
import { BackgroundSwatch } from "./BackgroundSwatch";

export type BackgroundApplyTarget = "page" | "spread";

const applyTargetOptions: { label: string; value: BackgroundApplyTarget }[] = [
  { label: "Whole spread", value: "spread" },
  { label: "This page", value: "page" },
];

/**
 * Editor sidebar content for the active page's background: where a choice applies, the current
 * background with its tile size, the solid color underneath, and the background library.
 */
export function PageBackgroundPanel({
  applyTarget,
  background,
  backgroundColor,
  canApplyToSpread,
  onApplyTargetChange,
  onBackgroundColorChange,
  onRemove,
  onScaleChange,
  onSelect,
}: {
  applyTarget: BackgroundApplyTarget;
  background: PageBackground | null;
  backgroundColor: string;
  canApplyToSpread: boolean;
  onApplyTargetChange: (target: BackgroundApplyTarget) => void;
  onBackgroundColorChange: (color: string) => void;
  onRemove: () => void;
  onScaleChange: (scale: number) => void;
  onSelect: (backgroundId: string) => void;
}) {
  const scaleId = useId();
  const colorId = useId();
  const builtIn = background ? getBuiltInBackground(background.backgroundId) : undefined;
  const isTiled = builtIn?.fit === "tile";

  return (
    <div className="page-background-panel">
      {canApplyToSpread ? (
        <fieldset className="arrange-choice-group">
          <legend className="arrange-label">Apply to</legend>
          <div className="arrange-choices page-background-target-choices">
            {applyTargetOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={option.value === applyTarget}
                className="arrange-choice"
                onClick={() => onApplyTargetChange(option.value)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <section className="page-background-current" aria-label="Current background">
        {background ? (
          <>
            <div className="page-background-current-row">
              <BackgroundSwatch backgroundId={background.backgroundId} />
              <span className="page-background-current-name">
                {builtIn?.name ?? "Custom background"}
              </span>
              <Button
                type="button"
                size="small"
                className="secondary-button"
                icon={<DeleteRegular />}
                onClick={onRemove}
              >
                Remove
              </Button>
            </div>
            {isTiled ? (
              <div className="page-background-scale">
                <div className="washi-tape-slider-label-row">
                  <label htmlFor={scaleId}>Tile size</label>
                  <output htmlFor={scaleId}>{`${Math.round(background.scale * 100)}%`}</output>
                </div>
                <div className="washi-tape-slider-row">
                  <input
                    id={scaleId}
                    max={4}
                    min={0.25}
                    step={0.05}
                    type="range"
                    value={background.scale}
                    onChange={(event) => onScaleChange(Number(event.currentTarget.value))}
                  />
                  <button
                    type="button"
                    className="washi-tape-scale-reset-button"
                    disabled={background.scale === 1}
                    onClick={() => onScaleChange(1)}
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="empty-state">No background. Pick one below.</p>
        )}
        <div className="page-background-color-row">
          <label htmlFor={colorId}>Background color</label>
          <input
            id={colorId}
            type="color"
            value={backgroundColor}
            onChange={(event) => onBackgroundColorChange(event.currentTarget.value)}
          />
        </div>
      </section>
      <BackgroundGallery
        layout="rail"
        selectedBackgroundId={background?.backgroundId ?? null}
        onSelect={onSelect}
      />
    </div>
  );
}
