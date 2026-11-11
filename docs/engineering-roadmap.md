# Engineering Roadmap

_Last updated: 2026-05-20_

This document is an execution tracker for engineers and future LLM agents. Keep it current as implementation lands so the next useful task is obvious without rediscovering project intent.

Current product reference set: Canva, MyMemories Suite, Shutterfly, and Forever Artisan. Use these as comparison points for scrapbook editing, photo-book ordering, gallery/library behavior, and print-oriented workflows without assuming any single product defines the whole target experience.

## Current Snapshot

| Area | Status | Notes |
| --- | --- | --- |
| Local Git repo | `Done` | Repository exists on `main`. |
| Engineering roadmap | `In progress` | Tracks implementation status as application engineering begins. |
| Application code | `In progress` | Validated monorepo scaffold, starter API, SQLite persistence/storage foundation, file-backed page document storage, email/password auth endpoints, config package, API contract package, domain package, test utilities, authenticated web shell, asset upload/library flow, page document model, page CRUD API, basic editor flow, non-destructive photo editing metadata/controls, scrapbook embellishment layers, ordered book management, and PNG/JPEG exports exist. |
| GitHub remote | `Done` | Changes are being pushed to the GitHub `gh` remote on `main`. |
| CI/CD | `Done` | Pull request validation and release preview workflows are configured. |
| Release automation | `Done` | semantic-release GitHub Releases and GHCR image publishing workflows exist. |

## Status Legend

Use these exact status values:

- `Not started`: no implementation exists yet.
- `Blocked`: cannot proceed until a named dependency or decision is resolved.
- `In progress`: active work exists in the working tree or an active branch.
- `Needs review`: implementation is ready for review or validation.
- `Done`: accepted with validation complete.
- `Deferred`: intentionally postponed.

When task status changes, update its `Status`, `Updated`, and `Notes` fields.

## Operating Rules

- Keep task IDs stable. Add new IDs instead of renumbering old ones.
- Build in order unless the user explicitly redirects the work.
- Prefer small vertical slices that leave the repo usable.
- Use Conventional Commits for commits.
- Keep checked-in package versions at `0.0.0-development`.
- Do not commit generated version bumps or generated changelog files.
- API changes must include schemas, OpenAPI updates, tests, and docs.
- Database changes must include migrations and data-safety notes where practical.
- User-owned data must be scoped by authenticated account.
- Update this file in the same PR as implementation work when practical.

## Recommended Build Order

1. Make the initial technical decisions.
2. Scaffold the repository, tooling, configuration, CI, and release skeleton.
3. Build the API contract, server shell, persistence, and storage.
4. Build accounts and authentication before user-owned product data.
5. Build the authenticated web app shell.
6. Build photo upload and the asset library.
7. Build the page document model and basic editor.
8. Add non-destructive photo editing.
9. Add books and facing spread workflow.
10. Add print and digital exports.
11. Harden the product with tests, accessibility, maintenance, and reliability.
12. Publish through GitHub Releases and GHCR.

## Definition Of Done

A task is `Done` only when applicable validation is complete:

- Code or docs are committed to the agreed branch.
- Formatting, linting, typechecking, and relevant tests pass.
- API behavior is represented in the OpenAPI contract.
- User data ownership and authorization are tested where relevant.
- Configuration and operational docs are updated when behavior changes.
- No secrets, local user data, generated version bumps, or generated changelogs are committed.

## Phase E01: Initial Decisions

