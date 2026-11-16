import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { type DockLocation, EditorDock, type EditorDockPane, useDockLayout } from "./EditorDock";

const dockStorageKey = "scrapbook:editor-dock";

function DockHarness({ withEditPane = false }: { withEditPane?: boolean }) {
  const dockLayout = useDockLayout();
  const panes: EditorDockPane[] = [
    { id: "pages", label: "Pages", content: <p>Pages content</p> },
    { id: "photos", label: "Photos", badge: 3, content: <p>Photos content</p> },
    ...(withEditPane
      ? [
          {
            id: "edit",
            label: "Edit panel",
            title: "Edit Text",
            isContextual: true,
            role: "dialog",
            content: <p>Edit content</p>,
          } satisfies EditorDockPane,
        ]
      : []),
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

  test("moves photos to the bottom tray, where panes become tabs", async () => {
    await render(<DockHarness />);

    await expect.element(sideDock().getByText("Photos content")).toBeVisible();
    await expect.element(bottomDock().getByText("Pages content")).toBeVisible();

    await page.getByRole("button", { name: "Move photos to bottom" }).click();

    const bottomTabs = bottomDock().getByRole("tablist", { name: "Bottom panel" });
    await expect
      .element(bottomTabs.getByRole("tab", { name: "Photos" }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(bottomDock().getByText("Photos content")).toBeVisible();
    expect(sideDock().element().childElementCount).toBe(0);

    await bottomTabs.getByRole("tab", { name: "Pages" }).click();
    await expect.element(bottomDock().getByText("Pages content")).toBeVisible();
    expect(bottomDock().getByText("Photos content").query()).toBeNull();

    expect(JSON.parse(localStorage.getItem(dockStorageKey) ?? "null")).toEqual({
      layout: { pages: "bottom", photos: "bottom", edit: "side" },
      activePanes: { bottom: "pages" },
    });
  });

  test("restores the saved layout", async () => {
    localStorage.setItem(
      dockStorageKey,
      JSON.stringify({ layout: { pages: "side", photos: "bottom" }, activePanes: {} }),
    );

    await render(<DockHarness />);

    await expect.element(sideDock().getByText("Pages content")).toBeVisible();
    await expect.element(bottomDock().getByText("Photos content")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Move pages to bottom" })).toBeVisible();
  });

  test("the contextual edit panel takes over its dock and can move", async () => {
    await render(<DockHarness withEditPane />);

    await expect.element(sideDock().getByRole("dialog", { name: "Edit Text" })).toBeVisible();
    expect(sideDock().getByText("Photos content").query()).toBeNull();

    await page.getByRole("button", { name: "Move edit panel to bottom" }).click();

    await expect.element(bottomDock().getByRole("dialog", { name: "Edit Text" })).toBeVisible();
    await expect.element(sideDock().getByText("Photos content")).toBeVisible();
    expect(bottomDock().getByRole("tab").query()).toBeNull();
  });
});
