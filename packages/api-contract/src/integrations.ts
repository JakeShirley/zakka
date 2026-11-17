import { createRoute, z } from "@hono/zod-openapi";

import { bookResponseSchema } from "./books.js";
import { errorResponseSchema } from "./shared.js";

export const shutterflyConnectionResponseSchema = z
  .object({
    configured: z.boolean().openapi({
      description: "Whether the server has a Shutterfly API key configured.",
      example: true,
    }),
    connected: z.boolean().openapi({ example: true }),
    email: z.string().nullable().openapi({ example: "reader@example.com" }),
    connectedAt: z.string().datetime().nullable().openapi({ example: "2026-05-17T12:00:00.000Z" }),
  })
  .openapi("ShutterflyConnectionResponse");

export const shutterflyConnectRequestSchema = z
  .object({
    refreshToken: z.string().trim().min(20).max(10000).openapi({
      description:
        "Value of the CognitoIdentityServiceProvider.*.refreshToken cookie on accounts.shutterfly.com.",
    }),
  })
  .openapi("ShutterflyConnectRequest");

export const shutterflyProjectResponseSchema = z
  .object({
    id: z.string().openapi({ example: "1219497168070" }),
    name: z.string().openapi({ example: "Summer 2026" }),
    productName: z.string().nullable().openapi({ example: "8x8 Deluxe Layflat Photo Book" }),
    thumbnailUrl: z.string().nullable(),
    pageCount: z.number().int().positive().nullable().openapi({ example: 34 }),
    updatedAt: z.string().datetime().nullable().openapi({ example: "2026-05-21T21:59:17.820Z" }),
  })
  .openapi("ShutterflyProjectResponse");

export const shutterflyProjectListResponseSchema = z
  .object({
    projects: z.array(shutterflyProjectResponseSchema),
  })
  .openapi("ShutterflyProjectListResponse");

export const shutterflyImportResponseSchema = z
  .object({
    book: bookResponseSchema,
    warnings: z.array(z.string()).openapi({
      example: ["Skipped spine text because Zakka books have no spine"],
    }),
  })
  .openapi("ShutterflyImportResponse");

export const shutterflyImportStepSchema = z
  .enum(["preparing", "photos", "stickers", "backgrounds", "pages"])
  .openapi("ShutterflyImportStep", {
    description:
      "The step an import is on: reading the project, downloading photos, importing stickers, importing backgrounds, or building pages.",
  });

export const shutterflyImportJobResponseSchema = z
  .object({
    id: z.string().openapi({ example: "shutterfly_import_6f1c2d9e-5b1a-4c55-9a9f-2f1d4b7e8c01" }),
    projectId: z.string().openapi({ example: "1219497168070" }),
    status: z.enum(["running", "completed", "failed"]).openapi({ example: "running" }),
    progress: z.object({
      step: shutterflyImportStepSchema,
      completed: z.number().int().nonnegative().openapi({
        description: "Items finished in the current step.",
        example: 12,
      }),
      total: z.number().int().nonnegative().openapi({
        description: "Items in the current step, or 0 when the step has no countable items.",
        example: 48,
      }),
      fraction: z.number().min(0).max(1).openapi({
        description: "Overall progress across every step, from 0 to 1.",
        example: 0.24,
      }),
    }),
    result: shutterflyImportResponseSchema
      .nullable()
      .openapi({ description: "The imported book once the import has completed." }),
    error: z
      .object({ code: z.string(), message: z.string() })
      .nullable()
      .openapi({ description: "Why the import failed, once it has failed." }),
  })
  .openapi("ShutterflyImportJobResponse");

export type ShutterflyConnectionResponse = z.infer<typeof shutterflyConnectionResponseSchema>;
export type ShutterflyConnectRequest = z.infer<typeof shutterflyConnectRequestSchema>;
export type ShutterflyProjectResponse = z.infer<typeof shutterflyProjectResponseSchema>;
export type ShutterflyProjectListResponse = z.infer<typeof shutterflyProjectListResponseSchema>;
export type ShutterflyImportResponse = z.infer<typeof shutterflyImportResponseSchema>;
export type ShutterflyImportStep = z.infer<typeof shutterflyImportStepSchema>;
export type ShutterflyImportJobResponse = z.infer<typeof shutterflyImportJobResponseSchema>;

const errorContent = {
  content: {
    "application/json": {
      schema: errorResponseSchema,
    },
  },
};

const shutterflyErrorResponses = {
  400: { description: "The request is invalid.", ...errorContent },
  401: { description: "Authentication is required.", ...errorContent },
  404: { description: "The Shutterfly project was not found.", ...errorContent },
  409: {
    description: "The Shutterfly account is not connected or must be reconnected.",
    ...errorContent,
  },
  500: { description: "Standard error envelope.", ...errorContent },
  502: { description: "Shutterfly returned an error or could not be reached.", ...errorContent },
  503: { description: "The Shutterfly integration is not configured.", ...errorContent },
};

