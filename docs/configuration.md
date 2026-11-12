# Configuration

Runtime configuration is parsed by `@zakka/config` at process startup. Local defaults are safe for development and can be overridden with environment variables.

| Variable | Default | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | `development` | No | No | One of `development`, `test`, or `production`. |
| `API_HOST` | `127.0.0.1` | No | No | Hostname used by the local API server. |
| `API_PORT` | `4000` | No | No | Port used by the local API server. |
| `WEB_ORIGIN` | `http://localhost:5173` | No | No | Public browser origin for the deployed app. |
| `SESSION_COOKIE_SECURE` | Auto-detected per request | No | No | Whether browser session cookies require HTTPS. By default, HTTPS requests and requests with `X-Forwarded-Proto: https` receive `Secure` cookies; local HTTP requests do not. Override only for unusual proxy setups. |
| `ZAKKA_DATA_DIR` | `./storage/dev`; `/data/zakka` when `NODE_ENV=production` | No | No | Root for local SQLite files, page document JSON files, uploads, variants, previews, exports, and the integration credential key (`secrets/credentials.key`). |
| `SHUTTERFLY_API_KEY` | Unset | No | Yes | Enables the Shutterfly project importer. See [Shutterfly import](#shutterfly-import). |

When `NODE_ENV=development`, the API seeds a development account (`dev@zakka.local` / `zakka-dev-password`) on startup if it is missing. See [Development Workflow](development.md) for details. No account is seeded for `test` or `production`.

The Docker Compose API service overrides `API_HOST` to `0.0.0.0` and `WEB_ORIGIN` to `http://localhost:4000`. The Docker image stores data at `/data/zakka`, which is backed by the `zakka-data` Docker volume so SQLite files, page documents, uploads, variants, previews, and exports persist across container restarts.

Browser sessions use an HTTP-only, host-only cookie and store only a hashed per-session secret in SQLite. Because cookies are host-specific, local IP access and remote domain access use separate browser cookies and may require separate sign-ins. The cookie is marked `Secure` for HTTPS requests, including reverse-proxied requests that set `X-Forwarded-Proto: https`; local Docker deployments opened over plain HTTP receive a non-secure cookie.

When running behind a reverse proxy, configure the proxy to overwrite and pass the original scheme, for example `X-Forwarded-Proto: https` for the remote HTTPS URL. Do not set `SESSION_COOKIE_SECURE=true` if the same container also needs to support plain local HTTP access.

## Shutterfly import

Zakka can import saved Shutterfly photo book projects as Zakka books, including pages, photo placement and crops, text and text backgrounds, solid backgrounds, and stickers. Shutterfly has no public API, so this feature uses the same unofficial endpoints as Shutterfly's web app. It may stop working whenever Shutterfly changes their site. Use it only for your own projects.

To enable it, set `SHUTTERFLY_API_KEY` to the `X-API-Key` value that Shutterfly's web app sends. It is the same 32-character value for every Shutterfly user:

1. Sign in at <https://www.shutterfly.com> in a desktop browser and open the browser developer tools.
2. On the **Network** tab, filter by `projects-api3`, then open **My Projects**.
3. Select any request and copy the `x-api-key` request header value.

Each Zakka user then connects their own Shutterfly account under **Settings > Integrations** by pasting their Shutterfly refresh token. The settings page explains where to find it. Zakka exchanges the refresh token for short-lived access tokens and stores it encrypted with AES-256-GCM. The key is generated on first use at `ZAKKA_DATA_DIR/secrets/credentials.key`. Back up that file with your data directory: if it is lost, users must reconnect. Refresh tokens expire about 30 days after the user last signed in to Shutterfly.

Imported photos are downloaded at the largest size Shutterfly's renderer provides (up to 2600 px on the long edge). Shutterfly's licensed fonts are replaced with the closest bundled Zakka font. Text larger than Zakka's maximum size is reduced to fit, and spine text is skipped because Zakka books have no spine. Each import reports anything it could not bring across.

Future production-only secrets for CSRF, password reset tokens, and native refresh tokens should be added here in the same change that introduces the behavior.