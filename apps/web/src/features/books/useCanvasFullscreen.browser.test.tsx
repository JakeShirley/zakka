import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { BookModeBar } from "./BookModeBar";
import { useCanvasFullscreen } from "./useCanvasFullscreen";

function FullscreenStage() {
  const { isFullscreen, toggle } = useCanvasFullscreen();

  return (
    <section aria-label="Book editor" data-fullscreen={isFullscreen || undefined}>
      <BookModeBar
        canNavigateNext={false}
        canNavigatePrevious={false}
        isFullscreen={isFullscreen}
        isWorking={false}
        leftPageName="Front cover"
        navigationLabel="Spread 1 of 1"
        rightPageName="Back cover"
        viewMode="spread"
        onNavigate={() => undefined}
        onToggleFullscreen={toggle}
        onViewModeChange={() => undefined}
      />
    </section>
  );
}

describe("canvas full screen", () => {
  test("toggles the stage into full screen and leaves it with the button or Esc", async () => {
    await render(
      <FluentProvider theme={webLightTheme}>
        <FullscreenStage />
      </FluentProvider>,
    );
    const stage = page.getByRole("region", { name: "Book editor" });

    await page.getByRole("button", { name: "Full screen" }).click();
    await expect.element(stage).toHaveAttribute("data-fullscreen", "true");

    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect.element(stage).not.toHaveAttribute("data-fullscreen");
    await expect.poll(() => document.fullscreenElement).toBeNull();

    await page.getByRole("button", { name: "Full screen" }).click();
    await expect.element(stage).toHaveAttribute("data-fullscreen", "true");
    if (document.fullscreenElement) await document.exitFullscreen();
    else await userEvent.keyboard("{Escape}");
    await expect.element(stage).not.toHaveAttribute("data-fullscreen");
  });
});