const projectParamsSchema = z.object({
  projectId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .openapi({ param: { name: "projectId", in: "path" } }),
});

export const shutterflyConnectionRoute = createRoute({
  method: "get",
  path: "/api/v1/integrations/shutterfly",
  tags: ["Integrations"],
  responses: {
    200: {
      description: "Returns whether Shutterfly import is configured and connected.",
      content: { "application/json": { schema: shutterflyConnectionResponseSchema } },
    },
    ...shutterflyErrorResponses,
  },
});

export const shutterflyConnectRoute = createRoute({
  method: "put",
  path: "/api/v1/integrations/shutterfly",
  tags: ["Integrations"],
  request: {
    body: {
      content: { "application/json": { schema: shutterflyConnectRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        "Verifies the Shutterfly refresh token and stores it encrypted for the current account.",
      content: { "application/json": { schema: shutterflyConnectionResponseSchema } },
    },
    ...shutterflyErrorResponses,
  },
});

export const shutterflyDisconnectRoute = createRoute({
  method: "delete",
  path: "/api/v1/integrations/shutterfly",
  tags: ["Integrations"],
  responses: {
    204: { description: "Removes the stored Shutterfly credentials for the current account." },
    ...shutterflyErrorResponses,
  },
});

export const shutterflyProjectListRoute = createRoute({
  method: "get",
  path: "/api/v1/integrations/shutterfly/projects",
  tags: ["Integrations"],
  responses: {
    200: {
      description: "Lists saved Shutterfly photo book projects for the connected account.",
      content: { "application/json": { schema: shutterflyProjectListResponseSchema } },
    },
    ...shutterflyErrorResponses,
  },
});

export const shutterflyProjectImportRoute = createRoute({
  method: "post",
  path: "/api/v1/integrations/shutterfly/projects/{projectId}/import",
  tags: ["Integrations"],
  request: {
    params: projectParamsSchema,
  },
  responses: {
    201: {
      description:
        "Imports a Shutterfly photo book as a new Zakka book with its photos, text, backgrounds, and stickers.",
      content: { "application/json": { schema: shutterflyImportResponseSchema } },
    },
    ...shutterflyErrorResponses,
  },
});

export const shutterflyProjectImportJobRoute = createRoute({
  method: "post",
  path: "/api/v1/integrations/shutterfly/projects/{projectId}/imports",
  tags: ["Integrations"],
  request: {
    params: projectParamsSchema,
  },
  responses: {
    202: {
      description:
        "Starts importing a Shutterfly photo book in the background. Poll the returned import for progress. Starting an import of a project that is already being imported returns the running import.",
      content: { "application/json": { schema: shutterflyImportJobResponseSchema } },
    },
    ...shutterflyErrorResponses,
  },
});

export const shutterflyImportJobRoute = createRoute({
  method: "get",
  path: "/api/v1/integrations/shutterfly/imports/{importId}",
  tags: ["Integrations"],
  request: {
    params: z.object({
      importId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,128}$/)
        .openapi({ param: { name: "importId", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description:
        "Returns the progress of a Shutterfly import, and the imported book once it has finished. Finished imports are kept for 15 minutes.",
      content: { "application/json": { schema: shutterflyImportJobResponseSchema } },
    },
    ...shutterflyErrorResponses,
  },
});

const archiveCountSchema = z.object({
  completed: z.number().int().nonnegative().openapi({ example: 1200 }),
  failed: z.number().int().nonnegative().openapi({ example: 0 }),
  total: z.number().int().nonnegative().openapi({ example: 4800 }),
});

export const shutterflyArchiveStepSchema = z
  .enum(["starting", "orders", "projects", "albums", "photos", "finishing"])
  .openapi("ShutterflyArchiveStep", {
    description:
      "The step an archive is on: signing in, saving order history, saving projects, reading albums, downloading original photos, or writing the archive's index files.",
  });

export const shutterflyArchiveResponseSchema = z
  .object({
    id: z.string().openapi({ example: "shutterfly_archive_6f1c2d9e-5b1a-4c55-9a9f-2f1d4b7e8c01" }),
    status: z.enum(["running", "completed", "failed", "interrupted"]).openapi({
      description:
        "`interrupted` archives were stopped by a server restart or shutdown; resume them to continue where they left off.",
      example: "running",
    }),
    progress: z.object({
      step: shutterflyArchiveStepSchema,
      photos: archiveCountSchema,
      projects: archiveCountSchema,
      albums: archiveCountSchema,
      orders: z.number().int().nonnegative().openapi({ example: 37 }),
      bytes: z.number().int().nonnegative().openapi({
        description: "Bytes saved to the archive so far.",
        example: 5368709120,
      }),
      errorCount: z.number().int().nonnegative().openapi({
        description: "Items that could not be archived. Resuming the archive retries them.",
        example: 0,
      }),
    }),
    error: z
      .object({ code: z.string(), message: z.string() })
      .nullable()
      .openapi({ description: "Why the archive stopped, when it failed or was interrupted." }),
    createdAt: z.string().openapi({ example: "2026-05-01T17:04:00.000Z" }),
    updatedAt: z.string().openapi({ example: "2026-05-01T17:34:00.000Z" }),
    finishedAt: z.string().nullable().openapi({ example: null }),
  })
  .openapi("ShutterflyArchiveResponse");

export const shutterflyArchiveListResponseSchema = z
  .object({ archives: z.array(shutterflyArchiveResponseSchema) })
  .openapi("ShutterflyArchiveListResponse");

export type ShutterflyArchiveStep = z.infer<typeof shutterflyArchiveStepSchema>;
export type ShutterflyArchiveResponse = z.infer<typeof shutterflyArchiveResponseSchema>;
export type ShutterflyArchiveListResponse = z.infer<typeof shutterflyArchiveListResponseSchema>;

const archiveParamsSchema = z.object({
  archiveId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .openapi({ param: { name: "archiveId", in: "path" } }),
});

const shutterflyArchiveErrorResponses = {
  ...shutterflyErrorResponses,
  404: { description: "The Shutterfly archive was not found.", ...errorContent },
  409: {
    description:
      "The Shutterfly account is not connected, or another archive is running for this account.",
    ...errorContent,
  },
};

export const shutterflyArchiveListRoute = createRoute({
  method: "get",
  path: "/api/v1/integrations/shutterfly/archives",
  tags: ["Integrations"],
  responses: {
    200: {
      description: "Lists Shutterfly account archives for the current account, newest first.",
      content: { "application/json": { schema: shutterflyArchiveListResponseSchema } },
    },
    ...shutterflyArchiveErrorResponses,
  },
});

export const shutterflyArchiveStartRoute = createRoute({
  method: "post",
  path: "/api/v1/integrations/shutterfly/archives",
  tags: ["Integrations"],
  responses: {
    202: {
      description:
        "Starts archiving everything in the connected Shutterfly account in the background: original photos and videos, albums, every project with its photos and artwork, and order history. Starting while an archive is already running returns the running archive.",
      content: { "application/json": { schema: shutterflyArchiveResponseSchema } },
    },
    ...shutterflyArchiveErrorResponses,
  },
});

export const shutterflyArchiveRoute = createRoute({
  method: "get",
  path: "/api/v1/integrations/shutterfly/archives/{archiveId}",
  tags: ["Integrations"],
  request: { params: archiveParamsSchema },
  responses: {
    200: {
      description: "Returns a Shutterfly archive and its progress.",
      content: { "application/json": { schema: shutterflyArchiveResponseSchema } },
    },
    ...shutterflyArchiveErrorResponses,
  },
});

export const shutterflyArchiveResumeRoute = createRoute({
  method: "post",
  path: "/api/v1/integrations/shutterfly/archives/{archiveId}/resume",
  tags: ["Integrations"],
  request: { params: archiveParamsSchema },
  responses: {
    202: {
      description:
        "Continues a stopped archive, keeping what it already downloaded and retrying anything that failed. Also picks up photos and projects added since the archive ran.",
      content: { "application/json": { schema: shutterflyArchiveResponseSchema } },
    },
    ...shutterflyArchiveErrorResponses,
  },
});

export const shutterflyArchiveDeleteRoute = createRoute({
  method: "delete",
  path: "/api/v1/integrations/shutterfly/archives/{archiveId}",
  tags: ["Integrations"],
  request: { params: archiveParamsSchema },
  responses: {
    204: { description: "Stops the archive if it is running and deletes its files." },
    ...shutterflyArchiveErrorResponses,
  },
});

export const shutterflyArchiveDownloadRoute = createRoute({
  method: "get",
  path: "/api/v1/integrations/shutterfly/archives/{archiveId}/download",
  tags: ["Integrations"],
  request: { params: archiveParamsSchema },
  responses: {
    200: {
      description:
        "Streams the archive as an uncompressed ZIP file. Available once the archive is no longer running.",
      content: {
        "application/zip": { schema: z.string().openapi({ type: "string", format: "binary" }) },
      },
    },
    ...shutterflyArchiveErrorResponses,
  },
});
