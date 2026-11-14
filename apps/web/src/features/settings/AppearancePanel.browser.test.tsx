import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { apiClient } from "../../apiClient";
import { type ThemeContextValue, ThemeProvider, useTheme } from "../theme/ThemeProvider";
import { type UiThemePreference, uiThemeStorageKey } from "../theme/themes";
import { AppearancePanel } from "./AppearancePanel";

beforeEach(() => {
  window.localStorage.removeItem(uiThemeStorageKey);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(uiThemeStorageKey);
});

describe("AppearancePanel", () => {
  test("applies, caches, and saves the selected theme", async () => {
    const updatePreferences = vi
      .spyOn(apiClient, "updateAccountPreferences")
      .mockImplementation(async (input) => ({ uiTheme: input.uiTheme ?? "system" }));

    await render(
      <ThemeProvider initialPreference="light">
        <AppearancePanel />
      </ThemeProvider>,
    );

    expect(document.documentElement.dataset.theme).toBe("light");

    await page.getByText("Sakura", { exact: true }).click();

    await expect.element(page.getByRole("radio", { name: /^Sakura/ })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("sakura");
    expect(window.localStorage.getItem(uiThemeStorageKey)).toBe("sakura");
    expect(updatePreferences).toHaveBeenCalledWith({ uiTheme: "sakura" });

    await page.getByText("Dark", { exact: true }).click();

    await expect.element(page.getByRole("radio", { name: /^Dark/ })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(updatePreferences).toHaveBeenLastCalledWith({ uiTheme: "dark" });
  });

  test("serializes saves so the latest rapid choice wins", async () => {
    const pendingSaves: Array<{ uiTheme: string | undefined; resolve: () => void }> = [];
    const updatePreferences = vi.spyOn(apiClient, "updateAccountPreferences").mockImplementation(
      (input) =>
        new Promise((resolve) => {
          pendingSaves.push({
            uiTheme: input.uiTheme,
            resolve: () => resolve({ uiTheme: input.uiTheme ?? "system" }),
          });
        }),
    );

    await render(
      <ThemeProvider initialPreference="light">
        <AppearancePanel />
      </ThemeProvider>,
    );

    await page.getByText("Sakura", { exact: true }).click();
    await page.getByText("System", { exact: true }).click();
    await page.getByText("Dark", { exact: true }).click();

    await expect.element(page.getByRole("radio", { name: /^Dark/ })).toBeChecked();
    expect(pendingSaves.map((save) => save.uiTheme)).toEqual(["sakura"]);

    pendingSaves[0]?.resolve();
    await vi.waitFor(() => expect(pendingSaves).toHaveLength(2));
    expect(pendingSaves[1]?.uiTheme).toBe("dark");
    pendingSaves[1]?.resolve();

    await vi.waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(uiThemeStorageKey)).toBe("dark");
  });

  test("reverts the theme when saving fails", async () => {
    vi.spyOn(apiClient, "updateAccountPreferences").mockRejectedValue(new Error("Offline"));

    await render(
      <ThemeProvider initialPreference="light">
        <AppearancePanel />
      </ThemeProvider>,
    );

    await page.getByText("Dark", { exact: true }).click();

    await expect.element(page.getByRole("alert")).toHaveTextContent(/Could not save your theme/);
    await expect.element(page.getByRole("radio", { name: /^Light/ })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(uiThemeStorageKey)).toBe("light");
  });

  test("saves the cached theme when a choice made before the account loads is reverted", async () => {
    const pendingSaves: Array<{
      uiTheme: string | undefined;
      resolve: () => void;
      reject: (error: Error) => void;
    }> = [];
    vi.spyOn(apiClient, "updateAccountPreferences").mockImplementation(
      (input) =>
        new Promise((resolve, reject) => {
          pendingSaves.push({
            uiTheme: input.uiTheme,
            resolve: () => resolve({ uiTheme: input.uiTheme ?? "system" }),
            reject,
          });
        }),
    );
    let theme: ThemeContextValue | undefined;

    await render(
      <ThemeProvider initialPreference="light">
        <ThemeProbe onTheme={(value) => (theme = value)} />
        <AppearancePanel />
      </ThemeProvider>,
    );

    void theme?.syncPreference(() => new Promise<UiThemePreference>(() => undefined));
    await page.getByText("Dark", { exact: true }).click();
    await page.getByText("Light", { exact: true }).click();

    pendingSaves[0]?.reject(new Error("Offline"));

    await vi.waitFor(() => expect(pendingSaves).toHaveLength(2));
    expect(pendingSaves[1]?.uiTheme).toBe("light");
  });

  test("drops queued saves once the account session ends", async () => {
    const pendingSaves: Array<{ uiTheme: string | undefined; resolve: () => void }> = [];
    vi.spyOn(apiClient, "updateAccountPreferences").mockImplementation(
      (input) =>
        new Promise((resolve) => {
          pendingSaves.push({
            uiTheme: input.uiTheme,
            resolve: () => resolve({ uiTheme: input.uiTheme ?? "system" }),
          });
        }),
    );
    let theme: ThemeContextValue | undefined;

    await render(
      <ThemeProvider initialPreference="light">
        <ThemeProbe onTheme={(value) => (theme = value)} />
        <AppearancePanel />
      </ThemeProvider>,
    );

    await page.getByText("Sakura", { exact: true }).click();
    await page.getByText("Dark", { exact: true }).click();
    theme?.endAccountSession();
    pendingSaves[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(pendingSaves.map((save) => save.uiTheme)).toEqual(["sakura"]);
  });
});

function ThemeProbe({ onTheme }: { onTheme: (theme: ThemeContextValue) => void }) {
  onTheme(useTheme());

  return null;
}
