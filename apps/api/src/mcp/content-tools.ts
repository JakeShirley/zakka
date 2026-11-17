import { z } from "@hono/zod-openapi";
import { toCustomBackgroundId, washiTapeDesignSchema } from "@zakka/editor-core";
import sharp from "sharp";

import { createCustomBackgroundFromUpload, deleteCustomBackground } from "../custom-backgrounds.js";
import { createCustomStickerFromUpload } from "../custom-stickers.js";
import type {
  CustomBackgroundRecord,
  CustomStickerRecord,
  CustomWashiTapeRecord,
} from "../persistence/schema.js";
import { validateWashiTapeDesign, washiTapeDesignErrorMessages } from "../washi-tapes.js";
import { decodeBase64Upload, jsonResult, type McpToolContext, runTool } from "./shared.js";

const maxStickerByteSize = 5 * 1024 * 1024;
export const maxBackgroundByteSize = 25 * 1024 * 1024;
const nameSchema = z.string().trim().min(1).max(120);
const optionalTextSchema = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .nullable()
    .optional()
    .describe("Use null or an empty string to clear it.");

const defaultWashiTapeTile = {
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
};

const washiTapeDesignDescription =
  "Washi tape design: { outline: straight | angled | rounded | torn | notched | bracket | pinched | tapered | scallop | stamp | wave, pattern: { kind: solid | polkaDot | stripe | grid | checker | customPhoto, primaryColor, secondaryColor, assetId (a photo id, required for customPhoto) }, tile (optional): { scale 0.2-4, scaleX, scaleY, rotation, offsetX -1..1, offsetY -1..1 } }.";

const uploadDataSchema = z
  .string()
  .min(1)
  .describe("The image file encoded as base64. A data: URL prefix is also accepted.");

const stripStickerPrefix = (stickerId: string) => stickerId.replace(/^custom:/, "");

const toStickerResult = (sticker: CustomStickerRecord) => ({
  stickerId: `custom:${sticker.id}`,
  packId: sticker.packId,
  name: sticker.name,
  mimeType: sticker.mimeType,
  width: sticker.width,
  height: sticker.height,
  isFavorite: sticker.isFavorite,
});

const toWashiTapeResult = (washiTape: CustomWashiTapeRecord) => ({
  id: washiTape.id,
  name: washiTape.name,
  design: washiTapeDesignSchema.parse(JSON.parse(washiTape.designJson)),
  updatedAt: washiTape.updatedAt,
});

const toBackgroundResult = (background: CustomBackgroundRecord) => ({
  id: background.id,
  backgroundId: toCustomBackgroundId(background.id),
  name: background.name,
  width: background.width,
  height: background.height,
  source: background.source,
});

