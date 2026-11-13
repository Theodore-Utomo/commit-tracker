# Testing

Unit tests cover counting, privacy, and services. End-to-end tests cover the extension on a real GitHub profile. Manual checks cover Chrome loading and anything a unit test cannot see.

## Commands

```bash
pnpm test -- --run          # Vitest once
pnpm typecheck
pnpm lint
pnpm build
pnpm exec playwright install chromium   # once, before the first e2e run
pnpm test:e2e
```

Run one file while working:

```bash
pnpm exec vitest run tests/unit/core/dedupe.test.ts
```

`pnpm test` with no extra arguments stays open in watch mode. Agents and CI use `--run`.

## Where tests live

- `tests/unit/` — Vitest. Mirror `src/core/`, `src/services/`, and the pure helpers in `src/dom/`. `src/dom/` tests pass a `querySelector` stub and never use `document`.
- `tests/e2e/` — Playwright against the built extension.
- `tests/fixtures/` — recorded GraphQL responses. Tokens and private data removed before they are committed.

Specs import `describe`, `it`, and `expect` from `vitest`. `fake-indexeddb` is loaded from `tests/setup.ts`.

## What needs a unit test

- Every module in `src/core/`, with table-driven cases.
- `src/services/contributions.ts`, using a fake `GitHubClient` and the in-memory cache. No real GitHub requests.
- A bug fix gets a test that fails before the fix and passes after it.

Required cases once those modules exist: the same SHA on three branches counts once; a squash-merged pull request contributes its original commits; a private commit in `publicPlusCounts` has no message and no repository; a timestamp near local midnight lands on the right day; the grid starts on a Sunday and has 53 columns. Service tests cover a cache hit plus an incremental fetch, a rate-limit cutoff (`partial: true`), and each `ErrorCode`.

Not required for copy, color, and layout-only components. Those are manual or end-to-end checks.

## Fakes

Tests construct the fakes and pass them in. Production constructs the `fetch` client and the IndexedDB store in the background entrypoint and passes those in. Tests never call the network and never embed a token.

## End to end

Playwright loads the built extension, opens a public profile, scrolls to the contribution graph, accepts the prompt, and checks that the heatmap renders. The token comes from an environment variable, never from a file in the repo.

## Manual

1. `pnpm dev`, or `pnpm build` and load `.output/chrome-mv3` at `chrome://extensions`.
2. Open a GitHub profile and scroll until the contribution graph is in view.
3. For a privacy change, check the viewer's own profile and one other profile. Confirm the other profile shows no private repository names or commit messages.

### Profile detection

With DevTools open on github.com:

1. Open `https://github.com/<user>` and scroll until the contribution graph is at least half visible. The login logs exactly once. Scrolling away and back logs nothing more.
2. Open a repository page (`/<user>/<repo>`) and denylisted routes such as `/settings`, `/trending`, and `/orgs/<org>`. Nothing logs, and the extension throws no errors.
3. From one profile, navigate to another inside GitHub (for example from Followers) before scrolling to the first graph. Only the second login logs.
4. Open a page with no contribution graph, such as an organization overview. The page is unchanged, nothing logs, and there are no uncaught errors.
