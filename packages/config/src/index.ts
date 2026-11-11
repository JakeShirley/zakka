import { resolve } from "node:path";

import { z } from "zod";

const defaultDataDirForEnvironment = (nodeEnv: "development" | "test" | "production") =>
  nodeEnv === "production" ? "/data/zakka" : "./storage/dev";

const booleanEnvironmentSchema = z.enum(["true", "false"]).transform((value) => value === "true");

const runtimeConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    SESSION_COOKIE_SECURE: booleanEnvironmentSchema.optional(),
    ZAKKA_DATA_DIR: z.string().min(1).optional(),
    SHUTTERFLY_API_KEY: z.string().trim().min(1).optional(),
  })
  .transform((config) => ({
    ...config,
    ZAKKA_DATA_DIR: resolve(config.ZAKKA_DATA_DIR ?? defaultDataDirForEnvironment(config.NODE_ENV)),
  }));

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): RuntimeConfig =>
  runtimeConfigSchema.parse(environment);