/** Registers tools for managing custom sticker packs, washi tape designs and backgrounds. */
export const registerContentTools = (ctx: McpToolContext) => {
  const { accountId, repositories, server, storage } = ctx;

  const requirePack = (packId: string) => {
    const pack = repositories.stickerPacks
      .listForAccount(accountId)
      .find((candidate) => candidate.id === packId);

    if (!pack) {
      throw new Error(`Sticker pack ${packId} was not found`);
    }

    return pack;
  };

  const requireSticker = (stickerId: string) => {
    const sticker = repositories.stickerPacks.findStickerByIdForAccount(
      accountId,
      stripStickerPrefix(stickerId),
    );

    if (!sticker) {
      throw new Error(`Custom sticker ${stickerId} was not found`);
    }

    return sticker;
  };

  const parseWashiTapeDesign = (design: Record<string, unknown>) => {
    const parsed = washiTapeDesignSchema.parse({
      ...design,
      tile: { ...defaultWashiTapeTile, ...(design.tile as object | undefined) },
    });
    const validation = validateWashiTapeDesign(accountId, parsed, repositories);

    if (validation !== "ok") {
      throw new Error(washiTapeDesignErrorMessages[validation]);
    }

    return parsed;
  };

  const removeStoredFiles = async (keys: string[]) => {
    // Storage cleanup is best effort; the database rows are already gone.
    await Promise.allSettled(keys.map((key) => storage.remove(key)));
  };

  server.registerTool(
    "list_sticker_packs",
    {
      title: "List sticker packs",
      description:
        "Lists the user's custom sticker packs and, optionally, the stickers in each. Use a sticker's stickerId on a sticker layer.",
      inputSchema: {
        includeStickers: z.boolean().optional().describe("Include each pack's stickers."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ includeStickers = false }) =>
      runTool(() =>
        jsonResult({
          packs: repositories.stickerPacks.listForAccount(accountId).map((pack) => ({
            id: pack.id,
            title: pack.title,
            author: pack.author,
            sourceUrl: pack.sourceUrl,
            stickerCount: pack.stickerCount,
            ...(includeStickers
              ? {
                  stickers: repositories.stickerPacks
                    .listStickersForPack(accountId, pack.id)
                    .map(toStickerResult),
                }
              : {}),
          })),
        }),
      ),
  );

  server.registerTool(
    "create_sticker_pack",
    {
      title: "Create sticker pack",
      description: "Creates an empty custom sticker pack. Add stickers with upload_sticker.",
      inputSchema: {
        title: nameSchema,
        author: optionalTextSchema(120),
        sourceUrl: optionalTextSchema(2048),
      },
    },
    ({ author, sourceUrl, title }) =>
      runTool(() => {
        const pack = repositories.stickerPacks.create({
          accountId,
          title,
          author: author || null,
          sourceUrl: sourceUrl || null,
        });

        return jsonResult({ ...requirePack(pack.id) });
      }),
  );

  server.registerTool(
    "update_sticker_pack",
    {
      title: "Update sticker pack",
      description: "Changes a sticker pack's title, author or source URL.",
      inputSchema: {
        packId: z.string(),
        title: nameSchema.optional(),
        author: optionalTextSchema(120),
        sourceUrl: optionalTextSchema(2048),
      },
      annotations: { idempotentHint: true },
    },
    ({ author, packId, sourceUrl, title }) =>
      runTool(() => {
        const updated = repositories.stickerPacks.update({
          accountId,
          packId,
          ...(title === undefined ? {} : { title }),
          ...(author === undefined ? {} : { author: author || null }),
          ...(sourceUrl === undefined ? {} : { sourceUrl: sourceUrl || null }),
        });

        if (!updated) {
          throw new Error(`Sticker pack ${packId} was not found`);
        }

        return jsonResult({ ...requirePack(packId) });
      }),
  );

  server.registerTool(
    "delete_sticker_pack",
    {
      title: "Delete sticker pack",
      description:
        "Permanently deletes a custom sticker pack and every sticker in it. Sticker layers that use them will no longer show the sticker. This cannot be undone.",
      inputSchema: { packId: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ packId }) =>
      runTool(async () => {
        const { deleted, removedStickers } = repositories.stickerPacks.delete({
          accountId,
          packId,
        });

        if (!deleted) {
          throw new Error(`Sticker pack ${packId} was not found`);
        }

        await removeStoredFiles(removedStickers.map((sticker) => sticker.storageKey));

        return jsonResult({ deletedPackId: packId, removedStickerCount: removedStickers.length });
      }),
  );

  server.registerTool(
    "upload_sticker",
    {
      title: "Upload sticker",
      description:
        "Adds an image to a custom sticker pack. Accepts PNG, JPEG, WebP, GIF, SVG, HEIC, HEIF or JPEG 2000 up to 5 MB. Transparent PNGs work best.",
      inputSchema: {
        packId: z.string(),
        data: uploadDataSchema,
        filename: z.string().optional().describe("File name, used to detect the image type."),
        name: z.string().trim().max(120).optional().describe("Defaults to the file name."),
      },
    },
    ({ data, filename, name, packId }) =>
      runTool(async () => {
        requirePack(packId);

        const sticker = await createCustomStickerFromUpload({
          accountId,
          file: decodeBase64Upload({
            data,
            filename,
            maxByteSize: maxStickerByteSize,
            tooLargeMessage: "Uploaded sticker must be 5 MB or smaller",
          }),
          packId,
          ...(name ? { name } : {}),
          repositories,
          storage,
        });

        return jsonResult(toStickerResult(sticker));
      }),
  );

  server.registerTool(
    "view_sticker",
    {
      title: "View sticker",
      description: "Returns a custom sticker as a PNG image so you can see it.",
      inputSchema: { stickerId: z.string().describe("A custom sticker id, such as custom:...") },
      annotations: { readOnlyHint: true },
    },
    ({ stickerId }) =>
      runTool(async () => {
        const sticker = requireSticker(stickerId);
        const image = await sharp(await storage.read(sticker.storageKey))
          .resize({ fit: "inside", height: 512, width: 512, withoutEnlargement: true })
          .png()
          .toBuffer();

        return {
          content: [{ type: "image", data: image.toString("base64"), mimeType: "image/png" }],
        };
      }),
  );

  server.registerTool(
    "remove_sticker",
    {
      title: "Remove sticker",
      description:
        "Permanently removes a custom sticker from its pack. Sticker layers that use it will no longer show it.",
      inputSchema: { stickerId: z.string().describe("A custom sticker id, such as custom:...") },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ stickerId }) =>
      runTool(async () => {
        const removed = repositories.stickerPacks.removeStickerFromPack({
          accountId,
          stickerId: requireSticker(stickerId).id,
        });

        if (!removed) {
          throw new Error(`Custom sticker ${stickerId} was not found`);
        }

        await removeStoredFiles([removed.storageKey]);

        return jsonResult({ removedStickerId: `custom:${removed.id}` });
      }),
  );

  server.registerTool(
    "set_sticker_favorite",
    {
      title: "Set sticker favorite",
      description:
        "Marks or unmarks a custom sticker as a favorite in the editor's sticker picker.",
      inputSchema: {
        stickerId: z.string().describe("A custom sticker id, such as custom:..."),
        isFavorite: z.boolean(),
      },
      annotations: { idempotentHint: true },
    },
    ({ isFavorite, stickerId }) =>
      runTool(() => {
        const updated = repositories.stickerPacks.setStickerFavorite({
          accountId,
          isFavorite,
          stickerId: requireSticker(stickerId).id,
        });

        if (!updated) {
          throw new Error(`Custom sticker ${stickerId} was not found`);
        }

        return jsonResult(toStickerResult(updated));
      }),
  );

  server.registerTool(
    "list_washi_tapes",
    {
      title: "List washi tapes",
      description:
        "Lists the user's saved washi tape designs. Copy a design's outline, pattern and tile onto a washiTape layer to use it.",
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool(() =>
        jsonResult({
          washiTapes: repositories.customWashiTapes
            .listForAccount(accountId)
            .map(toWashiTapeResult),
        }),
      ),
  );

  server.registerTool(
    "create_washi_tape",
    {
      title: "Create washi tape",
      description: "Saves a washi tape design to the user's gallery.",
      inputSchema: {
        name: nameSchema,
        design: z.record(z.string(), z.unknown()).describe(washiTapeDesignDescription),
      },
    },
    ({ design, name }) =>
      runTool(() =>
        jsonResult(
          toWashiTapeResult(
            repositories.customWashiTapes.create({
              accountId,
              name,
              designJson: JSON.stringify(parseWashiTapeDesign(design)),
            }),
          ),
        ),
      ),
  );

  server.registerTool(
    "update_washi_tape",
    {
      title: "Update washi tape",
      description:
        "Renames or redesigns a saved washi tape. Tape already placed on pages is unchanged.",
      inputSchema: {
        washiTapeId: z.string(),
        name: nameSchema.optional(),
        design: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(`A full replacement design. ${washiTapeDesignDescription}`),
      },
      annotations: { idempotentHint: true },
    },
    ({ design, name, washiTapeId }) =>
      runTool(() => {
        if (name === undefined && design === undefined) {
          throw new Error("Provide a name or a design");
        }

        const updated = repositories.customWashiTapes.update({
          accountId,
          washiTapeId,
          ...(name === undefined ? {} : { name }),
          ...(design === undefined
            ? {}
            : { designJson: JSON.stringify(parseWashiTapeDesign(design)) }),
        });

        if (!updated) {
          throw new Error(`Washi tape ${washiTapeId} was not found`);
        }

        return jsonResult(toWashiTapeResult(updated));
      }),
  );

  server.registerTool(
    "delete_washi_tape",
    {
      title: "Delete washi tape",
      description:
        "Removes a saved washi tape design from the gallery. Tape already placed on pages is unchanged.",
      inputSchema: { washiTapeId: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ washiTapeId }) =>
      runTool(() => {
        if (!repositories.customWashiTapes.delete({ accountId, washiTapeId })) {
          throw new Error(`Washi tape ${washiTapeId} was not found`);
        }

        return jsonResult({ deletedWashiTapeId: washiTapeId });
      }),
  );

  server.registerTool(
    "upload_background",
    {
      title: "Upload background",
      description:
        "Adds an image to the user's page backgrounds. Accepts PNG, JPEG, WebP, GIF, SVG, HEIC or HEIF up to 25 MB. Set it on a page with update_page.",
      inputSchema: {
        data: uploadDataSchema,
        filename: z.string().optional().describe("File name, used to detect the image type."),
        name: z.string().trim().max(120).optional().describe("Defaults to the file name."),
      },
    },
    ({ data, filename, name }) =>
      runTool(async () => {
        const background = await createCustomBackgroundFromUpload({
          accountId,
          file: decodeBase64Upload({
            data,
            filename,
            maxByteSize: maxBackgroundByteSize,
            tooLargeMessage: "Uploaded background must be 25 MB or smaller",
          }),
          name,
          repositories,
          storage,
        });

        return jsonResult(toBackgroundResult(background));
      }),
  );

  server.registerTool(
    "rename_background",
    {
      title: "Rename background",
      description: "Renames one of the user's uploaded backgrounds.",
      inputSchema: {
        backgroundId: z
          .string()
          .describe("The background's id or its custom: backgroundId from list_backgrounds."),
        name: nameSchema,
      },
      annotations: { idempotentHint: true },
    },
    ({ backgroundId, name }) =>
      runTool(() => {
        const renamed = repositories.customBackgrounds.rename({
          accountId,
          backgroundId: backgroundId.replace(/^custom:/, ""),
          name,
        });

        if (!renamed) {
          throw new Error(`Background ${backgroundId} was not found`);
        }

        return jsonResult(toBackgroundResult(renamed));
      }),
  );

  server.registerTool(
    "delete_background",
    {
      title: "Delete background",
      description:
        "Permanently deletes one of the user's uploaded backgrounds. Backgrounds still used on a page can't be deleted.",
      inputSchema: {
        backgroundId: z
          .string()
          .describe("The background's id or its custom: backgroundId from list_backgrounds."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ backgroundId }) =>
      runTool(async () => {
        const result = await deleteCustomBackground({
          accountId,
          backgroundId: backgroundId.replace(/^custom:/, ""),
          repositories,
          storage,
        });

        if (result === "not_found") {
          throw new Error(`Background ${backgroundId} was not found`);
        }

        if (result === "in_use") {
          throw new Error(
            "This background is used on a page. Remove it from those pages before deleting it.",
          );
        }

        return jsonResult({ deletedBackgroundId: backgroundId });
      }),
  );
};
