# Copilot Agent Instructions

## Priority Rules (MUST)

- Validate every user-facing change in a local browser before considering work complete.
- In the final response, state what browser validation was performed. If browser validation is not possible, explain why and provide fallback verification.
- Before opening a pull request, run: `pnpm format:check`, `pnpm -w run typecheck`, `pnpm -w run lint`, and `pnpm -w run test`.
- `pnpm format:check` is a CI gate. If formatting drifts, run `pnpm -w run format`.
- If any UI or screenshot fixture changes, also run `pnpm screenshots`.

## Screenshot and Visual Diff Rules

The `App Visual Diffs` workflow (`.github/workflows/app-visual-diffs.yml`) runs `apps/web/screenshots/app-screenshots.spec.ts` against both the HEAD workspace and a merge-base worktree. New or modified scenarios must pass in both environments.

- In `waitFor`, assert only elements that exist in both merge-base and HEAD for existing pages.
- Put feature-specific behavior in `prepare`, guard with `isVisible(...)`, and exit early when the new affordance is absent.
- For new feature routes, keep screenshot API mocks falsey-tolerant so smaller merge-base request sets still resolve.
- Before publishing screenshot scenario changes, run a local merge-base sanity check using a worktree server (port 5174) and `pnpm --filter @zakka/web screenshots:capture -g <scenario>`.

## Interaction Test Rules

- When fixing or adding an editor interaction (pointer drags, handles, modifier clicks, shortcuts, inline text editing), add a browser interaction test in a `*.browser.test.tsx` file next to the component. See "Testing" in `docs/development.md`.
- Assert on the document or callback the interaction produces, and fail when an expected element is missing; do not guard interaction assertions with `isVisible(...)`.

## API, Schema, and Migration Rules

When adding API endpoints, persistence tables, or migrations:

- Update screenshot API mocks in `apps/web/screenshots/app-screenshots.spec.ts` for new paths.
- Keep migrations append-only and update both migration definitions and expectations in `apps/api/src/persistence/migrations.test.ts` in the same change.
- When extending Zod response schemas, update all fixtures/mocks that build the schema (including screenshot fixtures such as `createAsset`).

## Commit Rules

- Use Conventional Commits with only these types: `feat`, `fix`, `chore`.
- If the work addresses a GitHub issue, include `(fixes #<issue number>)` on the first line.

## If Blocked

- If a required validation step cannot run, report what command or browser step was attempted, why it failed, and what fallback checks were completed.

## Pull Requests

- Always include screenshots in pull requests if the change affects the UI.