import type { UiThemePreference } from "@zakka/api-contract";
import { useState } from "react";

import { Panel } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";
import { useTheme } from "../theme/ThemeProvider";
import { getUiTheme, type UiThemeDefinition, uiThemes } from "../theme/themes";

type ThemeOption = {
  id: UiThemePreference;
  label: string;
  description: string;
  previews: UiThemeDefinition["preview"][];
};

const themeOptions: ThemeOption[] = [
  {
    id: "system",
    label: "System",
    description: "Match your device's light or dark setting.",
    previews: [getUiTheme("light").preview, getUiTheme("dark").preview],
  },
  ...uiThemes.map((theme) => ({
    id: theme.id,
    label: theme.label,
    description: theme.description,
    previews: [theme.preview],
  })),
];

function ThemePreview({ previews }: { previews: UiThemeDefinition["preview"][] }) {
  return (
    <span className="theme-option-preview" aria-hidden="true">
      {previews.map((preview) => (
        <span
          className="theme-option-preview-pane"
          key={preview.background}
          style={{ background: preview.background }}
        >
          <span className="theme-option-preview-sidebar" style={{ background: preview.surface }}>
            <span style={{ background: preview.accent }} />
            <span style={{ background: preview.text }} />
            <span style={{ background: preview.text }} />
          </span>
          <span className="theme-option-preview-card" style={{ background: preview.surface }}>
            <span style={{ background: preview.text }} />
            <span style={{ background: preview.accent }} />
          </span>
        </span>
      ))}
    </span>
  );
}

export function AppearancePanel() {
  const { preference, choosePreference } = useTheme();
  const [error, setError] = useState<string | null>(null);

  const selectPreference = async (next: UiThemePreference) => {
    if (next === preference) {
      return;
    }

    setError(null);

    try {
      await choosePreference(next);
    } catch (saveError: unknown) {
      setError(`Could not save your theme. ${getErrorMessage(saveError)}`);
    }
  };

  return (
    <Panel title="Theme">
      <div className="appearance-panel">
        <p className="appearance-panel-hint">
          Changes the app's colors. Your books and pages are not affected.
        </p>
        <div className="theme-option-grid" role="radiogroup" aria-label="Theme">
          {themeOptions.map((option) => (
            <label className="theme-option" key={option.id} data-theme-option={option.id}>
              <input
                type="radio"
                name="ui-theme"
                value={option.id}
                checked={preference === option.id}
                onChange={() => void selectPreference(option.id)}
              />
              <ThemePreview previews={option.previews} />
              <span className="theme-option-text">
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        {error ? (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
