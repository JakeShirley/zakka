import {
  type AlbumAssetsAddRequest,
  type AlbumCreateRequest,
  type AlbumListResponse,
  type AlbumPatchRequest,
  type AlbumResponse,
  albumListResponseSchema,
  albumResponseSchema,
  type AssetListResponse,
  type AssetResponse,
  type AuthSessionResponse,
  assetListResponseSchema,
  assetResponseSchema,
  authSessionResponseSchema,
  type BookAssetsAddRequest,
  type BookCreateRequest,
  type BookListResponse,
  type BookPatchRequest,
  type BookResponse,
  type BookSetPagesRequest,
  bookListResponseSchema,
  bookResponseSchema,
  type CustomStickerListResponse,
  type CustomStickerResponse,
  type CustomStickerFavoritePatchRequest,
  customStickerListResponseSchema,
  customStickerResponseSchema,
  type ExportCreateRequest,
  type ExportJobResponse,
  errorResponseSchema,
  exportJobResponseSchema,
  type HealthResponse,
  healthResponseSchema,
  type LoginRequest,
  type PageCreateRequest,
  type PageDuplicateRequest,
  type PageListResponse,
  type PagePatchRequest,
  type PageResponse,
  pageListResponseSchema,
  pageResponseSchema,
  type RegisterRequest,
  type ServerLogLevel,
  type ServerLogListResponse,
  type ShutterflyConnectionResponse,
  type ShutterflyImportResponse,
  type ShutterflyProjectListResponse,
  serverLogListResponseSchema,
  shutterflyConnectionResponseSchema,
  shutterflyImportResponseSchema,
  shutterflyProjectListResponseSchema,
  type StickerPackCreateRequest,
  type StickerPackListResponse,
  type StickerPackPatchRequest,
  type StickerPackResponse,
  stickerPackListResponseSchema,
  stickerPackResponseSchema,
} from "@zakka/api-contract";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const defaultBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

type ResponseSchema<Output> = {
  parse: (value: unknown) => Output;
};

const buildUrl = (baseUrl: string, path: string): string => `${baseUrl}${path}`;

const parseErrorPayload = (payload: unknown, status: number): ApiClientError => {
  const parsed = errorResponseSchema.safeParse(payload);

  if (!parsed.success) {
    return new ApiClientError("The API request failed", status, "request_failed");
  }

  return new ApiClientError(parsed.data.error.message, status, parsed.data.error.code);
};

const parseError = async (response: Response): Promise<ApiClientError> => {
  try {
    return parseErrorPayload(await response.json(), response.status);
  } catch {
    return new ApiClientError("The API request failed", response.status, "request_failed");
  }
};