Goal: settle enough decisions to scaffold without over-designing.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E01.1 | Choose initial API framework | `Done` | — | `docs/architecture-decisions/0001-initial-application-stack.md` | Hono chosen; decision covers OpenAPI generation, uploads, testing, and Docker runtime. |
| E01.2 | Choose schema and OpenAPI tooling | `Done` | E01.1 | `docs/architecture-decisions/0001-initial-application-stack.md` | Zod and `@hono/zod-openapi` chosen for runtime validation and OpenAPI generation. |
| E01.3 | Choose SQLite query layer | `Done` | — | `docs/architecture-decisions/0001-initial-application-stack.md` | Drizzle chosen; decision covers migrations, type inference, and SQLite test ergonomics. |
| E01.4 | Choose web scaffold/router | `Done` | — | `docs/architecture-decisions/0001-initial-application-stack.md` | Vite, React, and React Router chosen for SPA behavior, Docker serving, and API separation. |
| E01.5 | Choose initial auth sequence | `Done` | — | `docs/architecture-decisions/0001-initial-application-stack.md` | Email/password starts first; passkeys and native token flow are deferred until session foundation exists. |
| E01.6 | Choose editor spike candidates | `Done` | — | `docs/architecture-decisions/0001-initial-application-stack.md` | `tldraw`, Konva, and Fabric.js are initial spike candidates. |
| E01.7 | Add repository operating docs | `Done` | E01.1-E01.6 | `docs/development.md` draft | Branch, commit, validation, and roadmap-update rules are documented. |

Next task: `E06.4`.

Suggested commits:

```text
docs: record initial stack decisions
docs: add repository operating rules
```

## Phase E02: Repository Foundation

Goal: create a healthy monorepo shell with repeatable validation.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E02.1 | Initialize pnpm workspace | `Done` | E01 | `package.json`, `pnpm-workspace.yaml`, app/package folders | `pnpm install` succeeds; root version is `0.0.0-development`. |
| E02.2 | Add ignore and data-safety defaults | `Done` | E02.1 | `.gitignore` | Dependencies, builds, `.env`, SQLite files, uploads, and generated assets are ignored. |
| E02.3 | Add TypeScript baseline | `Done` | E02.1 | Shared tsconfig setup | Workspace typecheck passes. |
| E02.4 | Add formatting and linting | `Done` | E02.1 | Biome config | `pnpm format:check` and `pnpm lint` pass. |
| E02.5 | Add test harness | `Done` | E02.1 | Vitest workspace and initial tests | `pnpm test` passes with initial tests. |
| E02.6 | Add root task orchestration | `Done` | E02.3-E02.5 | Turborepo tasks and package scripts | Root `build`, `typecheck`, `lint`, and `test` scripts pass. |
| E02.7 | Add developer documentation | `Done` | E02.6 | `docs/development.md` | Fresh-clone setup and common commands are documented and validated. |

Suggested commits:

```text
chore(repo): initialize workspace
chore(repo): add shared validation tooling
docs: add development workflow
```

## Phase E03: Configuration, Docker Shell, And GitHub CI

Goal: define runtime configuration early and make validation automatic.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E03.1 | Add typed runtime config | `Done` | E02.3 | `packages/config` | Runtime config validates local API host, port, web origin, and data directory; production secrets are deferred. |
| E03.2 | Add environment examples | `Done` | E03.1 | `.env.example` | Supported initial variables have safe placeholders. |
| E03.3 | Document configuration | `Done` | E03.2 | `docs/configuration.md` | Variables include default, required status, and secret status. |
| E03.4 | Define local data layout | `Done` | E03.1 | `ZAKKA_DATA_DIR` convention | SQLite, uploads, variants, previews, and exports will root under the configured data directory. |
| E03.5 | Add local Docker shell | `Done` | E02.6, E03.1 | `Dockerfile`, `docker-compose.yml` | API container exposes port 4000 and mounts persistent application data at `/data/zakka`. |
| E03.6 | Add initial GitHub CI | `Done` | E02.6 | `.github/workflows/ci.yml` | Pull requests run install, format, lint, typecheck, tests, and build. |
| E03.7 | Configure semantic-release skeleton | `Done` | E03.6 | `.releaserc.json`, release preview workflow | Release preview calculates releases without changing checked-in versions, publishing, or tagging. |

Suggested commits:

```text
feat(config): add runtime configuration validation
build: add local container workflow
ci: add pull request validation workflow
chore(release): configure semantic-release
```

## Phase E04: API Contract And Server Backbone

