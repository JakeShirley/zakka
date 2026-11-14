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

export type ThemeContextValue = {
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
  /**
   * Forgets the signed-in account's server state, ignoring in-flight loads and
   * dropping queued saves so they never apply to a different account.
   */
  endAccountSession: () => void;
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
  const sessionRef = useRef(0);
  const currentRef = useRef(preference);
  // Last preference the server is known to hold; null until loaded or first saved.
  const confirmedRef = useRef<UiThemePreference | null>(null);
  // Preference restored when a save fails: the confirmed value, or the device cache before then.
  const rollbackRef = useRef(preference);
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
    const session = sessionRef.current;

    while (sessionRef.current === session && currentRef.current !== confirmedRef.current) {
      const target = currentRef.current;

      try {
        await saveUiThemePreference(target);

        if (sessionRef.current === session) {
          confirmedRef.current = target;
          rollbackRef.current = target;
        }
      } catch (error: unknown) {
        // A newer choice made during the failed request gets its own attempt.
        if (sessionRef.current === session && currentRef.current === target) {
          applyPreference(rollbackRef.current);
          throw error;
        }
      }
    }
  }, [applyPreference]);

  const choosePreference = useCallback(
    (next: UiThemePreference) => {
      versionRef.current += 1;
      applyPreference(next);

      if (!pendingSaveRef.current) {
        const pending = flushSaves().finally(() => {
          if (pendingSaveRef.current === pending) {
            pendingSaveRef.current = null;
          }
        });
        pendingSaveRef.current = pending;
      }

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
        rollbackRef.current = remote;
        applyPreference(remote);
      }
    },
    [applyPreference],
  );

  const endAccountSession = useCallback(() => {
    sessionRef.current += 1;
    versionRef.current += 1;
    confirmedRef.current = null;
    rollbackRef.current = currentRef.current;
    pendingSaveRef.current = null;
  }, []);

  const value = useMemo(
    () => ({ preference, themeId, choosePreference, syncPreference, endAccountSession }),
    [preference, themeId, choosePreference, syncPreference, endAccountSession],
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
