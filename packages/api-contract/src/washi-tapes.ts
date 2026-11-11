import { createRoute, z } from "@hono/zod-openapi";
import { washiTapeDesignSchema } from "@zakka/editor-core";

import { errorResponseSchema } from "./shared.js";

export const customWashiTapeResponseSchema = z
  .object({
    id: z.string().openapi({ example: "custom_washi_tape_018f4a0c-7b07-7f3d-9f37-3e67a0f5ad13" }),
    name: z.string().openapi({ example: "Mint gingham" }),
    design: washiTapeDesignSchema,
    createdAt: z.string().datetime().openapi({ example: "2026-05-17T12:00:00.000Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2026-05-17T12:00:00.000Z" }),
  })
  .openapi("CustomWashiTapeResponse");

export const customWashiTapeListResponseSchema = z
  .object({
    washiTapes: z.array(customWashiTapeResponseSchema),
  })
  .openapi("CustomWashiTapeListResponse");

export const customWashiTapeCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    design: washiTapeDesignSchema,
  })
  .openapi("CustomWashiTapeCreateRequest");

export const customWashiTapePatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    design: washiTapeDesignSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.design !== undefined, {
    message: "At least one field must be provided",
  })
  .openapi("CustomWashiTapePatchRequest");

const customWashiTapeParamsSchema = z.object({
  washiTapeId: z
    .string()
    .min(1)
    .openapi({ param: { name: "washiTapeId", in: "path" } }),
});

const customWashiTapeJsonResponses = {
  400: {
    description: "The washi tape request is invalid.",
    content: {
      "application/json": {
        schema: errorResponseSchema,
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
  404: {
    description: "The custom washi tape does not exist for the current account.",
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
};

export type CustomWashiTapeResponse = z.infer<typeof customWashiTapeResponseSchema>;
export type CustomWashiTapeListResponse = z.infer<typeof customWashiTapeListResponseSchema>;
export type CustomWashiTapeCreateRequest = z.input<typeof customWashiTapeCreateRequestSchema>;
export type CustomWashiTapePatchRequest = z.input<typeof customWashiTapePatchRequestSchema>;

export const customWashiTapeListRoute = createRoute({
  method: "get",
  path: "/api/v1/custom-washi-tapes",
  tags: ["WashiTapes"],
  responses: {
    200: {
      description: "Lists the current account's saved washi tape designs, newest first.",
      content: {
        "application/json": {
          schema: customWashiTapeListResponseSchema,
        },
      },
    },
    ...customWashiTapeJsonResponses,
  },
});

export const customWashiTapeCreateRoute = createRoute({
  method: "post",
  path: "/api/v1/custom-washi-tapes",
  tags: ["WashiTapes"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: customWashiTapeCreateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Saves a new washi tape design to the account's gallery.",
      content: {
        "application/json": {
          schema: customWashiTapeResponseSchema,
        },
      },
    },
    ...customWashiTapeJsonResponses,
  },
});

export const customWashiTapePatchRoute = createRoute({
  method: "patch",
  path: "/api/v1/custom-washi-tapes/{washiTapeId}",
  tags: ["WashiTapes"],
  request: {
    params: customWashiTapeParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: customWashiTapePatchRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Renames or redesigns a saved washi tape.",
      content: {
        "application/json": {
          schema: customWashiTapeResponseSchema,
        },
      },
    },
    ...customWashiTapeJsonResponses,
  },
});

export const customWashiTapeDeleteRoute = createRoute({
  method: "delete",
  path: "/api/v1/custom-washi-tapes/{washiTapeId}",
  tags: ["WashiTapes"],
  request: {
    params: customWashiTapeParamsSchema,
  },
  responses: {
    204: {
      description:
        "Removes a saved washi tape from the gallery. Tape already placed on pages is unchanged.",
    },
    ...customWashiTapeJsonResponses,
  },
});
