import { createRoute, z } from "@hono/zod-openapi";

import { errorResponseSchema } from "./shared.js";

export const uiThemeIds = ["light", "dark", "sakura"] as const;
export const uiThemePreferences = ["system", ...uiThemeIds] as const;
export const defaultUiThemePreference = "system";

export type UiThemeId = (typeof uiThemeIds)[number];
export type UiThemePreference = (typeof uiThemePreferences)[number];

export const isUiThemePreference = (value: unknown): value is UiThemePreference =>
  typeof value === "string" && (uiThemePreferences as readonly string[]).includes(value);

const uiThemePreferenceSchema = z.enum(uiThemePreferences).openapi({
  description: 'App UI theme. "system" follows the device light/dark setting.',
  example: "system",
});

export const accountPreferencesResponseSchema = z
  .object({
    uiTheme: uiThemePreferenceSchema,
  })
  .openapi("AccountPreferencesResponse");

export const accountPreferencesPatchRequestSchema = z
  .object({
    uiTheme: uiThemePreferenceSchema.optional(),
  })
  .openapi("AccountPreferencesPatchRequest");

export type AccountPreferencesResponse = z.infer<typeof accountPreferencesResponseSchema>;
export type AccountPreferencesPatchRequest = z.infer<typeof accountPreferencesPatchRequestSchema>;

const errorContent = {
  content: {
    "application/json": {
      schema: errorResponseSchema,
    },
  },
};

const preferencesResponses = {
  400: { description: "Request validation failed.", ...errorContent },
  401: { description: "Authentication is required.", ...errorContent },
  500: { description: "Standard error envelope.", ...errorContent },
};

export const accountPreferencesRoute = createRoute({
  method: "get",
  path: "/api/v1/account/preferences",
  tags: ["Account"],
  responses: {
    200: {
      description: "Returns the current account's app preferences.",
      content: {
        "application/json": {
          schema: accountPreferencesResponseSchema,
        },
      },
    },
    ...preferencesResponses,
  },
});

export const accountPreferencesPatchRoute = createRoute({
  method: "patch",
  path: "/api/v1/account/preferences",
  tags: ["Account"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: accountPreferencesPatchRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updates the current account's app preferences.",
      content: {
        "application/json": {
          schema: accountPreferencesResponseSchema,
        },
      },
    },
    ...preferencesResponses,
  },
});
