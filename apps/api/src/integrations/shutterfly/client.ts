import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import {
  type ShutterflyDesignAsset,
  type ShutterflyProject,
  type ShutterflyProjectSummary,
  shutterflyAlbumPayloadSchema,
  shutterflyAlbumStorySchema,
  shutterflyCommercePageSchema,
  shutterflyDesignAssetListSchema,
  shutterflyIdTokenClaimsSchema,
  shutterflyLibraryRpcSchema,
  shutterflyMediaDetailsSchema,
  shutterflyMomentSearchPayloadSchema,
  shutterflyProjectListSchema,
  shutterflyProjectSchema,
  shutterflyRawProjectListSchema,
  shutterflyTokenListSchema,
} from "./schemas.js";

/** Public Cognito app client id used by shutterfly.com; it appears in every signed-in user's cookie names. */
const cognitoClientId = "t8oiif52mece6bleeas2pof0n";
const tokensUrl = "https://accounts.shutterfly.com/sso/v2/tokens";
const projectsBaseUrl = "https://projects-api3.shutterfly.com/projects/v2/project";
const designAssetsUrl =
  "https://catalog-api3.shutterfly.com/catalogdesign/v1/design-asset-by-ids?context=/sfly/shutterfly/shutterfly-us/default&channel=web";
const designFileBaseUrl = "https://sfly3-catalog-design.sf-cdn.com";
const photosRpcUrl = "https://photos-api3.shutterfly.com/photos/json";
const photosOrigin = "https://photos3.shutterfly.com";
const thislifeRpcUrl = "https://cmd.thislife.com/json";
const thislifeOrigin = "https://photos.shutterfly.com";
const originalDownloadUrl = "https://io.thislife.com/download";
const commerceBaseUrl = "https://commerce-api3.shutterfly.com/commerce/v1";
const projectPageSize = 25;
const maxProjectPages = 20;
// Archiving walks every page; this only stops a misbehaving API from looping forever.
const maxArchiveListPages = 2_000;
const commercePageSize = 20;
const mediaBatchSize = 50;
const designAssetBatchSize = 100;
const maxDownloadBytes = 40 * 1024 * 1024;
const requestTimeoutMs = 30_000;
// Originals include full-length videos, so they get far longer than ordinary API calls.
const originalDownloadTimeoutMs = 60 * 60 * 1000;
const albumMomentRecordLength = 277;
const allowedDownloadHostSuffixes = [".shutterfly.com", ".sf-cdn.com"];
const libraryAuthFailurePattern = /auth|token|expired|session|log ?in|sign ?in/i;

export class ShutterflyAuthError extends Error {
  constructor(
    message = "Shutterfly rejected the sign-in token. Reconnect your Shutterfly account.",
  ) {
    super(message);
    this.name = "ShutterflyAuthError";
  }
}

export class ShutterflyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ShutterflyRequestError";
  }
}

export type ShutterflySession = {
  accountId: string;
  email: string | null;
  expiresAt: number;
  idToken: string;
  /** Photo library user id, which differs from the commerce account id for migrated accounts. */
  libraryId: string;
  refreshToken: string;
};

export type ShutterflyAlbumSummary = {
  id: string;
  name: string;
  /** False for albums other people shared with this account. */
  owned: boolean;
  raw: unknown;
};

export type ShutterflyAlbumContents = {
  id: string;
  name: string | null;
  momentIds: string[];
  raw: unknown;
};

export type ShutterflyRawProject = Record<string, unknown> & { _id: string };

export type ShutterflyMediaDetails = {
  fileName: string | null;
  height: number | null;
  url: string;
  width: number | null;
};

export type ShutterflyClient = ReturnType<typeof createShutterflyClient>;

const refreshTokenPattern = /^[A-Za-z0-9._~-]+$/;

/**
 * Accepts either the bare refresh token value or a pasted `name=value` cookie pair, trimming quotes and whitespace.
 * Returns null when the input cannot be a Cognito refresh token.
 */
