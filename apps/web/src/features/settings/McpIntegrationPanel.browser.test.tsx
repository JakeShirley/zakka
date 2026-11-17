import type { AccessTokenResponse } from "@zakka/api-contract";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { apiClient } from "../../apiClient";
import { McpIntegrationPanel } from "./McpIntegrationPanel";

const existingToken: AccessTokenResponse = {
  id: "access_token_existing",
  name: "VS Code",
  tokenPrefix: "zakka_pat_Ab3d",
  lastUsedAt: null,
  createdAt: "2026-05-17T12:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("McpIntegrationPanel", () => {
  test("creates a token, shows its secret once, and revokes tokens", async () => {
    vi.spyOn(apiClient, "listAccessTokens").mockResolvedValue({ tokens: [existingToken] });
    const createAccessToken = vi.spyOn(apiClient, "createAccessToken").mockResolvedValue({
      token: { ...existingToken, id: "access_token_new", name: "Claude Desktop" },
      secret: "zakka_pat_secret-value",
    });
    const deleteAccessToken = vi.spyOn(apiClient, "deleteAccessToken").mockResolvedValue();

    await render(<McpIntegrationPanel />);

    await expect
      .element(page.getByRole("textbox", { name: "MCP server URL" }))
      .toHaveValue(`${window.location.origin}/api/v1/mcp`);
    await expect.element(page.getByRole("button", { name: "Revoke VS Code" })).toBeVisible();

    await page.getByPlaceholder("Claude Desktop").fill("  Claude Desktop ");
    await page.getByRole("button", { name: "Create token" }).click();

    expect(createAccessToken).toHaveBeenCalledWith({ name: "Claude Desktop" });
    await expect
      .element(page.getByRole("textbox", { name: "Access token for Claude Desktop" }))
      .toHaveValue("zakka_pat_secret-value");
    await expect
      .element(page.getByText('"Authorization": "Bearer zakka_pat_secret-value"'))
      .toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();

    await expect.element(page.getByText(/Copy your new token now/)).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Revoke Claude Desktop" })).toBeVisible();

    await page.getByRole("button", { name: "Revoke VS Code" }).click();

    expect(deleteAccessToken).toHaveBeenCalledWith("access_token_existing");
    await expect
      .element(page.getByRole("button", { name: "Revoke VS Code" }))
      .not.toBeInTheDocument();
  });

  test("shows an error when tokens cannot be loaded", async () => {
    vi.spyOn(apiClient, "listAccessTokens").mockRejectedValue(new Error("Offline"));

    await render(<McpIntegrationPanel />);

    await expect.element(page.getByRole("alert")).toHaveTextContent("Offline");
  });

  test("keeps token creation disabled until the token list has loaded", async () => {
    let resolveList: (value: { tokens: AccessTokenResponse[] }) => void = () => undefined;
    vi.spyOn(apiClient, "listAccessTokens").mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    await render(<McpIntegrationPanel />);

    await expect.element(page.getByPlaceholder("Claude Desktop")).toBeDisabled();

    resolveList({ tokens: [existingToken] });

    await expect.element(page.getByPlaceholder("Claude Desktop")).toBeEnabled();
  });

  test("copies the access token with the selection fallback when the clipboard API is denied", async () => {
    vi.spyOn(apiClient, "listAccessTokens").mockResolvedValue({ tokens: [] });
    vi.spyOn(apiClient, "createAccessToken").mockResolvedValue({
      token: { ...existingToken, id: "access_token_new", name: "Claude Desktop" },
      secret: "zakka_pat_secret-value",
    });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));
    let copiedText: string | null = null;
    const execCommand = vi.spyOn(document, "execCommand").mockImplementation((command) => {
      const target = document.activeElement;
      copiedText =
        command === "copy" && target instanceof HTMLTextAreaElement ? target.value : null;
      return true;
    });

    await render(<McpIntegrationPanel />);
    await page.getByPlaceholder("Claude Desktop").fill("Claude Desktop");
    await page.getByRole("button", { name: "Create token" }).click();
    await page.getByRole("button", { name: "Copy access token" }).click();

    await expect
      .element(page.getByRole("button", { name: "Copy access token" }))
      .toHaveTextContent("Copied");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe("zakka_pat_secret-value");
    await expect.element(page.getByText(/copy it manually/)).not.toBeInTheDocument();
  });

  test("explains how to copy manually when the clipboard is unavailable", async () => {
    vi.spyOn(apiClient, "listAccessTokens").mockResolvedValue({ tokens: [] });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));
    vi.spyOn(document, "execCommand").mockReturnValue(false);

    await render(<McpIntegrationPanel />);
    await page.getByRole("button", { name: "Copy MCP server URL" }).click();

    await expect.element(page.getByRole("alert")).toHaveTextContent(/copy it manually/);
  });
});
