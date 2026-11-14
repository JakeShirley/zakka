import { createRoute, z } from "@hono/zod-openapi";

import { errorResponseSchema } from "./shared.js";

export const systemInfoResponseSchema = z
  .object({
    service: z.string().openapi({ example: "zakka-api" }),
    version: z.string().openapi({ example: "0.0.0-development" }),
    startedAt: z.string().datetime().openapi({ example: "2026-05-17T12:00:00.000Z" }),
    uptimeSeconds: z.number().nonnegative().openapi({ example: 3600 }),
    nodeVersion: z.string().openapi({ example: "v22.12.0" }),
    platform: z.string().openapi({ example: "linux" }),
    arch: z.string().openapi({ example: "x64" }),
  })
  .openapi("SystemInfoResponse");

export type SystemInfoResponse = z.infer<typeof systemInfoResponseSchema>;

export const systemInfoRoute = createRoute({
  method: "get",
  path: "/api/v1/system/info",
  tags: ["System"],
  responses: {
    200: {
      description: "Reports the running API version, uptime, and runtime details.",
      content: {
        "application/json": {
          schema: systemInfoResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Standard error envelope.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
