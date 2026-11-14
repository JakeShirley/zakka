import type { PageLayer, PhotoLayer, WashiTapeLayer } from "@zakka/editor-core";

import { NumericInput } from "../../components/NumericInput";
import { PhotoControls } from "./PhotoControls";
import { TextControls } from "./TextControls";
import { WashiTapeControls } from "./WashiTapeControls";

export function LayerInspector({
  layer,
  onChange,
  onChoosePhoto,
  onChooseWashiTapePhoto,
}: {
  layer: PageLayer | null;
  onChange: (update: Partial<PageLayer>) => void;
  /** Opens a photo picker to fill an empty photo placeholder. */
  onChoosePhoto?: ((layerId: string) => void) | undefined;
  onChooseWashiTapePhoto?: ((layerId: string) => void) | undefined;
}) {
  if (!layer) return <p className="empty-state">Select a layer to edit it.</p>;
  const updateNumber = (key: "height" | "rotation" | "width" | "x" | "y") => (value: number) =>
    onChange({ [key]: value } as Partial<PageLayer>);
  const updatePhotoLayer = (update: Partial<PhotoLayer>) => onChange(update as Partial<PageLayer>);
  const updateWashiTapeLayer = (update: Partial<WashiTapeLayer>) =>
    onChange(update as Partial<PageLayer>);

  return (
    <form className="inspector-form">
      <fieldset className="inspector-section layer-inspector-section">
        <legend>Common</legend>
        <div className="layer-controls-grid">
          <label className="opacity-field">
            <span>Opacity</span>
            <input
              max={1}
              min={0}
              step={0.05}
              type="range"
              value={layer.opacity}
              onChange={(event) => onChange({ opacity: Number(event.currentTarget.value) })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layer.locked}
              onChange={(event) => onChange({ locked: event.currentTarget.checked })}
            />
            <span>Locked</span>
          </label>
        </div>
      </fieldset>
      {layer.kind === "text" ? <TextControls layer={layer} onChange={onChange} /> : null}
      {layer.kind === "photo" ? (
        <PhotoControls layer={layer} onChange={updatePhotoLayer} onChoosePhoto={onChoosePhoto} />
      ) : null}
      {layer.kind === "washiTape" ? (
        <WashiTapeControls
          layer={layer}
          onChange={updateWashiTapeLayer}
          onChoosePhoto={onChooseWashiTapePhoto}
        />
      ) : null}
      <fieldset className="inspector-section layer-inspector-section">
        <legend>Transform</legend>
        <div className="layer-controls-grid">
          <label>
            <span>X</span>
            <NumericInput value={layer.x} onChange={updateNumber("x")} />
          </label>
          <label>
            <span>Y</span>
            <NumericInput value={layer.y} onChange={updateNumber("y")} />
          </label>
          <label>
            <span>W</span>
            <NumericInput min={1} value={layer.width} onChange={updateNumber("width")} />
          </label>
          <label>
            <span>H</span>
            <NumericInput min={1} value={layer.height} onChange={updateNumber("height")} />
          </label>
          <label className="rotation-field">
            <span>Rotation</span>
            <NumericInput value={layer.rotation} onChange={updateNumber("rotation")} />
          </label>
        </div>
      </fieldset>
    </form>
  );
}
