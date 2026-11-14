import { Button } from "@fluentui/react-components";
import { ImageAddRegular, PageFitRegular } from "@fluentui/react-icons";
import { isPhotoPlaceholder, type PhotoLayer, resetPhotoLayerEdits } from "@zakka/editor-core";

import { NumericInput } from "../../components/NumericInput";

export function PhotoControls({
  layer,
  onChange,
  onChoosePhoto,
}: {
  layer: PhotoLayer;
  onChange: (update: Partial<PhotoLayer>) => void;
  onChoosePhoto?: ((layerId: string) => void) | undefined;
}) {
  const updatePhotoTransform = (update: Partial<PhotoLayer["photoTransform"]>) =>
    onChange({ photoTransform: { ...layer.photoTransform, ...update } });
  const updateCrop = (update: Partial<PhotoLayer["crop"]>) =>
    onChange({ crop: { ...layer.crop, ...update } });
  const updateBorder = (update: Partial<PhotoLayer["border"]>) =>
    onChange({ border: { ...layer.border, ...update } });
  const updateMask = (update: Partial<PhotoLayer["mask"]>) =>
    onChange({ mask: { ...layer.mask, ...update } });
  const updateFilter = (update: Partial<PhotoLayer["filter"]>) =>
    onChange({ filter: { ...layer.filter, ...update } });
  const updateShadow = (update: Partial<PhotoLayer["shadow"]>) =>
    onChange({ shadow: { ...layer.shadow, ...update } });

  const placeholder = isPhotoPlaceholder(layer);

  return (
    <>
      {placeholder ? (
        <fieldset className="inspector-section">
          <legend>Photo placeholder</legend>
          <p className="photo-placeholder-hint">This frame is waiting for a photo.</p>
          {onChoosePhoto ? (
            <Button
              type="button"
              appearance="primary"
              className="full-width-button"
              icon={<ImageAddRegular />}
              onClick={() => onChoosePhoto(layer.id)}
            >
              Choose photo
            </Button>
          ) : null}
        </fieldset>
      ) : (
        <>
          <fieldset className="inspector-section">
            <legend>Photo</legend>
            <label>
              <span>Fit</span>
              <select
                value={layer.fit}
                onChange={(event) =>
                  onChange({ fit: event.currentTarget.value as PhotoLayer["fit"] })
                }
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
              </select>
            </label>
            <label>
              <span>Filter</span>
              <select
                value={layer.filter.preset}
                onChange={(event) =>
                  updateFilter({
                    preset: event.currentTarget.value as PhotoLayer["filter"]["preset"],
                  })
                }
              >
                <option value="none">None</option>
                <option value="warm">Warm</option>
                <option value="cool">Cool</option>
                <option value="mono">Mono</option>
                <option value="fade">Fade</option>
                <option value="sepia">Sepia</option>
              </select>
            </label>
          </fieldset>
          <fieldset className="inspector-section">
            <legend>Transform</legend>
            <label>
              <span>Scale</span>
              <input
                max={5}
                min={0.1}
                step={0.05}
                type="range"
                value={layer.photoTransform.scale}
                onChange={(event) =>
                  updatePhotoTransform({ scale: Number(event.currentTarget.value) })
                }
              />
            </label>
            <div className="inspector-grid">
              <label>
                <span>Offset X</span>
                <NumericInput
                  max={1}
                  min={-1}
                  step={0.01}
                  value={layer.photoTransform.offsetX}
                  onChange={(offsetX) => updatePhotoTransform({ offsetX })}
                />
              </label>
              <label>
                <span>Offset Y</span>
                <NumericInput
                  max={1}
                  min={-1}
                  step={0.01}
                  value={layer.photoTransform.offsetY}
                  onChange={(offsetY) => updatePhotoTransform({ offsetY })}
                />
              </label>
            </div>
          </fieldset>
          <fieldset className="inspector-section">
            <legend>Crop</legend>
            <div className="inspector-grid">
              <label>
                <span>Crop X</span>
                <NumericInput
                  max={1 - layer.crop.width}
                  min={0}
                  step={0.01}
                  value={layer.crop.x}
                  onChange={(x) => updateCrop({ x })}
                />
              </label>
              <label>
                <span>Crop Y</span>
                <NumericInput
                  max={1 - layer.crop.height}
                  min={0}
                  step={0.01}
                  value={layer.crop.y}
                  onChange={(y) => updateCrop({ y })}
                />
              </label>
              <label>
                <span>Crop W</span>
                <NumericInput
                  max={1 - layer.crop.x}
                  min={0.05}
                  step={0.01}
                  value={layer.crop.width}
                  onChange={(width) => updateCrop({ width })}
                />
              </label>
              <label>
                <span>Crop H</span>
                <NumericInput
                  max={1 - layer.crop.y}
                  min={0.05}
                  step={0.01}
                  value={layer.crop.height}
                  onChange={(height) => updateCrop({ height })}
                />
              </label>
            </div>
          </fieldset>
        </>
      )}
      <fieldset className="inspector-section">
        <legend>Frame</legend>
        <div className="inspector-grid">
          <label>
            <span>Frame</span>
            <select
              value={layer.border.framePreset}
              onChange={(event) =>
                updateBorder({
                  framePreset: event.currentTarget.value as PhotoLayer["border"]["framePreset"],
                })
              }
            >
              <option value="none">None</option>
              <option value="mat">Mat</option>
              <option value="polaroid">Polaroid</option>
              <option value="film">Film</option>
              <option value="paper">Paper</option>
            </select>
          </label>
          <label>
            <span>Border</span>
            <NumericInput
              max={160}
              min={0}
              value={layer.border.width}
              onChange={(width) => updateBorder({ width })}
            />
          </label>
          <label>
            <span>Mask</span>
            <select
              value={layer.mask.shape}
              onChange={(event) =>
                updateMask({ shape: event.currentTarget.value as PhotoLayer["mask"]["shape"] })
              }
            >
              <option value="rectangle">Rectangle</option>
              <option value="ellipse">Ellipse</option>
              <option value="arch">Arch</option>
              <option value="diamond">Diamond</option>
              <option value="ticket">Ticket</option>
            </select>
          </label>
        </div>
        <label>
          <span>Border color</span>
          <input
            type="color"
            value={layer.border.color}
            onChange={(event) => updateBorder({ color: event.currentTarget.value })}
          />
        </label>
      </fieldset>
      <fieldset className="inspector-section">
        <legend>Drop shadow</legend>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={layer.shadow.enabled}
            onChange={(event) => updateShadow({ enabled: event.currentTarget.checked })}
          />
          <span>Enable drop shadow</span>
        </label>
        <label>
          <span>Color</span>
          <input
            type="color"
            value={layer.shadow.color}
            onChange={(event) => updateShadow({ color: event.currentTarget.value })}
          />
        </label>
        <label>
          <span>Opacity</span>
          <input
            max={1}
            min={0}
            step={0.05}
            type="range"
            value={layer.shadow.opacity}
            onChange={(event) => updateShadow({ opacity: Number(event.currentTarget.value) })}
          />
        </label>
        <div className="inspector-grid">
          <label>
            <span>Offset X</span>
            <NumericInput
              max={400}
              min={-400}
              value={layer.shadow.offsetX}
              onChange={(offsetX) => updateShadow({ offsetX })}
            />
          </label>
          <label>
            <span>Offset Y</span>
            <NumericInput
              max={400}
              min={-400}
              value={layer.shadow.offsetY}
              onChange={(offsetY) => updateShadow({ offsetY })}
            />
          </label>
          <label>
            <span>Blur</span>
            <NumericInput
              max={400}
              min={0}
              value={layer.shadow.blur}
              onChange={(blur) => updateShadow({ blur })}
            />
          </label>
          <label>
            <span>Spread</span>
            <NumericInput
              max={160}
              min={-120}
              value={layer.shadow.spread}
              onChange={(spread) => updateShadow({ spread })}
            />
          </label>
        </div>
      </fieldset>
      {placeholder ? null : (
        <Button
          type="button"
          className="secondary-button full-width-button"
          icon={<PageFitRegular />}
          onClick={() => onChange(resetPhotoLayerEdits(layer))}
        >
          Reset photo edits
        </Button>
      )}
    </>
  );
}
