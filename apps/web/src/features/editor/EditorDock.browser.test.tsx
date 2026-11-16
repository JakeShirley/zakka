import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { useEffect } from "react";
import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { type DockLocation, EditorDock, type EditorDockPane, useDockLayout } from "./EditorDock";

const dockStorageKey = "scrapbook:editor-dock";

function DockHarness({ isEditing = false }: { isEditing?: boolean }) {
  const dockLayout = useDockLayout();
  const { focusPane } = dockLayout;
  useEffect(() => {
    if (isEditing) {
      focusPane("edit");
    }
  }, [focusPane, isEditing]);
  const panes: EditorDockPane[] = [
    { id: "add", label: "Add", content: <p>Add content</p> },
    { id: "pages", label: "Pages", content: <p>Pages content</p> },
    { id: "photos", label: "Photos", badge: 3, content: <p>Photos content</p> },
    isEditing
      ? {
          id: "edit",
          label: "Edit",
          title: "Edit Text",
          role: "dialog",
          actions: <button type="button">Undo</button>,
          content: <p>Edit content</p>,
        }
      : { id: "edit", label: "Edit", content: <p>Nothing selected</p> },
  ];
  const renderDock = (location: DockLocation) => (
    <div data-testid={`${location}-dock`}>
      <EditorDock
        activePaneId={dockLayout.activePanes[location]}
        location={location}
        panes={panes.filter((pane) => dockLayout.layout[pane.id] === location)}
        onMovePane={dockLayout.movePane}
        onSelectPane={dockLayout.selectPane}
      />
    </div>
  );
  return (
    <FluentProvider theme={webLightTheme}>
      {renderDock("side")}
      {renderDock("bottom")}
    </FluentProvider>
  );
}

const sideDock = () => page.getByTestId("side-dock");
const bottomDock = () => page.getByTestId("bottom-dock");

describe("EditorDock", () => {
  beforeEach(() => {
    localStorage.removeItem(dockStorageKey);
  });

  test("moves the active tab between the side panel and the bottom tray", async () => {
    await render(<DockHarness />);

    const sideTabs = sideDock().getByRole("tablist", { name: "Side panel" });
    await expect
      .element(sideTabs.getByRole("tab", { name: "Add" }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(sideDock().getByText("Add content")).toBeVisible();
    await expect.element(bottomDock().getByText("Pages content")).toBeVisible();

    await sideTabs.getByRole("tab", { name: "Photos" }).click();
    await expect.element(sideDock().getByText("Photos content")).toBeVisible();
    await page.getByRole("button", { name: "Move Photos tab to bottom" }).click();

    const bottomTabs = bottomDock().getByRole("tablist", { name: "Bottom panel" });
    await expect
      .element(bottomTabs.getByRole("tab", { name: "Photos" }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(bottomDock().getByText("Photos content")).toBeVisible();
    expect(sideTabs.getByRole("tab").all()).toHaveLength(2);
    expect(sideTabs.getByRole("tab", { name: "Photos" }).query()).toBeNull();
    await expect.element(sideDock().getByText("Add content")).toBeVisible();

    await bottomTabs.getByRole("tab", { name: "Pages" }).click();
    await expect.element(bottomDock().getByText("Pages content")).toBeVisible();
    expect(bottomDock().getByText("Photos content").query()).toBeNull();

    expect(JSON.parse(localStorage.getItem(dockStorageKey) ?? "null")).toEqual({
      layout: { add: "side", pages: "bottom", photos: "bottom", edit: "side" },
      activePanes: { bottom: "pages" },
    });
  });

  test("restores the saved layout", async () => {
    localStorage.setItem(
      dockStorageKey,
      JSON.stringify({ layout: { pages: "side", photos: "bottom" }, activePanes: {} }),
    );

    await render(<DockHarness />);

    await expect.element(bottomDock().getByText("Photos content")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Move Photos tab to side panel" }))
      .toBeVisible();
    await sideDock().getByRole("tab", { name: "Pages" }).click();
    await expect.element(sideDock().getByText("Pages content")).toBeVisible();
  });

  test("editing brings the Edit tab forward without locking the other tabs", async () => {
    await render(<DockHarness isEditing />);

    const editDialog = sideDock().getByRole("dialog", { name: "Edit Text" });
    await expect.element(editDialog).toBeVisible();
    await expect.element(editDialog.getByRole("heading", { name: "Edit Text" })).toBeVisible();
    await expect.element(editDialog.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect
      .element(sideDock().getByRole("tab", { name: "Edit" }))
      .toHaveAttribute("aria-selected", "true");

    await sideDock().getByRole("tab", { name: "Add" }).click();
    await expect.element(sideDock().getByText("Add content")).toBeVisible();
    expect(sideDock().getByRole("dialog").query()).toBeNull();

    await sideDock().getByRole("tab", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Move Edit tab to bottom" }).click();
    await expect.element(bottomDock().getByRole("dialog", { name: "Edit Text" })).toBeVisible();
    await expect.element(sideDock().getByText("Add content")).toBeVisible();
  });
});
