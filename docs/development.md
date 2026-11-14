# Development Workflow

## Requirements

- Node.js 24 or newer.
- Corepack enabled so the repository can use the pinned pnpm version from `package.json`.

## Setup

```sh
corepack enable pnpm
pnpm install
```

Copy `.env.example` to `.env` if local settings need to differ from the defaults.

## Common Commands

```sh
pnpm dev
pnpm dev:api
pnpm dev:web
pnpm --filter @zakka/api db:migrate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
pnpm build
pnpm screenshots
pnpm release:preview
```

The API health endpoint is available at `http://127.0.0.1:4000/api/v1/health` when the API dev server is running. The web client runs at `http://127.0.0.1:5173`.

The API applies SQLite migrations on startup. To apply migrations without starting the server, run `pnpm --filter @zakka/api db:migrate`.

## Testing

`pnpm test` runs every package's Vitest suite. The web app has two Vitest projects (`apps/web/vitest.config.ts`):

| Project | Files | Runs in | Use it for |
| --- | --- | --- | --- |
| `unit` | `src/**/*.test.ts` | Node | Pure logic such as transforms, page ordering, and spread layers. |
| `browser` | `src/**/*.browser.test.tsx` | Headless Chromium (Vitest Browser Mode) | How users interact with components: real pointer drags, clicks with modifiers, keyboard shortcuts, focus, and `contentEditable` behavior. |

Browser tests need Playwright's Chromium once per machine:

```sh
pnpm --filter @zakka/web exec playwright install chromium
```

Run one project while iterating:

```sh
pnpm --filter @zakka/web exec vitest --project browser
```

Canvas interaction tests mount `PageCanvas` through `src/test/canvasHarness.tsx`, which mirrors the editor's selection and layer-command wiring and exposes the resulting page document. Use `dragOnCanvas` from `src/test/gestures.ts` for drags; it drives Playwright's real mouse, and distances are fractions of the canvas, so `{ x: 0.1, y: 0 }` moves 10% of the page width. Assert on the page document the interaction produces rather than on pixels.

When you fix an editor interaction bug, add a browser test named after the behavior and the issue, for example `cropping from an edge keeps the image anchored on the page (#57)`.

### End-to-end tests

`pnpm e2e` runs Playwright user journeys in `apps/web/e2e/` against the real API and web app. It builds the shared packages, then starts the API on port 4310 with `NODE_ENV=test` and a fresh temporary `ZAKKA_DATA_DIR`, and Vite on port 5310 proxying to it, so it never touches your development data or servers. Every test registers its own account, so tests are isolated and run in parallel.

Use end-to-end tests for behavior that spans the API and the whole editor: persistence after reload, autosave, undo and redo, keyboard shortcuts, page ordering, uploads, and exports. Use `page.request` helpers in `e2e/fixtures.ts` to set up data quickly and to assert what was saved.

```sh
pnpm e2e
pnpm --filter @zakka/web e2e -g "autosaves"   # after a first full run has built the packages
```

## Development Credentials

When the API starts with `NODE_ENV=development`, it seeds a local account if one does not already exist:

| Field | Value |
| --- | --- |
| Email | `dev@zakka.local` |
| Password | `zakka-dev-password` |

Sign in with those credentials at `http://127.0.0.1:5173`. The account lives in the local SQLite database under `ZAKKA_DATA_DIR` (`./storage/dev` by default), so deleting that directory removes it and the next dev server start recreates it. Registration still works if a different account is preferred.

The seed never runs when `NODE_ENV` is `test` or `production`, including the Docker Compose service, so deployed instances have no default login.

## App Screenshots

Generate documentation and PR review screenshots with:

```sh
pnpm screenshots
```

The screenshot runner starts the Vite web app, mocks the API with representative fixture data, and writes desktop and mobile PNGs for each top-level feature to `docs/screenshots/`.

Screenshots are for visual review only. Scenarios stage a screen and wait until it is ready; they do not assert behavior, and they tolerate affordances missing at the merge base. Put interaction checks in browser tests and API-backed flows in end-to-end tests (see [Testing](#testing)).

Screenshot PNGs are generated artifacts and are intentionally ignored by Git. To write them somewhere else, set `ZAKKA_SCREENSHOT_DIR`:

```sh
ZAKKA_SCREENSHOT_DIR=/tmp/zakka-screenshots pnpm screenshots
```

Pull requests run the App Visual Diffs workflow. It renders screenshots for the merge base and the pull request head, compares the PNGs, uploads the comparison artifact, and updates a pull request comment with Before, After, and Diff images when visual changes are detected.

## Editor Fonts

Editor font families mirror the Shutterfly photo book editor font list. Shutterfly's font files are commercially licensed, so each family in `packages/editor-core/src/google-fonts.ts` renders with an open-source Google Fonts exact match, near revival, or substitute (`matchKind`). The vendored files in `packages/editor-core/vendor/fonts/google-fonts/` are WOFF files subset to the Latin, Latin Extended, Vietnamese, Cyrillic, and Greek ranges that each family supports. They are inlined into the editor-core bundle at build time, so the web canvas and server exports render identical glyph paths. CJK and other scripts are not bundled; those characters render as the font's missing-glyph shape.

After adding or changing an entry's `googleFamily`, `googleWeight`, or `googleStyle`, download and subset the referenced files and their licenses:

```sh
python3 -m pip install fonttools
python3 packages/editor-core/scripts/vendor-google-fonts.py
```

The script also stores each family's license in `vendor/fonts/google-fonts/licenses/` and fails when an entry's `license` field does not match the downloaded license. The editor-core build combines those licenses into `dist/font-licenses.txt` (exported as `@zakka/editor-core/font-licenses.txt`), and the web build ships it as `font-licenses.txt` next to the bundle that inlines the fonts.

The script drops `ccmp`, `liga`, or `rlig` from a font when those features contain lookups opentype.js cannot run, because opentype.js would otherwise throw while laying out text.

## Docker

Run the local API container with persistent application data:

```sh
docker compose up --build
```

The Compose service exposes the web app and API on `http://127.0.0.1:4000` and mounts the `zakka-data` Docker volume at `/data/zakka` inside the container. That path holds SQLite files, page document JSON files, uploads, variants, previews, and exports.

See [Local Data](local-data.md) for backup, restore, and cleanup notes for the SQLite database and managed disk storage directories.

## Release Previews

Release automation uses semantic-release with package manifests left at `0.0.0-development`. The local and GitHub Actions preview command calculates the next release from Conventional Commits without publishing, tagging, generating changelogs, or changing checked-in package versions.

## Repository Rules

- Keep package versions checked in as `0.0.0-development`.
- Use Conventional Commits for commit messages and pull request titles.
- Update `docs/engineering-roadmap.md` when task status changes.
- Keep secrets and runtime data out of Git.
- Add schemas, OpenAPI coverage, and tests with API behavior changes.
- Add migrations and data-safety notes with database behavior changes.