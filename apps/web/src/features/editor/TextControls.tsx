import type { PageLayer } from "@zakka/editor-core";
import { useRef } from "react";

import { NumericInput } from "../../components/NumericInput";
import { FontFamilySelect } from "./FontFamilySelect";
import { RichTextEditor, type RichTextEditorHandle } from "./RichTextEditor";
import { TextAlignmentControl, TextVerticalAlignmentControl } from "./TextAlignmentControl";

type TextLayer = Extract<PageLayer, { kind: "text" }>;
type TextEffectKey = "background" | "bubble" | "glow" | "shadow" | "stroke";

export function TextControls({
  layer,
  onChange,
}: {
  layer: TextLayer;
  onChange: (update: Partial<PageLayer>) => void;
}) {
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const updateEffect = <Key extends TextEffectKey>(key: Key, update: Partial<TextLayer[Key]>) =>
    onChange({
      [key]: { ...layer[key], ...update },
    } as Partial<PageLayer>);

  return (
    <>
      <fieldset className="inspector-section text-controls-section">
        <legend>Text</legend>
        <div className="text-content-toolbar" role="toolbar" aria-label="Text formatting">
          <div className="text-content-toolbar-group text-content-toolbar-style">
            <button
              type="button"
              className="text-content-toolbar-button"
              title="Bold (Ctrl/Cmd+B)"
              aria-label="Bold"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editorRef.current?.toggleStyle("bold")}
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className="text-content-toolbar-button"
              title="Italic (Ctrl/Cmd+I)"
              aria-label="Italic"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editorRef.current?.toggleStyle("italic")}
            >
              <em>I</em>
            </button>
          </div>
          <label
            className="text-content-toolbar-field text-content-toolbar-field-font"
            htmlFor="text-layer-font-family"
          >
            <span>Font</span>
            <FontFamilySelect
              id="text-layer-font-family"
              value={layer.fontFamily}
              onChange={(fontFamily) => onChange({ fontFamily } as Partial<PageLayer>)}
            />
          </label>
          <label className="text-content-toolbar-field text-content-toolbar-field-size">
            <span>Font size</span>
            <NumericInput
              max={240}
              min={6}
              value={layer.fontSize}
              onChange={(fontSize) => onChange({ fontSize } as Partial<PageLayer>)}
            />
          </label>
          <label className="text-content-toolbar-field text-content-toolbar-field-color">
            <span>Color</span>
            <input
              type="color"
              value={layer.color}
              onChange={(event) =>
                onChange({ color: event.currentTarget.value } as Partial<PageLayer>)
              }
            />
          </label>
          <div className="text-content-toolbar-field text-alignment-field">
            <span>Align</span>
            <TextAlignmentControl
              value={layer.align}
              onChange={(align) => onChange({ align } as Partial<PageLayer>)}
            />
          </div>
          <div className="text-content-toolbar-field text-alignment-field">
            <span>Vertical</span>
            <TextVerticalAlignmentControl
              value={layer.verticalAlign}
              onChange={(verticalAlign) => onChange({ verticalAlign } as Partial<PageLayer>)}
            />
          </div>
        </div>
        <div className="text-content-field">
          <RichTextEditor
            ref={editorRef}
            ariaLabel="Text"
            id="text-layer-text"
            value={layer.text}
            onChange={(text) => onChange({ text } as Partial<PageLayer>)}
          />
        </div>
        <p className="text-content-hint">
          Use **bold**, *italic*, or ***both*** — markers stay visible and styling updates as you
          type. B/I or Ctrl/Cmd+B and Ctrl/Cmd+I toggle them for the selection.
        </p>
      </fieldset>
      <fieldset className="inspector-section text-effects-section">
        <legend>Effects</legend>
        <div className="text-effects-grid">
          <section className="text-effect-card" aria-label="Stroke">
            <label className="checkbox-label compact-checkbox">
              <input
                type="checkbox"
                checked={layer.stroke.enabled}
                onChange={(event) =>
                  updateEffect("stroke", { enabled: event.currentTarget.checked })
                }
              />
              <span>Stroke</span>
            </label>
            <div className="text-effect-controls-grid">
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={layer.stroke.color}
                  onChange={(event) => updateEffect("stroke", { color: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>Width</span>
                <NumericInput
                  max={80}
                  min={0}
                  value={layer.stroke.width}
                  onChange={(width) => updateEffect("stroke", { width })}
                />
              </label>
            </div>
          </section>
          <section className="text-effect-card text-effect-card-wide" aria-label="Drop shadow">
            <label className="checkbox-label compact-checkbox">
              <input
                type="checkbox"
                checked={layer.shadow.enabled}
                onChange={(event) =>
                  updateEffect("shadow", { enabled: event.currentTarget.checked })
                }
              />
              <span>Drop shadow</span>
            </label>
            <div className="text-effect-controls-grid text-effect-controls-grid-wide">
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={layer.shadow.color}
                  onChange={(event) => updateEffect("shadow", { color: event.currentTarget.value })}
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
                  onChange={(event) =>
                    updateEffect("shadow", { opacity: Number(event.currentTarget.value) })
                  }
                />
              </label>
              <label>
                <span>X</span>
                <NumericInput
                  max={240}
                  min={-240}
                  value={layer.shadow.offsetX}
                  onChange={(offsetX) => updateEffect("shadow", { offsetX })}
                />
              </label>
              <label>
                <span>Y</span>
                <NumericInput
                  max={240}
                  min={-240}
                  value={layer.shadow.offsetY}
                  onChange={(offsetY) => updateEffect("shadow", { offsetY })}
                />
              </label>
              <label>
                <span>Blur</span>
                <NumericInput
                  max={160}
                  min={0}
                  value={layer.shadow.blur}
                  onChange={(blur) => updateEffect("shadow", { blur })}
                />
              </label>
            </div>
          </section>
          <section className="text-effect-card" aria-label="Glow">
            <label className="checkbox-label compact-checkbox">
              <input
                type="checkbox"
                checked={layer.glow.enabled}
                onChange={(event) => updateEffect("glow", { enabled: event.currentTarget.checked })}
              />
              <span>Glow</span>
            </label>
            <div className="text-effect-controls-grid">
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={layer.glow.color}
                  onChange={(event) => updateEffect("glow", { color: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>Opacity</span>
                <input
                  max={1}
                  min={0}
                  step={0.05}
                  type="range"
                  value={layer.glow.opacity}
                  onChange={(event) =>
                    updateEffect("glow", { opacity: Number(event.currentTarget.value) })
                  }
                />
              </label>
              <label>
                <span>Blur</span>
                <NumericInput
                  max={160}
                  min={0}
                  value={layer.glow.blur}
                  onChange={(blur) => updateEffect("glow", { blur })}
                />
              </label>
            </div>
          </section>
          <section className="text-effect-card" aria-label="Highlight">
            <label className="checkbox-label compact-checkbox">
              <input
                type="checkbox"
                checked={layer.background.enabled}
                onChange={(event) =>
                  updateEffect("background", { enabled: event.currentTarget.checked })
                }
              />
              <span>Highlight</span>
            </label>
            <div className="text-effect-controls-grid">
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={layer.background.color}
                  onChange={(event) =>
                    updateEffect("background", { color: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                <span>Opacity</span>
                <input
                  max={1}
                  min={0}
                  step={0.05}
                  type="range"
                  value={layer.background.opacity}
                  onChange={(event) =>
                    updateEffect("background", { opacity: Number(event.currentTarget.value) })
                  }
                />
              </label>
              <label>
                <span>Padding</span>
                <NumericInput
                  max={120}
                  min={0}
                  value={layer.background.padding}
                  onChange={(padding) => updateEffect("background", { padding })}
                />
              </label>
              <label>
                <span>Radius</span>
                <NumericInput
                  max={160}
                  min={0}
                  value={layer.background.radius}
                  onChange={(radius) => updateEffect("background", { radius })}
                />
              </label>
            </div>
          </section>
          <section className="text-effect-card" aria-label="Bubble letters">
            <label className="checkbox-label compact-checkbox">
              <input
                type="checkbox"
                checked={layer.bubble.enabled}
                onChange={(event) =>
                  updateEffect("bubble", { enabled: event.currentTarget.checked })
                }
              />
              <span>Bubble letters</span>
            </label>
            <div className="text-effect-controls-grid">
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={layer.bubble.color}
                  onChange={(event) => updateEffect("bubble", { color: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>Opacity</span>
                <input
                  max={1}
                  min={0}
                  step={0.05}
                  type="range"
                  value={layer.bubble.opacity}
                  onChange={(event) =>
                    updateEffect("bubble", { opacity: Number(event.currentTarget.value) })
                  }
                />
              </label>
              <label>
                <span>Size</span>
                <NumericInput
                  max={120}
                  min={0}
                  value={layer.bubble.padding}
                  onChange={(padding) => updateEffect("bubble", { padding })}
                />
              </label>
              <label>
                <span>Spacing</span>
                <input
                  max={120}
                  min={0}
                  step={1}
                  type="range"
                  value={layer.bubble.spacing}
                  onChange={(event) =>
                    updateEffect("bubble", { spacing: Number(event.currentTarget.value) })
                  }
                />
              </label>
            </div>
          </section>
        </div>
      </fieldset>
    </>
  );
}