Goal: establish the documented API boundary before feature routes expand.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E04.1 | Create API app shell | `Done` | E01.1, E03.1 | `apps/api` server entrypoint | API server entrypoint uses typed config and graceful shutdown and passes build validation. |
| E04.2 | Add request infrastructure | `In progress` | E04.1 | Request IDs and basic error boundary | Unexpected errors use the standard error envelope and request IDs are returned; structured request logging is still pending. |
| E04.3 | Add API contract package | `Done` | E01.2, E04.1 | `packages/api-contract` | Initial schemas can be shared by server and client tooling. |
| E04.4 | Add health endpoint | `Done` | E04.1, E04.3 | `GET /api/v1/health` | Health route reports readiness without leaking secrets and has integration coverage. |
| E04.5 | Generate OpenAPI document | `Done` | E04.3, E04.4 | Runtime OpenAPI 3.1 output | `/api/v1/openapi.json` is available and `pnpm --filter @zakka/api openapi:check` passes. |
| E04.6 | Add API integration tests | `Done` | E04.4 | Initial app tests | Tests use in-memory Hono requests and no persistent state. |
| E04.7 | Add API contract workflow | `Not started` | E04.5 | `api-contract.yml` or CI job | Route/schema drift fails CI. |

Suggested commits:

```text
feat(api): add server shell
feat(api): add health endpoint
feat(api): add openapi generation
test(api): add integration harness
```

## Phase E05: Persistence And Disk Storage

Goal: make durable account-owned data possible with SQLite and safe local file storage.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E05.1 | Add SQLite and migrations | `Done` | E01.3, E04.6 | Migration tooling and initial schema | Migrations apply from an empty database in tests; API startup and `db:migrate` run them. |
| E05.2 | Add core schema | `Done` | E05.1 | Accounts, auth identities, sessions, assets, variants, pages, books, exports | Tables use opaque IDs, timestamps, indexes, constraints, and ownership relationships. |
| E05.3 | Add repository layer | `Done` | E05.2 | Typed repositories | Repository classes wrap table access for accounts, auth identities, sessions, assets, pages, books, and exports. |
| E05.4 | Test account isolation | `Done` | E05.3 | Repository/API tests | Repository tests reject cross-account asset variants, book pages, and exports. |
| E05.5 | Add disk storage adapter | `Done` | E03.4 | Storage module rooted at configured directory | Storage keys are generated as opaque relative paths and traversal/absolute keys are rejected. |
| E05.6 | Add local data docs | `Done` | E05.1, E05.5 | `docs/local-data.md` | Backup, restore, migration, layout, and cleanup basics are documented. |

Suggested commits:

```text
feat(db): add sqlite migration backbone
feat(db): add repository layer
feat(assets): add disk storage adapter
```

## Phase E06: Accounts And Authentication

Goal: ship real accounts before product data so all later features are account-scoped.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E06.1 | Add account registration | `Done` | E05.3 | `POST /api/v1/auth/register` | Account can be created; password hashes use Node scrypt. |
| E06.2 | Add login and web session | `Done` | E06.1 | `POST /api/v1/auth/login` | HTTP-only browser session cookie is issued and stored session secret is hashed. |
| E06.3 | Add current session and logout | `Done` | E06.2 | `GET /api/v1/auth/session`, `POST /api/v1/auth/logout` | User can identify and terminate the current session. |
| E06.4 | Add CSRF protection | `Not started` | E06.2 | CSRF mechanism for cookie-auth writes | Mutating requests reject missing or invalid CSRF tokens. |
| E06.5 | Add session list and revocation | `Not started` | E06.3 | Session listing and delete endpoints | Users can revoke other sessions. |
| E06.6 | Add native token foundation | `Not started` | E06.3 | PKCE/token design and refresh endpoint | Refresh tokens rotate and reuse can revoke a token family. |
| E06.7 | Add auth rate limits and audit events | `Not started` | E06.1-E06.5 | Rate limit and audit hooks | Registration, login, reset, and refresh paths are protected. |
| E06.8 | Add passkey support | `Deferred` | E06.3 | WebAuthn endpoints | User can enroll and authenticate with passkeys when promoted from deferred. |