export const normalizeShutterflyRefreshToken = (input: string): string | null => {
  let value = input.trim().replace(/^["']|["']$/g, "");
  const separatorIndex = value.indexOf("=");

  if (separatorIndex > 0 && value.slice(0, separatorIndex).includes("refreshToken")) {
    value = value.slice(separatorIndex + 1).trim();
  }

  value = value.replace(/;.*$/, "").trim();

  return value.length >= 20 && refreshTokenPattern.test(value) ? value : null;
};

const decodeJwtClaims = (token: string): unknown => {
  const payload = token.split(".")[1];

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

export const parseShutterflyDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  // Shutterfly sends offsets without a colon, e.g. 2026-05-21T14:59:17.820-0700.
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * Album contents list their moments as one long string of fixed-width records; the moment id is the
 * zero-padded number at characters 9-25 of each record.
 */
export const parseShutterflyAlbumMomentIds = (encoded: string): string[] => {
  const ids = new Set<string>();

  for (let index = 0; index < encoded.length; index += albumMomentRecordLength) {
    const record = encoded.slice(index, index + albumMomentRecordLength);

    if (record.length < 25) {
      continue;
    }

    const id = record.slice(9, 25).replace(/^0+/, "");

    if (id) {
      ids.add(id);
    }
  }

  return [...ids];
};

/** Reads the file name from a Content-Disposition header, preferring the RFC 5987 UTF-8 form. */
export const readContentDispositionFileName = (header: string | null): string | null => {
  if (!header) {
    return null;
  }

  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);

  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain filename parameter.
    }
  }

  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const value = (plain?.[2] ?? plain?.[1] ?? "").trim();

  return value.length > 0 ? value : null;
};

export const isAllowedShutterflyDownloadUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === "https:" &&
      allowedDownloadHostSuffixes.some((suffix) => parsed.hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
};

