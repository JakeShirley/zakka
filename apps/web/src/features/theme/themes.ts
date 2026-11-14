import {
  type BrandVariants,
  createLightTheme,
  type Theme,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import {
  defaultUiThemePreference,
  isUiThemePreference,
  type UiThemeId,
  type UiThemePreference,
} from "@zakka/api-contract";

export type { UiThemeId, UiThemePreference };

const sakuraBrandVariants: BrandVariants = {
  10: "#1f0610",
  20: "#33091a",
  30: "#4a0d26",
  40: "#611232",
  50: "#78173e",
  60: "#8e2a50",
  70: "#a8325f",
  80: "#c43b6e",
  90: "#cf5482",
  100: "#d86c95",
  110: "#e084a8",
  120: "#e89cba",
  130: "#efb3cb",
  140: "#f4c9da",
  150: "#f9dde8",
  160: "#fdf0f4",
};

const sakuraTheme: Theme = {
  ...createLightTheme(sakuraBrandVariants),
  colorNeutralBackground1: "#fffafb",
  colorNeutralBackground2: "#fff5f7",
  colorNeutralBackground3: "#fdf0f3",
  colorNeutralForeground1: "#2f1f25",
  colorNeutralForeground2: "#4d3a41",
  colorNeutralForeground3: "#6e5a61",
  colorNeutralStroke1: "#e6c3cd",
  colorNeutralStroke2: "#f2dbe1",
};

export type UiThemeDefinition = {
  id: UiThemeId;
  label: string;
  description: string;
  colorScheme: "light" | "dark";
  fluentTheme: Theme;
  /** Representative colors used to render the theme picker preview. */
  preview: { background: string; surface: string; accent: string; text: string };
};

const lightTheme: UiThemeDefinition = {
  id: "light",
  label: "Light",
  description: "Clean, bright workspace.",
  colorScheme: "light",
  fluentTheme: webLightTheme,
  preview: { background: "#f5f5f5", surface: "#ffffff", accent: "#0f6cbd", text: "#242424" },
};

export const uiThemes: readonly UiThemeDefinition[] = [
  lightTheme,
  {
    id: "dark",
    label: "Dark",
    description: "Dim chrome that keeps pages in focus.",
    colorScheme: "dark",
    fluentTheme: webDarkTheme,
    preview: { background: "#1a1a1a", surface: "#292929", accent: "#479ef5", text: "#ffffff" },
  },
  {
    id: "sakura",
    label: "Sakura",
    description: "Soft cherry-blossom pinks.",
    colorScheme: "light",
    fluentTheme: sakuraTheme,
    preview: { background: "#fdf0f3", surface: "#fffafb", accent: "#c43b6e", text: "#2f1f25" },
  },
];

export const getUiTheme = (id: UiThemeId): UiThemeDefinition =>
  uiThemes.find((theme) => theme.id === id) ?? lightTheme;

export const resolveUiTheme = (preference: UiThemePreference, prefersDark: boolean): UiThemeId => {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }

  return preference;
};

// Keep in sync with the inline bootstrap script in apps/web/index.html.
export const uiThemeStorageKey = "scrapbook:ui-theme";

export const readStoredUiThemePreference = (): UiThemePreference => {
  try {
    const value = window.localStorage.getItem(uiThemeStorageKey);

    return isUiThemePreference(value) ? value : defaultUiThemePreference;
  } catch {
    return defaultUiThemePreference;
  }
};

export const storeUiThemePreference = (preference: UiThemePreference) => {
  try {
    window.localStorage.setItem(uiThemeStorageKey, preference);
  } catch {
    // The theme still applies for this page load if localStorage is unavailable.
  }
};