Suggested commits:

```text
feat(auth): add account registration
feat(auth): add session login and logout
feat(auth): add session revocation
```

## Phase E07: Web App Shell

Goal: create authenticated browser navigation before asset and editor workflows.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E07.1 | Create web app scaffold | `Done` | E01.4, E02.6 | `apps/web` React app | Web app shell builds locally. |
| E07.2 | Add API client layer | `Done` | E04.5, E07.1 | Typed fetch client | Client calls use the documented API contract and parse shared schemas. |
| E07.3 | Add base UI system | `Done` | E07.1 | Layout, tokens, common states | Controls are accessible and consistent. |
| E07.4 | Add auth UI | `Done` | E06.3, E07.2 | Register, login, logout, session loading | User can sign in and out through the browser. |
| E07.5 | Add protected app shell | `Done` | E07.4 | Routes for library, pages, books, settings | Protected routes require authentication. |

Suggested commits:

```text
feat(web): add application shell
feat(web): add authentication flow
```

## Phase E08: Photo Uploads And Asset Library

Goal: authenticated users can upload photos, preserve originals, and browse their library.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E08.1 | Add asset API schemas | `Done` | E04.5, E05.2 | Asset DTOs and route schemas | Asset API ownership is documented in `docs/local-data.md`. |
| E08.2 | Add upload endpoint | `Done` | E08.1, E05.5, E06.3 | `POST /api/v1/assets/uploads` | JPEG, PNG, WebP, and HEIC uploads succeed; invalid files and oversized images return documented errors. |
| E08.3 | Add metadata extraction | `Done` | E08.2 | Sharp-backed metadata pipeline | Width, height, MIME, size, and checksum are stored. |
| E08.4 | Add thumbnail generation | `Done` | E08.3 | Asset variant files and records | Thumbnail derivatives are generated without mutating originals. |
| E08.5 | Add asset list/detail/content routes | `Done` | E08.4 | Library and streaming endpoints | Users can only access their own assets. |
| E08.6 | Add upload UI | `Done` | E07.5, E08.2 | Upload flow with progress and errors | User can upload an image from the web app. |
| E08.7 | Add asset library UI | `Done` | E08.5, E08.6 | Library grid/list | User sees thumbnails and metadata. |
| E08.8 | Add multi-photo upload flow | `Not started` | E08.2, E08.6 | Batch upload API/client handling and multi-file picker UI | User can select multiple supported photos, see per-file progress/errors, and keep successful uploads when some files fail. Updated 2026-05-17. |

Suggested commits:

```text
feat(assets): add photo upload api
feat(web): add asset library
```

## Phase E09: Page Document Model And Basic Editor

Goal: users can create, edit, save, and reopen scrapbook pages.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E09.1 | Run editor engine spike | `Done` | E01.6, E07.1 | Decision comparing canvas engines | ADR 0002 compares tldraw, Konva, Fabric.js, and the DOM/CSS shell used for E09. |
| E09.2 | Add page document schema | `Done` | E09.1 | Versioned page JSON schema | Supports canvas settings, ordered layers, photo layers, text layers, and transforms. |
| E09.3 | Add editor-core package | `Done` | E09.2 | Pure document helpers | Add/update/delete/reorder operations have unit tests. |
| E09.4 | Add page CRUD API | `Done` | E09.2, E05.3, E06.3 | Page create/list/detail/patch/duplicate/delete routes | Page writes validate and are account-scoped, including photo layer asset ownership. |
| E09.5 | Add editor route shell | `Done` | E07.5, E09.3, E09.4 | Toolbar, canvas, asset rail, inspector, layer list | Editor opens a page and displays its document. |
| E09.6 | Add photo and text layers | `Done` | E08.7, E09.5 | Insert/edit photo and text elements | User can compose a simple page. |
| E09.7 | Add layer manipulation | `Done` | E09.6 | Select, move, resize, rotate, reorder, duplicate, delete | Saved page reopens with the same layout. |
| E09.8 | Add save state | `Done` | E09.7 | Manual save or autosave flow | UI clearly shows unsaved, saving, saved, and error states. |
| E09.9 | Add placed photo replacement | `Not started` | E08.7, E09.6, E10.1 | Replace-photo action from the asset library or inspector | User can swap a photo layer's asset while preserving bounds, frame styling, opacity, crop intent, and layer order where practical. Updated 2026-05-17. |

