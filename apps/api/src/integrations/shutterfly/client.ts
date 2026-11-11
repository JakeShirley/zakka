import {
  type ShutterflyDesignAsset,
  type ShutterflyProject,
  type ShutterflyProjectSummary,
  shutterflyDesignAssetListSchema,
  shutterflyIdTokenClaimsSchema,
  shutterflyMediaDetailsSchema,
  shutterflyProjectListSchema,
  shutterflyProjectSchema,
  shutterflyTokenListSchema,
} from "./schemas.js";

/** Public Cognito app client id used by shutterfly.com; it appears in every signed-in user's cookie names. */
const cognitoClientId = "t8oiif52mece6bleeas2pof0n";
const tokensUrl = "https://accounts.shutterfly.com/sso/v2/tokens";
const projectsBaseUrl = "https://projects-api3.shutterfly.com/projects/v2/project";
const designAssetsUrl =
  "https://catalog-api3.shutterfly.com/catalogdesign/v1/design-asset-by-ids?context=/sfly/shutterfly/shutterfly-us/default&channel=web";
const designFileBaseUrl = "https://sfly3-catalog-design.sf-cdn.com";
const projectPageSize = 25;
const maxProjectPages = 20;
const mediaBatchSize = 50;
const designAssetBatchSize = 100;
const maxDownloadBytes = 40 * 1024 * 1024;
const requestTimeoutMs = 30_000;
const allowedDownloadHostSuffixes = [".shutterfly.com", ".sf-cdn.com"];

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
  refreshToken: string;
};

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

  const send = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch (error) {
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
  };
};
