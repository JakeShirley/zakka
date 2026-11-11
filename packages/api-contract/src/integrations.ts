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

export type ShutterflyConnectionResponse = z.infer<typeof shutterflyConnectionResponseSchema>;
export type ShutterflyConnectRequest = z.infer<typeof shutterflyConnectRequestSchema>;
export type ShutterflyProjectResponse = z.infer<typeof shutterflyProjectResponseSchema>;
export type ShutterflyProjectListResponse = z.infer<typeof shutterflyProjectListResponseSchema>;
export type ShutterflyImportResponse = z.infer<typeof shutterflyImportResponseSchema>;

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
