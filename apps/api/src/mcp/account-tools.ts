import { z } from "@hono/zod-openapi";
import {
  defaultUiThemePreference,
  isUiThemePreference,
  type ServerLogEntryResponse,
  type ServerLogLevel,
  type SystemInfoResponse,
  serverLogLevelSchema,
  uiThemePreferences,
} from "@zakka/api-contract";

import { jsonResult, type McpToolContext, runTool } from "./shared.js";

export type McpAccountToolOptions = {
  serverLogs?: ((level: ServerLogLevel, limit: number) => ServerLogEntryResponse[]) | undefined;
  systemInfo?: (() => SystemInfoResponse) | undefined;
};

/** Registers tools for account preferences and server diagnostics. */
export const registerAccountTools = (ctx: McpToolContext, options: McpAccountToolOptions) => {
  const { accountId, repositories, server } = ctx;

  const toPreferences = () => {
    const uiTheme = repositories.accountPreferences.findByAccountId(accountId)?.uiTheme;

    return { uiTheme: isUiThemePreference(uiTheme) ? uiTheme : defaultUiThemePreference };
  };

  server.registerTool(
    "get_preferences",
    {
      title: "Get preferences",
      description: "Shows the account's preferences, such as the web app's color theme.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => runTool(() => jsonResult(toPreferences())),
  );

  server.registerTool(
    "update_preferences",
    {
      title: "Update preferences",
      description: "Changes the account's preferences.",
      inputSchema: {
        uiTheme: z
          .enum(uiThemePreferences)
          .optional()
          .describe("The web app's color theme; system follows the device's light or dark mode."),
      },
      annotations: { idempotentHint: true },
    },
    ({ uiTheme }) =>
      runTool(() => {
        repositories.accountPreferences.upsert(accountId, uiTheme ? { uiTheme } : {});
        return jsonResult(toPreferences());
      }),
  );

  const { serverLogs, systemInfo } = options;

  if (serverLogs) {
    server.registerTool(
      "get_server_logs",
      {
        title: "Get server logs",
        description:
          "Lists recent server log entries, newest first. Useful for diagnosing failed requests.",
        inputSchema: {
          level: serverLogLevelSchema.optional().describe("Minimum level. Defaults to debug."),
          limit: z.number().int().min(1).max(500).optional().describe("Defaults to 200."),
        },
        annotations: { readOnlyHint: true },
      },
      ({ level = "debug", limit = 200 }) =>
        runTool(() => jsonResult({ entries: serverLogs(level, limit) })),
    );
  }

  if (systemInfo) {
    server.registerTool(
      "get_system_info",
      {
        title: "Get system info",
        description: "Shows the server's version, uptime and runtime.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      () => runTool(() => jsonResult(systemInfo())),
    );
  }
};
