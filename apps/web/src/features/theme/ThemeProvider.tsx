import { FluentProvider } from "@fluentui/react-components";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { apiClient } from "../../apiClient";
import {
  getUiTheme,
  readStoredUiThemePreference,
  resolveUiTheme,
  storeUiThemePreference,
  type UiThemeId,
  type UiThemePreference,
} from "./themes";

type ThemeContextValue = {
  preference: UiThemePreference;
  themeId: UiThemeId;
  /**
   * Applies a user-chosen preference immediately, caches it on this device, and
   * saves it to the account. Saves are serialized so the latest choice always
   * wins; if saving fails the last confirmed preference is restored and the
   * returned promise rejects.
   */
  choosePreference: (preference: UiThemePreference) => Promise<void>;
  /**
   * Applies a preference loaded from the server unless the user picked a
   * different theme while the request was in flight.
   */
  syncPreference: (load: () => Promise<UiThemePreference>) => Promise<void>;
};

const saveUiThemePreference = async (uiTheme: UiThemePreference) => {
  await apiClient.updateAccountPreferences({ uiTheme });
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const darkSchemeQuery = "(prefers-color-scheme: dark)";

const subscribeToColorScheme = (onChange: () => void) => {
  if (typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const query = window.matchMedia(darkSchemeQuery);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
};

const getPrefersDark = () =>
  typeof window.matchMedia === "function" && window.matchMedia(darkSchemeQuery).matches;

export function ThemeProvider({
  children,
  initialPreference,
}: {
  children: ReactNode;
  initialPreference?: UiThemePreference;
}) {
  const [preference, setPreferenceState] = useState<UiThemePreference>(
    () => initialPreference ?? readStoredUiThemePreference(),
  );
  const prefersDark = useSyncExternalStore(subscribeToColorScheme, getPrefersDark, () => false);
  const themeId = resolveUiTheme(preference, prefersDark);
  const theme = getUiTheme(themeId);
  const versionRef = useRef(0);
  const currentRef = useRef(preference);
  // Last preference the server is known to hold; null until loaded or first saved.
  const confirmedRef = useRef<UiThemePreference | null>(null);
  const pendingSaveRef = useRef<Promise<void> | null>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.id;
    root.style.colorScheme = theme.colorScheme;
  }, [theme]);

  const applyPreference = useCallback((next: UiThemePreference) => {
    currentRef.current = next;
    setPreferenceState(next);
    storeUiThemePreference(next);
  }, []);

  const flushSaves = useCallback(async () => {
    while (currentRef.current !== confirmedRef.current) {
      const target = currentRef.current;

      try {
        await saveUiThemePreference(target);
        confirmedRef.current = target;
      } catch (error: unknown) {
        // A newer choice made during the failed request gets its own attempt.
        if (currentRef.current === target) {
          applyPreference(confirmedRef.current ?? target);
          throw error;
        }
      }
    }
  }, [applyPreference]);

  const choosePreference = useCallback(
    (next: UiThemePreference) => {
      confirmedRef.current ??= currentRef.current;
      versionRef.current += 1;
      applyPreference(next);

      pendingSaveRef.current ??= flushSaves().finally(() => {
        pendingSaveRef.current = null;
      });

      return pendingSaveRef.current;
    },
    [applyPreference, flushSaves],
  );

  const syncPreference = useCallback(
    async (load: () => Promise<UiThemePreference>) => {
      const version = versionRef.current;
      const remote = await load();

      if (versionRef.current === version && !pendingSaveRef.current) {
        confirmedRef.current = remote;
        applyPreference(remote);
      }
    },
    [applyPreference],
  );

  const value = useMemo(
    () => ({ preference, themeId, choosePreference, syncPreference }),
    [preference, themeId, choosePreference, syncPreference],
  );

  return (
    <ThemeContext.Provider value={value}>
      <FluentProvider className="fluent-root" theme={theme.fluentTheme}>
        {children}
      </FluentProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
