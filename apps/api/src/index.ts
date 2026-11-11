import { serve } from "@hono/node-server";
import { loadConfig } from "@zakka/config";

import { createApp } from "./app.js";
import {
  developmentAccountEmail,
  developmentAccountPassword,
  ensureDevelopmentAccount,
} from "./dev-account.js";
import { loadOrCreateCredentialCipher } from "./integrations/credential-cipher.js";
import { createShutterflyIntegration } from "./integrations/shutterfly/service.js";
import { createDatabaseConnection } from "./persistence/database.js";
import { createPageDocumentStore } from "./persistence/page-documents.js";
import { createRepositories } from "./persistence/repositories.js";
import { createDiskStorage } from "./storage/disk.js";

const config = loadConfig();
const databaseConnection = createDatabaseConnection({
  dataDir: config.ZAKKA_DATA_DIR,
  migrate: true,
});
const storage = createDiskStorage({ rootDir: config.ZAKKA_DATA_DIR });
const pageDocuments = createPageDocumentStore({ rootDir: config.ZAKKA_DATA_DIR });
await storage.ensureReady();

const repositories = createRepositories(databaseConnection.db, { pageDocuments });

if (config.NODE_ENV === "development") {
  await ensureDevelopmentAccount(repositories);
  console.log(
    `Development sign-in available: ${developmentAccountEmail} / ${developmentAccountPassword}`,
  );
}

const shutterfly = config.SHUTTERFLY_API_KEY
  ? createShutterflyIntegration({
      apiKey: config.SHUTTERFLY_API_KEY,
      cipher: await loadOrCreateCredentialCipher(config.ZAKKA_DATA_DIR),
      repositories,
      storage,
    })
  : undefined;

const staticAssetsDir = process.env.WEB_ASSETS_DIR;
const app = createApp({
  repositories,
  ...(shutterfly ? { shutterfly } : {}),
  ...(config.SESSION_COOKIE_SECURE === undefined
    ? {}
    : { sessionCookieSecure: config.SESSION_COOKIE_SECURE }),
  ...(staticAssetsDir ? { staticAssetsDir } : {}),
  storage,
});

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.API_HOST,
    port: config.API_PORT,
  },
  (info) => {
    console.log(`Zakka API listening on http://${info.address}:${info.port}`);
  },
);

const shutdown = (signal: NodeJS.Signals) => {
  console.log(`Received ${signal}; shutting down API server`);
  server.close(() => {
    databaseConnection.close();
    process.exit(0);
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
