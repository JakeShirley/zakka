import { createRoute, z } from "@hono/zod-openapi";
import { mapTileProviderIds } from "@zakka/editor-core";

import { errorResponseSchema } from "./shared.js";

const tileCoordinateSchema = z.coerce.number().int().min(0);

export const mapTileParamsSchema = z.object({
  provider: z.enum(mapTileProviderIds).openapi({
    param: { name: "provider", in: "path" },
    example: "osm",
  }),
  z: tileCoordinateSchema.max(19).openapi({ param: { name: "z", in: "path" }, example: 12 }),
  x: tileCoordinateSchema.openapi({ param: { name: "x", in: "path" }, example: 2074 }),
  y: tileCoordinateSchema.openapi({ param: { name: "y", in: "path" }, example: 1409 }),
});

const mapTileErrorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorResponseSchema } },
});

const mapTileBinarySchema = z.string().openapi({ type: "string", format: "binary" });

export const mapTileRoute = createRoute({
  method: "get",
  path: "/api/v1/map-tiles/{provider}/{z}/{x}/{y}",
  tags: ["Maps"],
  request: {
    params: mapTileParamsSchema,
  },
  responses: {
    200: {
      description:
        "Returns a cached raster map tile from the provider so map layers can render and export it.",
      content: {
        "image/png": { schema: mapTileBinarySchema },
        "image/jpeg": { schema: mapTileBinarySchema },
      },
    },
    400: mapTileErrorResponse("The tile coordinates are outside the provider's tile grid."),
    401: mapTileErrorResponse("Authentication is required."),
    500: mapTileErrorResponse("Map tiles are unavailable."),
    502: mapTileErrorResponse("The tile provider did not return an image."),
  },
});