Suggested commits:

```text
feat(editor): add page document model
feat(api): add page crud endpoints
feat(web): add basic page editor
```

## Phase E10: Non-Destructive Photo Editing And Scrapbook Elements

Goal: add crop, transform, border, frame, mask/cutout, scrapbook embellishment, and visual effects without changing originals.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E10.1 | Add photo edit metadata | `Done` | E09.2 | Transform, crop, mask/cutout, border, shadow, opacity, filter schema | Transform metadata is separate from crop and mask metadata. |
| E10.2 | Add transform controls | `Done` | E10.1, E09.7 | Scale, rotate, flip, offset/reposition controls | User can transform a photo inside its frame. |
| E10.3 | Add crop controls | `Done` | E10.1, E09.7 | Free crop and aspect ratio presets | Crop is editable after save/reopen. |
| E10.4 | Add border/frame controls | `Done` | E10.1, E09.7 | Border width, color, radius, style, shadow, frame presets | Styling persists in page JSON and photos are not limited to square frames. |
| E10.5 | Add preview generation | `Done` | E10.1-E10.4 | Browser editor preview path | Previews reflect edit metadata and can be regenerated from saved page JSON. |
| E10.6 | Add non-destructive tests | `Done` | E10.5 | API/editor tests | Original assets remain unchanged; reset returns to original view. |
| E10.7 | Add mask and cutout controls | `Done` | E10.1, E10.3 | Shape masks, reusable cutout presets, and clipping controls | User can cut a photo into a non-rectangular shape without mutating the original. |
| E10.8 | Add embellishment element library | `Done` | E09.2, E09.7 | Sticker, embellishment, decorative frame, and patterned-paper elements | User can place playful scrapbook elements, not only modern photo/text layouts. |
| E10.9 | Refine photo opacity and crop UX | `Not started` | E10.1-E10.5 | Inspector controls for opacity, crop size, crop shape, and in-frame pan/zoom | User can adjust opacity, crop dimensions, frame shape, and photo position inside the visible frame; save/reopen/export preserve the result. Updated 2026-05-17. |

Suggested commits:

```text
feat(editor): add photo transform controls
feat(editor): add non destructive crop controls
feat(editor): add scrapbook masks and embellishments
feat(api): add page preview generation
```

## Phase E11: Books

Goal: organize pages into ordered scrapbook books and facing two-page spreads.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E11.1 | Add book API schemas | `Done` | E04.5, E05.2 | Book and book-page DTOs | Ordering and facing-spread behavior are documented. Updated 2026-05-17. |
| E11.2 | Add book CRUD API | `Done` | E11.1, E09.4 | Book create/list/detail/patch routes | Books are account-scoped. Updated 2026-05-17. |
| E11.3 | Add book page ordering API | `Done` | E11.2 | Replace ordered page endpoint | Page and spread order persists and cross-account pages are rejected. Updated 2026-05-17. |
| E11.4 | Add book list/detail UI | `Done` | E07.5, E11.2 | Book management screens | User can create and open books. Updated 2026-05-17. |
| E11.5 | Add page ordering UI | `Done` | E11.3, E11.4 | Add/remove/reorder interactions | User can add existing pages and reorder them. Updated 2026-05-17. |
| E11.6 | Add spread-aware book helpers | `Done` | E11.3 | Helpers for adjacent page pairs, single-page cases, and page-order navigation | Book order computes correct left/right page pairs without changing page IDs or injecting cover/end pages. Updated 2026-05-17. |
| E11.7 | Add two-page spread editor | `Done` | E09.8, E11.5, E11.6 | Facing-spread management view with page editor navigation | User can design adjacent pages in proper book order by opening either page from spread-aware context. Updated 2026-05-17. |
| E11.8 | Add page and book date metadata | `Not started` | E09.4, E11.2 | Exact-date/date-range schemas, persistence, API fields, and UI controls | User can set dates or date ranges on pages and books; values round-trip through API, editor/book views, and export metadata where applicable. Updated 2026-05-17. |