export const createShutterflyClient = (options: { apiKey: string; fetch?: typeof fetch }) => {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const send = async (
    url: string,
    init: RequestInit = {},
    timing: { timeoutMs?: number; signal?: AbortSignal | undefined } = {},
  ): Promise<Response> => {
    const timeout = AbortSignal.timeout(timing.timeoutMs ?? requestTimeoutMs);

    try {
      return await fetchImpl(url, {
        ...init,
        signal: timing.signal ? AbortSignal.any([timeout, timing.signal]) : timeout,
      });
    } catch (error) {
      if (timing.signal?.aborted) {
        throw timing.signal.reason;
      }

      throw new ShutterflyRequestError(
        `Shutterfly could not be reached: ${error instanceof Error ? error.message : "network error"}`,
      );
    }
  };

  const apiJson = async (
    session: ShutterflySession,
    url: string,
    init: { body?: unknown; method?: "GET" | "POST" } = {},
  ): Promise<unknown> => {
    const response = await send(url, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.idToken}`,
        "x-api-key": options.apiKey,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new ShutterflyAuthError();
    }

    if (!response.ok) {
      throw new ShutterflyRequestError(
        `Shutterfly request failed with status ${response.status}`,
        response.status,
      );
    }

    try {
      return await response.json();
    } catch {
      throw new ShutterflyRequestError("Shutterfly returned an unreadable response");
    }
  };

  const parseOrThrow = <Output>(
    schema: { safeParse: (value: unknown) => { success: true; data: Output } | { success: false } },
    value: unknown,
    what: string,
  ): Output => {
    const parsed = schema.safeParse(value);

    if (!parsed.success) {
      throw new ShutterflyRequestError(`Shutterfly returned an unexpected ${what} format`);
    }

    return parsed.data;
  };

  /** Calls a JSON-RPC style photo library endpoint and returns its payload. */
  const libraryRpc = async (
    session: ShutterflySession,
    target: { url: string; origin: string; authenticated: boolean },
    method: string,
    params: unknown[],
    subSource: string,
  ): Promise<unknown> => {
    const response = await send(`${target.url}?method=${encodeURIComponent(method)}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        // The library endpoints expect a form content type even though the body is JSON.
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: target.origin,
        referer: `${target.origin}/`,
        ...(target.authenticated
          ? { authorization: `Bearer ${session.idToken}`, "x-api-key": options.apiKey }
          : {}),
      },
      body: JSON.stringify({
        method,
        params,
        headers: { "X-SFLY-SubSource": subSource },
        id: null,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new ShutterflyAuthError();
    }

    if (!response.ok) {
      throw new ShutterflyRequestError(
        `Shutterfly photo library request failed with status ${response.status}`,
        response.status,
      );
    }

    const body = parseOrThrow(
      shutterflyLibraryRpcSchema,
      await response.json().catch(() => null),
      "photo library",
    );

    if (!body.result || body.result.success === false) {
      const message = body.result?.message ?? (body.error ? JSON.stringify(body.error) : "");

      if (libraryAuthFailurePattern.test(message)) {
        throw new ShutterflyAuthError();
      }

      throw new ShutterflyRequestError(
        `Shutterfly photo library ${method} failed${message ? `: ${message}` : ""}`,
      );
    }

    return body.result.payload;
  };

  const listRawProjects = async (
    session: ShutterflySession,
    filters: Record<string, string>,
  ): Promise<ShutterflyRawProject[]> => {
    const projects: ShutterflyRawProject[] = [];

    for (let page = 0; page < maxArchiveListPages; page += 1) {
      const query = new URLSearchParams({
        ...filters,
        querySortKeys: "updateDate-",
        queryLimit: String(projectPageSize),
        queryStart: String(page * projectPageSize + 1),
        accountId: session.accountId,
      });
      const body = parseOrThrow(
        shutterflyRawProjectListSchema,
        await apiJson(session, `${projectsBaseUrl}?${query}`),
        "project list",
      );

      projects.push(...body.resources.map(({ resource }) => resource as ShutterflyRawProject));

      if (body.resources.length < projectPageSize) {
        break;
      }
    }

    return projects;
  };

  return {
    refreshSession: async (refreshToken: string): Promise<ShutterflySession> => {
      const response = await send(tokensUrl, {
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          cookie: `CognitoIdentityServiceProvider.${cognitoClientId}.zakka.refreshToken=${refreshToken}`,
        },
      });

      if (response.status === 204 || response.status === 401 || response.status === 403) {
        throw new ShutterflyAuthError();
      }

      if (!response.ok) {
        throw new ShutterflyRequestError(
          `Shutterfly sign-in failed with status ${response.status}`,
          response.status,
        );
      }

      const tokens = shutterflyTokenListSchema.safeParse(await response.json().catch(() => null));
      const idToken = tokens.success
        ? tokens.data.findLast((token) => token.name.endsWith(".idToken"))?.value
        : undefined;

      if (!tokens.success || !idToken) {
        throw new ShutterflyAuthError();
      }

      const claims = shutterflyIdTokenClaimsSchema.safeParse(decodeJwtClaims(idToken));

      if (!claims.success) {
        throw new ShutterflyRequestError("Shutterfly returned an unexpected sign-in token");
      }

      const rotatedRefreshToken = tokens.data.findLast((token) =>
        token.name.endsWith(".refreshToken"),
      )?.value;

      return {
        accountId: claims.data.sfly_uid,
        email: claims.data.email ?? null,
        expiresAt: claims.data.exp * 1000,
        idToken,
        libraryId: claims.data.sfly3_uid || claims.data.sfly_uid,
        refreshToken: rotatedRefreshToken || refreshToken,
      };
    },

    listProjects: async (session: ShutterflySession): Promise<ShutterflyProjectSummary[]> => {
      const projects: ShutterflyProjectSummary[] = [];

      for (let page = 0; page < maxProjectPages; page += 1) {
        const query = new URLSearchParams({
          state: "saved,purchased",
          filter: "savedNoPhotowell",
          includePortable: "true",
          excludeTypes: "archive",
          includeMigrationStates: "true",
          querySortKeys: "updateDate-",
          queryLimit: String(projectPageSize),
          queryStart: String(page * projectPageSize + 1),
          accountId: session.accountId,
        });
        const body = parseOrThrow(
          shutterflyProjectListSchema,
          await apiJson(session, `${projectsBaseUrl}?${query}`),
          "project list",
        );

        projects.push(...body.resources.map(({ resource }) => resource));

        if (body.resources.length < projectPageSize) {
          break;
        }
      }

      return projects;
    },

    getProject: async (
      session: ShutterflySession,
      projectId: string,
    ): Promise<ShutterflyProject> => {
      const query = new URLSearchParams({
        origin: "web_builder",
        convert: "true",
        accountId: session.accountId,
      });

      return parseOrThrow(
        shutterflyProjectSchema,
        await apiJson(session, `${projectsBaseUrl}/${encodeURIComponent(projectId)}?${query}`),
        "project",
      );
    },

    getMediaDetails: async (
      session: ShutterflySession,
      photos: ReadonlyArray<{ mediaId: string; imageId: string }>,
    ): Promise<Map<string, ShutterflyMediaDetails>> => {
      const details = new Map<string, ShutterflyMediaDetails>();

      for (let index = 0; index < photos.length; index += mediaBatchSize) {
        const batch = photos.slice(index, index + mediaBatchSize);
        const body = parseOrThrow(
          shutterflyMediaDetailsSchema,
          await apiJson(
            session,
            `https://mediaag.shutterfly.com/services/user-media/v3/${encodeURIComponent(session.accountId)}/imageRef/bulk?includeExif=true`,
            {
              method: "POST",
              body: Object.fromEntries(batch.map((photo) => [photo.mediaId, photo.imageId])),
            },
          ),
          "photo details",
        );

        for (const media of Object.values(body).flat()) {
          if (media.url) {
            details.set(media.id, {
              fileName: media.fileName ?? media.title ?? null,
              height: media.image_def?.height ?? null,
              url: media.url,
              width: media.image_def?.width ?? null,
            });
          }
        }
      }

      return details;
    },

    getDesignAssets: async (
      session: ShutterflySession,
      ids: readonly string[],
    ): Promise<Map<string, ShutterflyDesignAsset>> => {
      const assets = new Map<string, ShutterflyDesignAsset>();
      const uniqueIds = [...new Set(ids)];

      for (let index = 0; index < uniqueIds.length; index += designAssetBatchSize) {
        const body = parseOrThrow(
          shutterflyDesignAssetListSchema,
          await apiJson(session, designAssetsUrl, {
            method: "POST",
            body: {
              designAssetIds: uniqueIds.slice(index, index + designAssetBatchSize),
              legacyIds: [],
              legacyNames: [],
            },
          }),
          "design asset",
        );

        for (const asset of body.entities.designAssets) {
          assets.set(asset.id, asset);
        }
      }

      return assets;
    },

    designFileUrl: (location: string): string | null => {
      if (/^https:\/\//.test(location)) {
        return isAllowedShutterflyDownloadUrl(location) ? location : null;
      }

      return location.startsWith("/") ? `${designFileBaseUrl}${location}` : null;
    },

    download: async (url: string): Promise<Buffer> => {
      if (!isAllowedShutterflyDownloadUrl(url)) {
        throw new ShutterflyRequestError("Refusing to download from a non-Shutterfly host");
      }

      const response = await send(url, { redirect: "error" });

      if (!response.ok) {
        throw new ShutterflyRequestError(
          `Shutterfly download failed with status ${response.status}`,
          response.status,
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));

      if (Number.isFinite(declaredLength) && declaredLength > maxDownloadBytes) {
        await response.body?.cancel();
        throw new ShutterflyRequestError("Shutterfly download is too large");
      }

      // Read incrementally so a response without Content-Length cannot exceed the cap in memory.
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      const reader = response.body?.getReader();

      while (reader) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        byteLength += value.byteLength;

        if (byteLength > maxDownloadBytes) {
          await reader.cancel();
          throw new ShutterflyRequestError("Shutterfly download is too large");
        }

        chunks.push(value);
      }

      const buffer = Buffer.concat(chunks, byteLength);

      return buffer;
    },

    /**
     * Lists every saved and purchased project of any product type. The broad query catches products the
     * book importer's filtered query skips; it is best effort because its filters are not documented.
     */
    listAllProjects: async (session: ShutterflySession): Promise<ShutterflyRawProject[]> => {
      const baseFilters = {
        state: "saved,purchased",
        includePortable: "true",
        includeMigrationStates: "true",
      };
      const known = await listRawProjects(session, {
        ...baseFilters,
        filter: "savedNoPhotowell",
        excludeTypes: "archive",
      });
      const broad = await listRawProjects(session, baseFilters).catch((error: unknown) => {
        if (error instanceof ShutterflyAuthError) {
          throw error;
        }

        return [];
      });
      const projects = new Map<string, ShutterflyRawProject>();

      for (const project of [...known, ...broad]) {
        if (!projects.has(project._id)) {
          projects.set(project._id, project);
        }
      }

      return [...projects.values()];
    },

    /** Returns a project exactly as Shutterfly stores it. */
    getRawProject: (session: ShutterflySession, projectId: string): Promise<unknown> => {
      const query = new URLSearchParams({
        origin: "web_builder",
        convert: "true",
        accountId: session.accountId,
      });

      return apiJson(session, `${projectsBaseUrl}/${encodeURIComponent(projectId)}?${query}`);
    },

    /** Lists the id of every photo and video in the account's photo library. */
    listLibraryMomentIds: async (session: ShutterflySession): Promise<string[]> => {
      const payload = parseOrThrow(
        shutterflyMomentSearchPayloadSchema,
        await libraryRpc(
          session,
          { url: photosRpcUrl, origin: photosOrigin, authenticated: true },
          "searchMoments",
          [
            session.idToken,
            session.libraryId,
            true,
            [],
            [],
            [],
            [],
            [],
            false,
            [],
            [],
            null,
            "",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            true,
          ],
          "library",
        ),
        "photo library",
      );

      return [...new Set(payload.moments)];
    },

    listAlbums: async (session: ShutterflySession): Promise<ShutterflyAlbumSummary[]> => {
      const payload = await libraryRpc(
        session,
        { url: thislifeRpcUrl, origin: thislifeOrigin, authenticated: false },
        "album.getAlbums",
        [session.idToken, session.libraryId, null, null, true],
        "library",
      );
      const albums = new Map<string, ShutterflyAlbumSummary>();
      // The payload groups albums into lists: the account's own albums first, then shared ones.
      const groups = Array.isArray(payload) ? payload : [];

      groups.forEach((group, groupIndex) => {
        for (const entry of Array.isArray(group) ? group : []) {
          const story = shutterflyAlbumStorySchema.safeParse(
            (entry as { story?: unknown } | null)?.story,
          );

          if (story.success && !albums.has(story.data.uid)) {
            albums.set(story.data.uid, {
              id: story.data.uid,
              name: story.data.name?.trim() || "Untitled album",
              owned: groupIndex === 0,
              raw: entry,
            });
          }
        }
      });

      return [...albums.values()];
    },

    getAlbum: async (
      session: ShutterflySession,
      albumId: string,
    ): Promise<ShutterflyAlbumContents> => {
      const payload = await libraryRpc(
        session,
        { url: thislifeRpcUrl, origin: thislifeOrigin, authenticated: false },
        "album.getAlbum",
        [session.idToken, albumId, "startupItem", null, false, true, true],
        "albums",
      );
      const album = parseOrThrow(shutterflyAlbumPayloadSchema, payload, "album");
      const { moments, ...raw } = album;

      return {
        id: album.uid ?? albumId,
        name: album.name ?? null,
        momentIds: parseShutterflyAlbumMomentIds(moments ?? ""),
        raw,
      };
    },

    /**
     * Streams the original upload of a photo or video to `destinationPath`. Returns the original file
     * name Shutterfly reports, when it reports one.
     */
    downloadOriginal: async (
      session: ShutterflySession,
      momentId: string,
      destinationPath: string,
      signal?: AbortSignal,
    ): Promise<{ fileName: string | null; contentType: string | null }> => {
      const query = new URLSearchParams({
        accessToken: session.idToken,
        momentId,
        source: "library",
      });
      const response = await send(
        `${originalDownloadUrl}?${query}`,
        { headers: { referer: `${thislifeOrigin}/` } },
        { timeoutMs: originalDownloadTimeoutMs, signal },
      );

      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new ShutterflyAuthError();
      }

      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new ShutterflyRequestError(
          `Shutterfly original download failed with status ${response.status}`,
          response.status,
        );
      }

      const contentType = response.headers.get("content-type");

      // A JSON body here is an error envelope rather than the file itself.
      if (contentType?.includes("json")) {
        const message = await response.text().catch(() => "");

        if (libraryAuthFailurePattern.test(message)) {
          throw new ShutterflyAuthError();
        }

        throw new ShutterflyRequestError("Shutterfly did not return the original file");
      }

      // The fetch signal also covers the body, so cancelling the archive aborts this stream too.
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        createWriteStream(destinationPath),
      );

      return {
        fileName: readContentDispositionFileName(response.headers.get("content-disposition")),
        contentType,
      };
    },

    /** Lists every order placed since Shutterfly's current order system launched, newest first. */
    listOrders: async (session: ShutterflySession): Promise<unknown[]> => {
      const orders: unknown[] = [];
      let query = new URLSearchParams({
        accountId: `shutterfly.com-${session.accountId}`,
        querySortKeys: "invoicedDate-",
        queryLimit: String(commercePageSize),
        latestStatus: "true",
      }).toString();

      for (let page = 0; page < maxArchiveListPages; page += 1) {
        const body = parseOrThrow(
          shutterflyCommercePageSchema,
          await apiJson(session, `${commerceBaseUrl}/order?${query}`),
          "order list",
        );

        orders.push(...body.resources);

        const nextQuery = body.nextRef?.split("?")[1];

        if (!nextQuery || nextQuery === query || body.resources.length === 0) {
          break;
        }

        query = nextQuery;
      }

      return orders;
    },

    /** Lists orders from Shutterfly's previous order system. */
    listLegacyOrders: async (session: ShutterflySession): Promise<unknown[]> => {
      const orders: unknown[] = [];
      let queryStart = 1;

      for (let page = 0; page < maxArchiveListPages; page += 1) {
        const query = new URLSearchParams({
          accountId: `shutterfly.com-${session.accountId}`,
          querySortKeys: "orderDate-",
          queryLimit: String(commercePageSize),
          queryStart: String(queryStart),
        });
        const body = parseOrThrow(
          shutterflyCommercePageSchema,
          await apiJson(session, `${commerceBaseUrl}/legacy/orders?${query}`),
          "legacy order list",
        );

        orders.push(...body.resources);

        let nextStart = Number.NaN;

        try {
          nextStart = Number(
            new URL(body.nextRef ?? "", commerceBaseUrl).searchParams.get("queryStart"),
          );
        } catch {
          // No next page.
        }

        if (
          !Number.isInteger(nextStart) ||
          nextStart <= queryStart ||
          body.resources.length === 0
        ) {
          break;
        }

        queryStart = nextStart;
      }

      return orders;
    },
  };
};
