import { z } from "@hono/zod-openapi";
import type { ShutterflyImportJobResponse } from "@zakka/api-contract";

import type {
  ShutterflyConnectionStatus,
  ShutterflyProjectListItem,
} from "../integrations/shutterfly/service.js";
import { jsonResult, type McpToolContext, runTool } from "./shared.js";

/** Shutterfly operations the MCP server can use; connecting an account stays in the web app. */
export type McpShutterflyAccess = {
  getStatus: (accountId: string) => ShutterflyConnectionStatus;
  listProjects: (accountId: string) => Promise<ShutterflyProjectListItem[]>;
  startImport: (accountId: string, projectId: string) => ShutterflyImportJobResponse;
  getImport: (accountId: string, importId: string) => ShutterflyImportJobResponse | null;
};

/** Registers Shutterfly import tools. They are only offered when the server has Shutterfly set up. */
export const registerIntegrationTools = (
  ctx: McpToolContext,
  shutterfly: McpShutterflyAccess | undefined,
) => {
  const { accountId, server } = ctx;

  if (!shutterfly) {
    return;
  }

  const requireConnected = () => {
    if (!shutterfly.getStatus(accountId).connected) {
      throw new Error(
        "Connect your Shutterfly account in the Zakka web app's Settings before using Shutterfly tools.",
      );
    }
  };

  server.registerTool(
    "get_shutterfly_status",
    {
      title: "Get Shutterfly status",
      description:
        "Shows whether a Shutterfly account is connected. Connecting or disconnecting is done in the Zakka web app's Settings.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => runTool(() => jsonResult(shutterfly.getStatus(accountId))),
  );

  server.registerTool(
    "list_shutterfly_projects",
    {
      title: "List Shutterfly projects",
      description: "Lists photo book projects in the connected Shutterfly account.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      runTool(async () => {
        requireConnected();
        return jsonResult({ projects: await shutterfly.listProjects(accountId) });
      }),
  );

  server.registerTool(
    "import_shutterfly_project",
    {
      title: "Import Shutterfly project",
      description:
        "Starts importing a Shutterfly photo book as a new Zakka book, with its photos, stickers, backgrounds and pages. Imports run in the background; poll get_shutterfly_import with the returned id.",
      inputSchema: {
        projectId: z.string().describe("A project id from list_shutterfly_projects."),
      },
      annotations: { openWorldHint: true },
    },
    ({ projectId }) =>
      runTool(() => {
        requireConnected();
        return jsonResult(shutterfly.startImport(accountId, projectId));
      }),
  );

  server.registerTool(
    "get_shutterfly_import",
    {
      title: "Get Shutterfly import",
      description:
        "Shows a Shutterfly import's progress. When status is succeeded, result.book is the new book.",
      inputSchema: { importId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ importId }) =>
      runTool(() => {
        const job = shutterfly.getImport(accountId, importId);

        if (!job) {
          throw new Error(`Shutterfly import ${importId} was not found`);
        }

        return jsonResult(job);
      }),
  );
};