Suggested commits:

```text
feat(api): add book management endpoints
feat(web): add book management views
feat(editor): add two page spread editing
```

## Phase E12: Exports And Product Hardening

Goal: generate print-ready and digital user-visible output and make the core journey reliable.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E12.1 | Decide export rendering strategy | `Done` | E10.5, E11.7 | `docs/architecture-decisions/0003-export-rendering-strategy.md` | Decision covers PNG/JPEG/PDF feasibility, render parity, and spread-aware book output. Updated 2026-05-17. |
| E12.2 | Add export job model | `Done` | E12.1, E05.2 | Export job table and routes | Jobs track status, format, output path, preset, and errors. Updated 2026-05-17. |
| E12.3 | Add page image export | `Done` | E12.2 | Single-page PNG/JPEG export | Export reflects saved page state. Updated 2026-05-17. |
| E12.4 | Add book export | `Done` | E12.3, E11.7 | Ordered book image export | Book exports in page and spread order. Updated 2026-05-17. |
| E12.5 | Add export UI | `Done` | E12.3, E12.4 | Export actions and completed-output links | User can request and retrieve exports. Updated 2026-05-17. |
| E12.6 | Add core E2E flow | `Done` | E08.7, E09.8, E11.7 | API happy-path integration coverage | Register/login, edit page, create book, and export are covered at the API layer. Updated 2026-05-17. |
| E12.7 | Add editor polish | `Done` | E09.7, E10.4 | Save/export ergonomics and spread-aware navigation | Common editing/export operations are predictable for the current editor. Updated 2026-05-17. |
| E12.8 | Add data maintenance tools | `Done` | E08.4, E12.2 | Storage layout and export records | Export outputs are tracked by storage key and included in backup/cleanup docs. Updated 2026-05-17. |
| E12.9 | Add print and digital export presets | `Done` | E12.4, E12.5 | Print and digital PNG/JPEG presets | User can choose output suitable for printing or digital sharing through the API; UI defaults to print PNG. Updated 2026-05-17. |

Suggested commits:

```text
feat(exports): add export jobs
feat(exports): add page image export
feat(exports): add print and digital presets
test: add core scrapbook flow coverage
feat(editor): improve editing ergonomics
```

## Phase E13: GitHub Release And Container Publishing

Goal: publish and operate the app from GitHub as a Dockerized product.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E13.1 | Add production Dockerfile | `Done` | E04.1, E07.1 | Multi-stage Dockerfile | Image builds web/API assets and runs as non-root. Updated 2026-05-17. |
| E13.2 | Add container smoke test | `Done` | E13.1, E04.4 | Health-check script/workflow step | Built image starts and `/api/v1/health` reports healthy. Updated 2026-05-17. |
| E13.3 | Add container workflow | `Done` | E13.2 | `.github/workflows/container.yml` | PRs build and smoke-test the image without publishing. Updated 2026-05-17. |
| E13.4 | Publish GitHub Releases | `Done` | E03.7 | `release.yml` GitHub release integration | semantic-release creates GitHub Release notes. Updated 2026-05-17. |
| E13.5 | Publish GHCR images | `Done` | E13.3, E13.4 | GHCR publishing with latest, main, and SHA tags | Protected-branch releases publish images without version/changelog commits. Updated 2026-05-17. |
| E13.6 | Add supply-chain metadata | `Done` | E13.5 | SBOM, provenance, and GitHub artifact attestation | Published artifacts include current GitHub-supported metadata. Updated 2026-05-17. |
| E13.7 | Document deployment operations | `Done` | E13.5 | `docs/deployment.md` | Operators can configure, start, upgrade, back up, and restore the container. Updated 2026-05-17. |

