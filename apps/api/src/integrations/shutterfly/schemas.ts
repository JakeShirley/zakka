import { z } from "@hono/zod-openapi";

// Shutterfly's APIs are unofficial and return far more than Zakka needs. These schemas only describe the
// fields the importer reads and pass everything else through, so unrelated upstream changes do not break imports.

const finiteNumber = z.coerce.number().finite();

export const shutterflyTokenListSchema = z.array(
  z.looseObject({
    name: z.string(),
    value: z.string(),
  }),
);

export const shutterflyIdTokenClaimsSchema = z.looseObject({
  sfly_uid: z.string().min(1),
  email: z.string().nullish(),
  exp: z.number(),
});

const metadataEntrySchema = z.looseObject({
  name: z.string(),
  value: z.unknown(),
});

export const shutterflyProjectSummarySchema = z.looseObject({
  _id: z.string().min(1),
  projectName: z
    .string()
    .nullish()
    .transform((value) => value ?? "Untitled project"),
  productCategory: z.string().nullish(),
  projectType: z.looseObject({ group: z.string().nullish(), name: z.string().nullish() }).nullish(),
  projectMetadata: z
    .array(metadataEntrySchema)
    .nullish()
    .transform((value) => value ?? []),
  thumbnailUrl: z.string().nullish(),
  iconUrl: z.string().nullish(),
  createDate: z.string().nullish(),
  updateDate: z.string().nullish(),
});

export const shutterflyProjectListSchema = z.looseObject({
  resources: z
    .array(z.looseObject({ resource: shutterflyProjectSummarySchema }))
    .nullish()
    .transform((value) => value ?? []),
});

const rectSchema = z.looseObject({
  x: finiteNumber,
  y: finiteNumber,
  w: finiteNumber,
  h: finiteNumber,
  rot: finiteNumber.nullish().transform((value) => value ?? 0),
});

export const shutterflyLayeredItemSchema = z.looseObject({
  type: z
    .string()
    .nullish()
    .transform((value) => value ?? "unknown"),
  textBoxType: z.string().nullish(),
  container: rectSchema,
  content: z
    .looseObject({
      contentType: z.string().nullish(),
      userData: z
        .record(z.string(), z.unknown())
        .nullish()
        .transform((value) => value ?? {}),
    })
    .nullish()
    .transform((value) => value ?? { userData: {} }),
  border: z
    .looseObject({
      contentType: z.string().nullish(),
      userData: z
        .record(z.string(), z.unknown())
        .nullish()
        .transform((value) => value ?? {}),
    })
    .nullish(),
  layerMetadata: z
    .array(metadataEntrySchema)
    .nullish()
    .transform((value) => value ?? []),
});

export const shutterflySurfaceSchema = z.looseObject({
  surfaceNumber: z.coerce.string(),
  surfaceMetadata: z
    .array(metadataEntrySchema)
    .nullish()
    .transform((value) => value ?? []),
  surfaceData: z.looseObject({
    pageDetails: z.looseObject({
      width: finiteNumber,
      height: finiteNumber,
      dpi: finiteNumber.nullish().transform((value) => value ?? 300),
    }),
    layeredItems: z
      .array(shutterflyLayeredItemSchema)
      .nullish()
      .transform((value) => value ?? []),
  }),
});

export const shutterflyPhotoWellEntrySchema = z.looseObject({
  id: z.coerce.string(),
  source: z.string().nullish(),
  assetRef: z.string().nullish(),
  width: finiteNumber.nullish(),
  height: finiteNumber.nullish(),
});

export const shutterflyProjectSchema = shutterflyProjectSummarySchema.extend({
  photoWell: z
    .array(shutterflyPhotoWellEntrySchema)
    .nullish()
    .transform((value) => value ?? []),
  surfaceCategories: z
    .array(
      z.looseObject({
        categoryName: z.string(),
        surfaces: z
          .array(shutterflySurfaceSchema)
          .nullish()
          .transform((value) => value ?? []),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

export const shutterflyMediaDetailsSchema = z.record(
  z.string(),
  z
    .array(
      z.looseObject({
        id: z.coerce.string(),
        fileName: z.string().nullish(),
        title: z.string().nullish(),
        url: z.string().nullish(),
        image_def: z
          .looseObject({ width: finiteNumber.nullish(), height: finiteNumber.nullish() })
          .nullish(),
      }),
    )
    .catch([]),
);

export const shutterflyDesignAssetSchema = z.looseObject({
  id: z.string(),
  name: z.string().nullish(),
  assetType: z.string().nullish(),
  availability: z.string().nullish(),
  // Retired font assets point to the live font Shutterfly now renders in their place.
  attributes: z.looseObject({ validNewFontId: z.string().nullish() }).nullish().catch(null),
  fill: z.string().nullish(),
  preview: z.string().nullish(),
  files: z
    .record(
      z.string(),
      z.looseObject({ location: z.string().nullish(), fileType: z.string().nullish() }),
    )
    .nullish(),
});

export const shutterflyDesignAssetListSchema = z.looseObject({
  entities: z
    .looseObject({
      designAssets: z
        .array(shutterflyDesignAssetSchema)
        .nullish()
        .transform((value) => value ?? []),
    })
    .nullish()
    .transform((value) => value ?? { designAssets: [] }),
});

export type ShutterflyProjectSummary = z.infer<typeof shutterflyProjectSummarySchema>;
export type ShutterflyProject = z.infer<typeof shutterflyProjectSchema>;
export type ShutterflySurface = z.infer<typeof shutterflySurfaceSchema>;
export type ShutterflyLayeredItem = z.infer<typeof shutterflyLayeredItemSchema>;
export type ShutterflyDesignAsset = z.infer<typeof shutterflyDesignAssetSchema>;

export const readMetadataValue = (
  metadata: ReadonlyArray<{ name: string; value: unknown }>,
  name: string,
): unknown => metadata.find((entry) => entry.name === name)?.value;