const requestJson = async <Output>(
  baseUrl: string,
  schema: ResponseSchema<Output>,
  path: string,
  init: RequestInit = {},
): Promise<Output> => {
  const response = await fetch(buildUrl(baseUrl, path), {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return schema.parse(await response.json());
};

export type ApiClient = ReturnType<typeof createApiClient>;

export const createApiClient = (baseUrl = defaultBaseUrl) => ({
  getHealth: (): Promise<HealthResponse> =>
    requestJson(baseUrl, healthResponseSchema, "/api/v1/health"),

  listServerLogs: (level: ServerLogLevel, limit = 200): Promise<ServerLogListResponse> =>
    requestJson(
      baseUrl,
      serverLogListResponseSchema,
      `/api/v1/logs?${new URLSearchParams({ level, limit: String(limit) })}`,
    ),

  getCurrentSession: (): Promise<AuthSessionResponse> =>
    requestJson(baseUrl, authSessionResponseSchema, "/api/v1/auth/session"),

  listAssets: (): Promise<AssetListResponse> =>
    requestJson(baseUrl, assetListResponseSchema, "/api/v1/assets"),

  listAlbums: (): Promise<AlbumListResponse> =>
    requestJson(baseUrl, albumListResponseSchema, "/api/v1/albums"),

  createAlbum: (input: AlbumCreateRequest): Promise<AlbumResponse> =>
    requestJson(baseUrl, albumResponseSchema, "/api/v1/albums", {
      body: JSON.stringify(input),
      method: "POST",
    }),

  updateAlbum: (albumId: string, input: AlbumPatchRequest): Promise<AlbumResponse> =>
    requestJson(baseUrl, albumResponseSchema, `/api/v1/albums/${albumId}`, {
      body: JSON.stringify(input),
      method: "PATCH",
    }),

  deleteAlbum: async (albumId: string): Promise<void> => {
    const response = await fetch(buildUrl(baseUrl, `/api/v1/albums/${albumId}`), {
      credentials: "include",
      method: "DELETE",
    });

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  listAlbumAssets: (albumId: string): Promise<AssetListResponse> =>
    requestJson(baseUrl, assetListResponseSchema, `/api/v1/albums/${albumId}/assets`),

  listAssetAlbums: (assetId: string): Promise<AlbumListResponse> =>
    requestJson(baseUrl, albumListResponseSchema, `/api/v1/assets/${assetId}/albums`),

  addAlbumAssets: (albumId: string, input: AlbumAssetsAddRequest): Promise<AssetListResponse> =>
    requestJson(baseUrl, assetListResponseSchema, `/api/v1/albums/${albumId}/assets`, {
      body: JSON.stringify(input),
      method: "POST",
    }),

  removeAlbumAsset: async (albumId: string, assetId: string): Promise<void> => {
    const response = await fetch(buildUrl(baseUrl, `/api/v1/albums/${albumId}/assets/${assetId}`), {
      credentials: "include",
      method: "DELETE",
    });

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  listStickerPacks: (): Promise<StickerPackListResponse> =>
    requestJson(baseUrl, stickerPackListResponseSchema, "/api/v1/sticker-packs"),

  createStickerPack: (input: StickerPackCreateRequest): Promise<StickerPackResponse> =>
    requestJson(baseUrl, stickerPackResponseSchema, "/api/v1/sticker-packs", {
      body: JSON.stringify(input),
      method: "POST",
    }),

  updateStickerPack: (
    packId: string,
    input: StickerPackPatchRequest,
  ): Promise<StickerPackResponse> =>
    requestJson(baseUrl, stickerPackResponseSchema, `/api/v1/sticker-packs/${packId}`, {
      body: JSON.stringify(input),
      method: "PATCH",
    }),

  deleteStickerPack: async (packId: string): Promise<void> => {
    const response = await fetch(buildUrl(baseUrl, `/api/v1/sticker-packs/${packId}`), {
      credentials: "include",
      method: "DELETE",
    });

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  listPackStickers: (packId: string): Promise<CustomStickerListResponse> =>
    requestJson(
      baseUrl,
      customStickerListResponseSchema,
      `/api/v1/sticker-packs/${packId}/stickers`,
    ),

  listCustomStickers: (packId?: string): Promise<CustomStickerListResponse> => {
    const path = packId
      ? `/api/v1/custom-stickers?${new URLSearchParams({ packId })}`
      : "/api/v1/custom-stickers";

    return requestJson(baseUrl, customStickerListResponseSchema, path);
  },

  removeCustomSticker: async (packId: string, stickerId: string): Promise<void> => {
    const response = await fetch(
      buildUrl(baseUrl, `/api/v1/sticker-packs/${packId}/stickers/${stickerId}`),
      { credentials: "include", method: "DELETE" },
    );

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  setCustomStickerFavorite: (
    stickerId: string,
    input: CustomStickerFavoritePatchRequest,
  ): Promise<CustomStickerResponse> =>
    requestJson(
      baseUrl,
      customStickerResponseSchema,
      `/api/v1/custom-stickers/${stickerId}/favorite`,
      { body: JSON.stringify(input), method: "PATCH" },
    ),

  uploadCustomSticker: (
    packId: string,
    file: File,
    options: { name?: string; onProgress?: (progress: number | null) => void } = {},
  ): Promise<CustomStickerResponse> =>
    new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const form = new FormData();

      form.append("file", file);
      if (options.name) {
        form.append("name", options.name);
      }
      request.open("POST", buildUrl(baseUrl, `/api/v1/sticker-packs/${packId}/stickers`));
      request.withCredentials = true;

      request.upload.onprogress = (event) => {
        options.onProgress?.(event.lengthComputable ? event.loaded / event.total : null);
      };
      request.onerror = () => {
        reject(new ApiClientError("The API request failed", 0, "network_error"));
      };
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          try {
            reject(parseErrorPayload(JSON.parse(request.responseText), request.status));
          } catch {
            reject(new ApiClientError("The API request failed", request.status, "request_failed"));
          }
          return;
        }

        try {
          options.onProgress?.(1);
          resolve(customStickerResponseSchema.parse(JSON.parse(request.responseText)));
        } catch (error) {
          reject(error);
        }
      };
      request.send(form);
    }),

  listPages: (): Promise<PageListResponse> =>
    requestJson(baseUrl, pageListResponseSchema, "/api/v1/pages"),

  listBooks: (): Promise<BookListResponse> =>
    requestJson(baseUrl, bookListResponseSchema, "/api/v1/books"),

  getShutterflyConnection: (): Promise<ShutterflyConnectionResponse> =>
    requestJson(baseUrl, shutterflyConnectionResponseSchema, "/api/v1/integrations/shutterfly"),

  connectShutterfly: (refreshToken: string): Promise<ShutterflyConnectionResponse> =>
    requestJson(baseUrl, shutterflyConnectionResponseSchema, "/api/v1/integrations/shutterfly", {
      body: JSON.stringify({ refreshToken }),
      method: "PUT",
    }),

  disconnectShutterfly: async (): Promise<void> => {
    const response = await fetch(buildUrl(baseUrl, "/api/v1/integrations/shutterfly"), {
      credentials: "include",
      method: "DELETE",
    });

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  listShutterflyProjects: (): Promise<ShutterflyProjectListResponse> =>
    requestJson(
      baseUrl,
      shutterflyProjectListResponseSchema,
      "/api/v1/integrations/shutterfly/projects",
    ),

  importShutterflyProject: (projectId: string): Promise<ShutterflyImportResponse> =>
    requestJson(
      baseUrl,
      shutterflyImportResponseSchema,
      `/api/v1/integrations/shutterfly/projects/${encodeURIComponent(projectId)}/import`,
      { method: "POST" },
    ),

  createBook: (input: BookCreateRequest): Promise<BookResponse> =>
    requestJson(baseUrl, bookResponseSchema, "/api/v1/books", {
      body: JSON.stringify(input),
      method: "POST",
    }),

  getBook: (bookId: string): Promise<BookResponse> =>
    requestJson(baseUrl, bookResponseSchema, `/api/v1/books/${bookId}`),

  updateBook: (bookId: string, input: BookPatchRequest): Promise<BookResponse> =>
    requestJson(baseUrl, bookResponseSchema, `/api/v1/books/${bookId}`, {
      body: JSON.stringify(input),
      method: "PATCH",
    }),

  setBookPages: (bookId: string, input: BookSetPagesRequest): Promise<BookResponse> =>
    requestJson(baseUrl, bookResponseSchema, `/api/v1/books/${bookId}/pages`, {
      body: JSON.stringify(input),
      method: "PUT",
    }),

  listBookAssets: (bookId: string): Promise<AssetListResponse> =>
    requestJson(baseUrl, assetListResponseSchema, `/api/v1/books/${bookId}/assets`),

  addBookAssets: (bookId: string, input: BookAssetsAddRequest): Promise<AssetListResponse> =>
    requestJson(baseUrl, assetListResponseSchema, `/api/v1/books/${bookId}/assets`, {
      body: JSON.stringify(input),
      method: "POST",
    }),

  removeBookAsset: async (bookId: string, assetId: string): Promise<void> => {
    const response = await fetch(buildUrl(baseUrl, `/api/v1/books/${bookId}/assets/${assetId}`), {
      credentials: "include",
      method: "DELETE",
    });

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  deleteBook: async (bookId: string): Promise<void> => {
    const response = await fetch(buildUrl(baseUrl, `/api/v1/books/${bookId}`), {
      credentials: "include",
      method: "DELETE",
    });

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  createExport: (input: ExportCreateRequest): Promise<ExportJobResponse> =>
    requestJson(baseUrl, exportJobResponseSchema, "/api/v1/exports", {
      body: JSON.stringify(input),
      method: "POST",
    }),

  getExport: (exportId: string): Promise<ExportJobResponse> =>
    requestJson(baseUrl, exportJobResponseSchema, `/api/v1/exports/${exportId}`),

  createPage: (input: PageCreateRequest): Promise<PageResponse> =>
    requestJson(baseUrl, pageResponseSchema, "/api/v1/pages", {
      body: JSON.stringify(input),
      method: "POST",
    }),

  getPage: (pageId: string): Promise<PageResponse> =>
    requestJson(baseUrl, pageResponseSchema, `/api/v1/pages/${pageId}`),

  updatePage: (pageId: string, input: PagePatchRequest): Promise<PageResponse> =>
    requestJson(baseUrl, pageResponseSchema, `/api/v1/pages/${pageId}`, {
      body: JSON.stringify(input),
      method: "PATCH",
    }),

  duplicatePage: (pageId: string, input: PageDuplicateRequest): Promise<PageResponse> =>
    requestJson(baseUrl, pageResponseSchema, `/api/v1/pages/${pageId}/duplicate`, {
      body: JSON.stringify(input),
      method: "POST",
    }),

  deletePage: async (pageId: string): Promise<void> => {
    const response = await fetch(buildUrl(baseUrl, `/api/v1/pages/${pageId}`), {
      credentials: "include",
      method: "DELETE",
    });

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  login: (input: LoginRequest): Promise<AuthSessionResponse> =>
    requestJson(baseUrl, authSessionResponseSchema, "/api/v1/auth/login", {
      body: JSON.stringify(input),
      method: "POST",
    }),

  logout: async (): Promise<void> => {
    const response = await fetch(buildUrl(baseUrl, "/api/v1/auth/logout"), {
      credentials: "include",
      method: "POST",
    });

    if (!response.ok) {
      throw await parseError(response);
    }
  },

  register: (input: RegisterRequest): Promise<AuthSessionResponse> =>
    requestJson(baseUrl, authSessionResponseSchema, "/api/v1/auth/register", {
      body: JSON.stringify(input),
      method: "POST",
    }),

  uploadAsset: (
    file: File,
    onProgress?: (progress: number | null) => void,
  ): Promise<AssetResponse> =>
    new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const form = new FormData();

      form.append("file", file);
      request.open("POST", buildUrl(baseUrl, "/api/v1/assets/uploads"));
      request.withCredentials = true;

      request.upload.onprogress = (event) => {
        onProgress?.(event.lengthComputable ? event.loaded / event.total : null);
      };
      request.onerror = () => {
        reject(new ApiClientError("The API request failed", 0, "network_error"));
      };
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          try {
            reject(parseErrorPayload(JSON.parse(request.responseText), request.status));
          } catch {
            reject(new ApiClientError("The API request failed", request.status, "request_failed"));
          }
          return;
        }

        try {
          onProgress?.(1);
          resolve(assetResponseSchema.parse(JSON.parse(request.responseText)));
        } catch (error) {
          reject(error);
        }
      };
      request.send(form);
    }),
});

export const apiClient = createApiClient();
