import { createRoute, z } from "@hono/zod-openapi";

import { errorResponseSchema } from "./shared.js";

export const customBackgroundResponseSchema = z
  .object({
    id: z.string().openapi({ example: "custom_background_018f4a0c-7b07-7f3d-9f37-3e67a0f5ad13" }),
    backgroundId: z
      .string()
      .openapi({ example: "custom:custom_background_018f4a0c-7b07-7f3d-9f37-3e67a0f5ad13" }),
    name: z.string().openapi({ example: "Beach day" }),
    mimeType: z.string().openapi({ example: "image/jpeg" }),
    byteSize: z.number().int().nonnegative().openapi({ example: 1_284_301 }),
    width: z.number().int().positive().openapi({ example: 7200 }),
    height: z.number().int().positive().openapi({ example: 3600 }),
    source: z.enum(["upload", "shutterfly"]).openapi({ example: "upload" }),
    contentUrl: z
      .string()
      .openapi({ example: "/api/v1/custom-backgrounds/custom_background_018.../content" }),
    thumbnailUrl: z
      .string()
      .openapi({ example: "/api/v1/custom-backgrounds/custom_background_018.../thumbnail" }),
    createdAt: z.string().datetime().openapi({ example: "2026-05-17T12:00:00.000Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2026-05-17T12:00:00.000Z" }),
  })
  .openapi("CustomBackgroundResponse");

export const customBackgroundListResponseSchema = z
  .object({
    backgrounds: z.array(customBackgroundResponseSchema),
  })
  .openapi("CustomBackgroundListResponse");

export const customBackgroundPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .openapi("CustomBackgroundPatchRequest");

const customBackgroundUploadRequestSchema = z
  .object({
    file: z.instanceof(File).openapi({ type: "string", format: "binary" }),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .openapi("CustomBackgroundUploadRequest");

const customBackgroundParamsSchema = z.object({
  backgroundId: z
    .string()
    .min(1)
    .openapi({ param: { name: "backgroundId", in: "path" } }),
});

const builtInBackgroundParamsSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]{1,80}$/)
    .openapi({ param: { name: "slug", in: "path" }, example: "kraft-paper" }),
});

const errorContent = {
  "application/json": {
    schema: errorResponseSchema,
  },
};

const backgroundJsonResponses = {
  400: { description: "The background request is invalid.", content: errorContent },
  401: { description: "Authentication is required.", content: errorContent },
  404: {
    description: "The background does not exist for the current account.",
    content: errorContent,
  },
  413: {
    description: "The uploaded background image exceeds the configured size limit.",
    content: errorContent,
  },
  500: { description: "Standard error envelope.", content: errorContent },
};

const jpegContent = {
  "image/jpeg": { schema: z.string().openapi({ type: "string", format: "binary" }) },
};

export type CustomBackgroundResponse = z.infer<typeof customBackgroundResponseSchema>;
export type CustomBackgroundListResponse = z.infer<typeof customBackgroundListResponseSchema>;
export type CustomBackgroundPatchRequest = z.infer<typeof customBackgroundPatchRequestSchema>;

export const customBackgroundListRoute = createRoute({
  method: "get",
  path: "/api/v1/custom-backgrounds",
  tags: ["Backgrounds"],
  responses: {
    200: {
      description: "Lists the current account's custom backgrounds, newest first.",
      content: { "application/json": { schema: customBackgroundListResponseSchema } },
    },
    ...backgroundJsonResponses,
  },
});

export const customBackgroundUploadRoute = createRoute({
  method: "post",
  path: "/api/v1/custom-backgrounds",
  tags: ["Backgrounds"],
  request: {
    body: {
      content: { "multipart/form-data": { schema: customBackgroundUploadRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Uploads an image as a custom background.",
      content: { "application/json": { schema: customBackgroundResponseSchema } },
    },
    ...backgroundJsonResponses,
  },
});

export const customBackgroundPatchRoute = createRoute({
  method: "patch",
  path: "/api/v1/custom-backgrounds/{backgroundId}",
  tags: ["Backgrounds"],
  request: {
    params: customBackgroundParamsSchema,
    body: {
      content: { "application/json": { schema: customBackgroundPatchRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Renames a custom background.",
      content: { "application/json": { schema: customBackgroundResponseSchema } },
    },
    ...backgroundJsonResponses,
  },
});

export const customBackgroundDeleteRoute = createRoute({
  method: "delete",
  path: "/api/v1/custom-backgrounds/{backgroundId}",
  tags: ["Backgrounds"],
  request: { params: customBackgroundParamsSchema },
  responses: {
    204: { description: "Deletes a custom background." },
    409: {
      description: "The background is still used by a page and cannot be deleted.",
      content: errorContent,
    },
    ...backgroundJsonResponses,
  },
});

export const customBackgroundContentRoute = createRoute({
  method: "get",
  path: "/api/v1/custom-backgrounds/{backgroundId}/content",
  tags: ["Backgrounds"],
  request: { params: customBackgroundParamsSchema },
  responses: {
    200: { description: "Returns the full-size background image.", content: jpegContent },
    ...backgroundJsonResponses,
  },
});

export const customBackgroundThumbnailRoute = createRoute({
  method: "get",
  path: "/api/v1/custom-backgrounds/{backgroundId}/thumbnail",
  tags: ["Backgrounds"],
  request: { params: customBackgroundParamsSchema },
  responses: {
    200: { description: "Returns a small preview of the background.", content: jpegContent },
    ...backgroundJsonResponses,
  },
});

export const builtInBackgroundContentRoute = createRoute({
  method: "get",
  path: "/api/v1/backgrounds/builtin/{slug}/content",
  tags: ["Backgrounds"],
  request: { params: builtInBackgroundParamsSchema },
  responses: {
    200: { description: "Returns a built-in background texture tile.", content: jpegContent },
    404: { description: "No built-in texture has this slug.", content: errorContent },
  },
});

export const builtInBackgroundThumbnailRoute = createRoute({
  method: "get",
  path: "/api/v1/backgrounds/builtin/{slug}/thumbnail",
  tags: ["Backgrounds"],
  request: { params: builtInBackgroundParamsSchema },
  responses: {
    200: { description: "Returns a built-in texture thumbnail.", content: jpegContent },
    404: { description: "No built-in texture has this slug.", content: errorContent },
  },
});
