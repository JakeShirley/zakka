import { z } from "@hono/zod-openapi";
import { exportDpiSchema, exportFormatSchema, exportPresetSchema } from "@zakka/api-contract";

import { getExportContentType, getExportDownloadFilename, runExportJob } from "../exports.js";
import type { ExportJobRecord } from "../persistence/schema.js";
import { jsonResult, type McpToolContext, runTool } from "./shared.js";

/** Exports up to this size are returned inline; larger ones must be downloaded in the web app. */
export const maxMcpExportByteSize = 20 * 1024 * 1024;

const exportOptions = {
  format: exportFormatSchema.describe(
    "pdf, jpeg, or png. A book exported as png is a zip of one PNG per page.",
  ),
  preset: exportPresetSchema
    .optional()
    .describe(
      "print adds bleed and sizes pages for printing; digital is for screens. Defaults to digital.",
    ),
  dpi: exportDpiSchema.optional().describe("Resolution for jpeg and png exports, 72-600."),
  includeBackground: z
    .boolean()
    .optional()
    .describe("Set false to export png with a transparent background. Defaults to true."),
};

/** Registers tools that export pages and books as files. */
export const registerExportTools = (ctx: McpToolContext) => {
  const { accountId, mapTiles, repositories, server, storage } = ctx;

  const toExportSummary = (job: ExportJobRecord) => ({
    id: job.id,
    status: job.status,
    format: job.format,
    preset: job.preset,
    bookId: job.bookId,
    pageId: job.pageId,
    filename: getExportDownloadFilename(job, repositories),
    contentType: getExportContentType(job),
    error: job.errorMessage,
    createdAt: job.createdAt,
  });

  const toExportResult = (job: ExportJobRecord, buffer: Buffer) => {
    const summary = { ...toExportSummary(job), byteSize: buffer.byteLength };

    if (buffer.byteLength > maxMcpExportByteSize) {
      return jsonResult({
        ...summary,
        message:
          "The export is too large to return here. Download it from the Export menu in the Zakka web app.",
      });
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(summary, null, 2) },
        {
          type: "resource" as const,
          resource: {
            uri: `zakka://exports/${job.id}/${encodeURIComponent(summary.filename)}`,
            mimeType: summary.contentType,
            blob: buffer.toString("base64"),
          },
        },
      ],
    };
  };

  const exportTarget = async (
    target: { bookId: string } | { pageId: string },
    options: {
      dpi?: number | undefined;
      format: z.infer<typeof exportFormatSchema>;
      includeBackground?: boolean | undefined;
      preset?: z.infer<typeof exportPresetSchema> | undefined;
    },
  ) => {
    const { buffer, job } = await runExportJob({
      accountId,
      ...target,
      dpi: options.dpi,
      format: options.format,
      includeBackground: options.includeBackground,
      mapTiles,
      preset: options.preset ?? "digital",
      repositories,
      storage,
    });

    return toExportResult(job, buffer);
  };

  server.registerTool(
    "export_page",
    {
      title: "Export page",
      description:
        "Renders a page as a PDF, JPEG or PNG file and returns it as an embedded resource. Use render_page for a quick look instead.",
      inputSchema: { pageId: z.string(), ...exportOptions },
    },
    ({ pageId, ...options }) =>
      runTool(() => {
        ctx.requirePage(pageId);
        return exportTarget({ pageId }, options);
      }),
  );

  server.registerTool(
    "export_book",
    {
      title: "Export book",
      description:
        "Renders a whole book as one PDF, a JPEG sheet, or a zip of PNG pages, and returns it as an embedded resource. Large books can take a while.",
      inputSchema: { bookId: z.string(), ...exportOptions },
    },
    ({ bookId, ...options }) =>
      runTool(() => {
        ctx.requireBook(bookId);
        return exportTarget({ bookId }, options);
      }),
  );

  server.registerTool(
    "get_export",
    {
      title: "Get export",
      description:
        "Shows an earlier export's status and returns its file when it completed and is small enough.",
      inputSchema: {
        exportId: z.string(),
        includeFile: z.boolean().optional().describe("Defaults to true."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ exportId, includeFile = true }) =>
      runTool(async () => {
        const job = repositories.exports.findByIdForAccount(accountId, exportId);

        if (!job) {
          throw new Error(`Export ${exportId} was not found`);
        }

        if (!includeFile || job.status !== "completed" || !job.outputStorageKey) {
          return jsonResult(toExportSummary(job));
        }

        return toExportResult(job, await storage.read(job.outputStorageKey));
      }),
  );
};
