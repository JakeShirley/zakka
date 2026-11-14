import type { apiClient } from "./apiClient";

export type AuthSession = Awaited<ReturnType<typeof apiClient.getCurrentSession>>;
export type Asset = Awaited<ReturnType<typeof apiClient.listAssets>>["assets"][number];
export type Album = Awaited<ReturnType<typeof apiClient.listAlbums>>["albums"][number];
export type StickerPack = Awaited<ReturnType<typeof apiClient.listStickerPacks>>["packs"][number];
export type CustomSticker = Awaited<
  ReturnType<typeof apiClient.listCustomStickers>
>["stickers"][number];
export type CustomWashiTape = Awaited<
  ReturnType<typeof apiClient.listCustomWashiTapes>
>["washiTapes"][number];
export type CustomBackground = Awaited<
  ReturnType<typeof apiClient.listCustomBackgrounds>
>["backgrounds"][number];
export type BookSummary = Awaited<ReturnType<typeof apiClient.listBooks>>["books"][number];
export type BookDetail = Awaited<ReturnType<typeof apiClient.getBook>>;
export type ExportJob = Awaited<ReturnType<typeof apiClient.createExport>>;
export type PageSummary = Awaited<ReturnType<typeof apiClient.listPages>>["pages"][number];
export type PageDetail = Awaited<ReturnType<typeof apiClient.getPage>>;

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous"; message?: string }
  | { status: "authenticated"; session: AuthSession };

export type AuthMode = "login" | "register";
