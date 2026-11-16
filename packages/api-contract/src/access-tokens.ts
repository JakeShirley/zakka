import { createRoute, z } from "@hono/zod-openapi";

import { errorResponseSchema } from "./shared.js";

export const accessTokenPrefix = "zakka_pat_";
export const mcpEndpointPath = "/api/v1/mcp";

export const accessTokenResponseSchema = z
  .object({
    id: z.string().openapi({ example: "access_token_018f4a0c-7b07-7f3d-9f37-3e67a0f5ad13" }),
    name: z.string().openapi({ example: "Claude Desktop" }),
    tokenPrefix: z.string().openapi({
      description: "The first characters of the token, for identifying it later.",
      example: "zakka_pat_Ab3d",
    }),
    lastUsedAt: z.string().datetime().nullable().openapi({ example: "2026-05-17T12:00:00.000Z" }),
    createdAt: z.string().datetime().openapi({ example: "2026-05-17T12:00:00.000Z" }),
  })
  .openapi("AccessTokenResponse");

export const accessTokenListResponseSchema = z
  .object({
    tokens: z.array(accessTokenResponseSchema),
  })
  .openapi("AccessTokenListResponse");

export const accessTokenCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).openapi({ example: "Claude Desktop" }),
  })
  .openapi("AccessTokenCreateRequest");

export const accessTokenCreateResponseSchema = z
  .object({
    token: accessTokenResponseSchema,
    secret: z.string().openapi({
      description: "The full token. It is only returned once and cannot be retrieved again.",
      example: "zakka_pat_Ab3dEf...",
    }),
  })
  .openapi("AccessTokenCreateResponse");

export type AccessTokenResponse = z.infer<typeof accessTokenResponseSchema>;
export type AccessTokenListResponse = z.infer<typeof accessTokenListResponseSchema>;
export type AccessTokenCreateRequest = z.infer<typeof accessTokenCreateRequestSchema>;
export type AccessTokenCreateResponse = z.infer<typeof accessTokenCreateResponseSchema>;

const accessTokenParamsSchema = z.object({
  tokenId: z
    .string()
    .min(1)
    .openapi({ param: { name: "tokenId", in: "path" } }),
});

const errorContent = {
  "application/json": {
    schema: errorResponseSchema,
  },
};

const accessTokenResponses = {
  400: { description: "Request validation failed.", content: errorContent },
  401: { description: "Authentication is required.", content: errorContent },
  500: { description: "Standard error envelope.", content: errorContent },
};

export const accessTokenListRoute = createRoute({
  method: "get",
  path: "/api/v1/account/access-tokens",
  tags: ["Account"],
  responses: {
    200: {
      description: "Lists the current account's personal access tokens, newest first.",
      content: { "application/json": { schema: accessTokenListResponseSchema } },
    },
    ...accessTokenResponses,
  },
});

export const accessTokenCreateRoute = createRoute({
  method: "post",
  path: "/api/v1/account/access-tokens",
  tags: ["Account"],
  request: {
    body: {
      content: { "application/json": { schema: accessTokenCreateRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description:
        "Creates a personal access token for AI tools that connect through the MCP endpoint.",
      content: { "application/json": { schema: accessTokenCreateResponseSchema } },
    },
    ...accessTokenResponses,
  },
});

export const accessTokenDeleteRoute = createRoute({
  method: "delete",
  path: "/api/v1/account/access-tokens/{tokenId}",
  tags: ["Account"],
  request: { params: accessTokenParamsSchema },
  responses: {
    204: { description: "Revokes a personal access token." },
    404: {
      description: "The token does not exist for the current account.",
      content: errorContent,
    },
    ...accessTokenResponses,
  },
});
