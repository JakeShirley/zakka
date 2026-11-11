import type { EntityKind, OpaqueId } from "@zakka/domain";

type InternalEntityKind =
  | "authIdentity"
  | "assetVariant"
  | "bookPage"
  | "bookAsset"
  | "albumAsset"
  | "stickerPack"
  | "customSticker"
  | "customWashiTape"
  | "integrationConnection"
  | "externalMediaLink";

const internalPrefixes: Record<InternalEntityKind, string> = {
  authIdentity: "auth_identity",
  assetVariant: "asset_variant",
  bookPage: "book_page",
  bookAsset: "book_asset",
  albumAsset: "album_asset",
  stickerPack: "sticker_pack",
  customSticker: "custom_sticker",
  customWashiTape: "custom_washi_tape",
  integrationConnection: "integration_connection",
  externalMediaLink: "external_media_link",
};

export const createEntityId = <Kind extends EntityKind>(kind: Kind): OpaqueId<Kind> =>
  `${kind}_${crypto.randomUUID()}` as OpaqueId<Kind>;

export const createInternalId = (kind: InternalEntityKind): string =>
  `${internalPrefixes[kind]}_${crypto.randomUUID()}`;
