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

Imported photos are downloaded at the largest size Shutterfly's renderer provides (up to 2600 px on the long edge). Empty photo wells, and photos that could not be downloaded, come across as photo placeholders that keep the frame's size, rotation, and shape. Fill one in the editor by dropping a photo onto it or by choosing **Add photo**. Exports leave unfilled placeholders blank. Shutterfly's licensed fonts are replaced with the closest bundled Zakka font. Text larger than Zakka's maximum size is reduced to fit, and spine text is skipped because Zakka books have no spine. Each import reports anything it could not bring across.

## AI assistants (MCP)

Zakka includes a [Model Context Protocol](https://modelcontextprotocol.io) server, so AI assistants such as Claude, ChatGPT, and VS Code can browse a user's photos and books and design pages. It needs no server configuration.

The server uses the Streamable HTTP transport at `/api/v1/mcp` on the same origin as the app, for example `http://localhost:4000/api/v1/mcp` for a local Docker deployment. It runs statelessly and accepts only `POST` requests.

Each user creates a personal access token under **Settings > Integrations**. The full token is shown only once. Zakka stores only a SHA-256 hash of it, and records when it was last used. Clients send the token as a bearer token:

```json
{
  "mcpServers": {
    "zakka": {
      "type": "http",
      "url": "http://localhost:4000/api/v1/mcp",
      "headers": { "Authorization": "Bearer zakka_pat_..." }
    }
  }
}
```

A token can do everything its user can do through these tools, so treat it like a password. Revoke it in **Settings > Integrations** when it is no longer needed.

| Tools | Purpose |
| --- | --- |
| `list_books`, `get_book`, `list_pages`, `get_page` | Read books, pages, spreads, and full page documents. |
| `list_photos`, `get_photo`, `view_photo` | Browse the photo library, read photo details, and view photos as images. |
| `list_albums`, `create_album`, `update_album`, `delete_album`, `add_photos_to_album`, `remove_photos_from_album` | Organize photos into albums. |
| `upload_image` | Add a base64-encoded image to the library, optionally to an album or book. |
| `add_photos_to_book`, `remove_photos_from_book` | Collect library photos for a book, or remove them from it. |
| `search_stickers`, `list_fonts`, `list_backgrounds`, `list_washi_tapes` | Find decorations to use on pages. |
| `list_sticker_packs`, `create_sticker_pack`, `update_sticker_pack`, `delete_sticker_pack`, `upload_sticker`, `view_sticker`, `remove_sticker`, `set_sticker_favorite` | Manage custom sticker packs and favorite stickers. |
| `create_washi_tape`, `update_washi_tape`, `delete_washi_tape` | Manage custom washi tape designs. |
| `upload_background`, `rename_background`, `delete_background` | Manage custom page backgrounds. |
| `render_page` | Render a page to a JPEG so the assistant can check its work. |
| `get_print_warnings` | List photos that will print blurry at their placed size. |
| `export_page`, `export_book`, `get_export` | Export a page or book as PDF, JPEG, or PNG and return the file. |
| `create_book`, `update_book`, `set_book_pages`, `delete_book` | Create, rename, resize, reorder, and delete books, and turn the cover spread on or off. |
| `create_page`, `update_page`, `duplicate_page`, `delete_page` | Create, copy, and delete pages and change their title, background, or whole document. |
| `add_layer`, `update_layer`, `delete_layer` | Add, edit, reorder, and remove photos, text, stickers, washi tape, and maps. Layers that cross the fold of a spread are kept on both pages. |
| `list_page_layouts`, `apply_page_layout`, `arrange_layers`, `auto_enhance_photo` | Apply layouts, align and distribute layers, and auto-enhance photos like the editor does. |
| `get_shutterfly_status`, `list_shutterfly_projects`, `import_shutterfly_project`, `get_shutterfly_import` | Import Shutterfly projects once the account is connected in **Settings > Integrations**. Only available when Shutterfly import is configured. |
| `get_preferences`, `update_preferences`, `get_server_logs`, `get_system_info` | Read and change the UI theme, and read server logs and version details. |

Connecting accounts and managing access tokens are only available in the web app. Deleting pages, books, albums, and custom decorations cannot be undone, and the tools never delete library photos. If a page is open in the browser editor while an assistant edits it, the editor's next autosave may overwrite the assistant's changes. Reload the page to pick them up.

Future production-only secrets for CSRF, password reset tokens, and native refresh tokens should be added here in the same change that introduces the behavior.