Suggested commits:

```text
build: add production docker image
ci: add container build workflow
ci(release): publish github releases and ghcr images
docs: document container deployment
```

## Phase E14: Gallery Mode And Metadata

Goal: make uploaded photos easier to browse, tag, filter, sort, and reuse in scrapbook workflows.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E14.1 | Add asset tag metadata | `Not started` | E08.5 | Tag schema, persistence, API fields, and validation | Users can assign, remove, and list tags on their own assets; cross-account tags are isolated. Updated 2026-05-17. |
| E14.2 | Add captured-date metadata | `Not started` | E08.3 | Captured-date field from image metadata plus manual override | Gallery and asset detail surfaces can distinguish upload date from captured date. Updated 2026-05-17. |
| E14.3 | Add Gallery Mode view | `Not started` | E14.1, E14.2 | Dedicated gallery browsing surface for uploaded photos | User can browse the photo pool outside a specific page editor and select photos for use. Updated 2026-05-17. |
| E14.4 | Add gallery filters and sorts | `Not started` | E14.3 | Tag filters and sort controls | User can filter to one or more tags and sort by upload date, captured date, title, or manual order. Updated 2026-05-17. |
| E14.5 | Review reference product gaps | `Not started` | E14.3, E10.9, E11.8 | Comparison notes against Canva, MyMemories Suite, Shutterfly, and Forever Artisan | The roadmap captures any high-value gaps found in scrapbook editing, photo replacement, gallery browsing, book dates, and export workflows. Updated 2026-05-17. |

Suggested commits:

```text
feat(assets): add photo gallery metadata
feat(web): add gallery mode filters
docs(product): compare scrapbook reference tools
```

## Phase E15: Imports From Other Services

Goal: let users bring existing projects from other photo book services into Zakka.

| ID | Task | Status | Depends on | Deliverable | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E15.1 | Import Shutterfly photo books | `Needs review` | E11.3, E11.7 | Paste-token Shutterfly connection, encrypted credential storage, project list, and project-to-book import | A connected user can import a saved Shutterfly photo book as a Zakka book with page order, layflat spreads, photo crops, text, solid backgrounds, and stickers; unsupported elements are reported. Uses unofficial Shutterfly endpoints; see `docs/configuration.md`. Updated 2026-11-10. |

## Validation Matrix

Keep this table current as scripts are added.

| Command | Status | Purpose |
| --- | --- | --- |
| `pnpm install` | `Not started` | Install workspace dependencies. |
| `pnpm format:check` | `Done` | Verify formatting. |
| `pnpm lint` | `Done` | Run static checks. |
| `pnpm typecheck` | `Done` | Typecheck all apps/packages. |
| `pnpm test` | `Done` | Run unit and integration tests. |
| `pnpm build` | `Done` | Build all apps/packages. |
| `pnpm openapi:check` | `Done` | Validate OpenAPI output. |
| `pnpm e2e` | `Done` | Run Playwright user journeys against a real API with an isolated data directory. Updated 2026-11-10. |
| `docker build .` | `Blocked` | Build production container image; local Docker CLI was unavailable in this environment, and `.github/workflows/container.yml` performs the build/smoke test in CI. |
| `docker compose up` | `Not started` | Start local containerized app with persistent volumes. |

## Handoff Notes For Future LLM Sessions

- Start by reading this file.
- Run `git status --short` before editing.
- Pick the earliest `Not started` task whose dependencies are complete unless the user asks otherwise.
- If implementation has started, inspect the relevant package before assuming structure.
- Update this roadmap when a task materially changes state.
- Run the validation commands that exist at that point in the project.
- Mention any validation that could not run because the tooling has not been created yet.

## Current Next Actions

1. `E06.4`: Add CSRF protection for cookie-authenticated writes.
2. `E06.5`: Add session list and revocation endpoints.
3. `E06.4`: Add CSRF protection for cookie-authenticated writes.
