# Commit Tracker

A Chrome extension (Manifest V3) that shows a GitHub user's commit activity across **all branches**, not just the default branch. It adds an all-branches heatmap to GitHub profile pages.

This file is the source of truth for the project's design. Read it before making changes, and update it when a decision changes.

---

## 1. Why it exists

GitHub's contribution graph only counts commits on a repo's default branch (or `gh-pages`). Two kinds of work go missing:

- **Unmerged feature-branch commits.**
- **Squash-merged work.** A branch with 15 commits becomes one commit on main. Once the branch is deleted, the other 14 are gone from the branch list. The pull request still has them.

GitHub's own APIs don't fix this. `contributionsCollection` follows the same default-branch rule, and commit search only searches default branches. So this extension counts commits itself.

## 2. What it does

1. On a GitHub profile page, when the contribution graph scrolls into view, it asks: "See commits across all branches?"
2. If the viewer accepts, it fetches commits from every branch and from merged PRs, removes duplicates, and draws its own heatmap.
3. A toggle switches between GitHub's native graph and the all-branches graph.
4. Clicking a day shows that day's commits (message, repo, branch) when the privacy rule allows it.

## 3. Privacy rule (must hold everywhere)

Only show what the profile owner allows:

| Situation | Public repos | Private repos |
|---|---|---|
| Viewer's own profile | Full details | Full details (whatever the token can access) |
| Someone else's profile, owner has **Private contributions** on | Full details | **Counts only** (no repo names, no messages) |
| Someone else's profile, setting off | Full details | Nothing |

Rules:

- The privacy check runs **before** any commit fetching. Never fetch data you aren't allowed to show.
- Details for private commits are stripped in the service worker, **before** the response is sent. The content script must never receive data it shouldn't display.
- The cache stores data under the privacy mode it was fetched with. Never serve a cache entry fetched in `owner` mode to a different viewer or mode.

**Open question:** confirm whether `contributionsCollection.restrictedContributionsCount` (GraphQL) reliably shows if the owner has turned on Private contributions. Test against a profile with the setting on, then off. If it's unreliable, fall back to reading the text of GitHub's own graph on the page (it mentions private contributions when they're shown). Until this is confirmed, default to `publicOnly` for other people's profiles.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Extension framework | **WXT** | Manifest V3, file-based entrypoints, hot reload, zips for the Chrome Web Store |
| Language | **TypeScript** (strict) | |
| Package manager | **pnpm** | |
| UI | **Preact** via `@preact/preset-vite` | Rendered inside a Shadow DOM with WXT's `createShadowRootUi` |
| Heatmap | Hand-written SVG | 53 × 7 grid; no chart library |
| GitHub data | GraphQL (`https://api.github.com/graphql`) via `fetch` | Thin typed client, no SDK |
| Auth | Personal access token (v1), OAuth device flow (v2) | No backend, no client secret |
| Cache | IndexedDB via `idb` | Commit data per user |
| Settings | `chrome.storage.local` via WXT's `storage` helper | Token, emails, preferences |
| Unit tests | Vitest + `fake-indexeddb` | Core logic and services |
| End-to-end tests | Playwright | Real GitHub profile page with the built extension |
| Lint / format | ESLint + Prettier | |

---

## 5. Repo setup

### Prerequisites

- Node.js 20 or later
- pnpm: `corepack enable` (or `npm i -g pnpm`)
- Google Chrome
- A GitHub personal access token (see "Token" below)

### Initialize the project

This folder already contains `CLAUDE.md`. WXT's init expects an empty folder, so move this file aside while scaffolding:

```bash
cd ~/commit-tracker
mv CLAUDE.md /tmp/CLAUDE.md
pnpm dlx wxt@latest init . --template vanilla --pm pnpm
mv /tmp/CLAUDE.md .
pnpm install
git init
```

WXT has no Preact template, so start from `vanilla` and add Preact:

```bash
pnpm add preact idb
pnpm add -D @preact/preset-vite vitest fake-indexeddb @playwright/test \
  eslint prettier typescript
```

If Preact causes build trouble, `--template react` with `@wxt-dev/module-react` is an acceptable fallback. Record the change here.

### `wxt.config.ts`

```ts
import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  vite: () => ({ plugins: [preact()] }),
  manifest: {
    name: 'Commit Tracker',
    description: 'See GitHub commits across all branches, not just the default branch.',
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
  },
});
```

Keep permissions minimal. Don't add `tabs`, `scripting`, or `<all_urls>` unless a feature truly needs them.

### `tsconfig.json`

Extend WXT's generated config and point JSX at Preact:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "noUncheckedIndexedAccess": true
  }
}
```

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "postinstall": "wxt prepare",
    "test": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  }
}
```

### `.gitignore`

```
node_modules/
.output/
.wxt/
.env*
playwright-report/
test-results/
```

### Run it

- `pnpm dev` builds the extension and opens a Chrome window with it loaded and hot-reloading.
- To load it in your normal Chrome: `pnpm build`, open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and choose `.output/chrome-mv3`.

### Token

For v1, paste a personal access token on the options page.

- **Classic token (simplest):** scopes `repo` (private repos), `read:org` (organization repos), `read:user`.
- **Fine-grained token:** read-only **Contents**, **Metadata** and **Pull requests**, for the repos or organizations you want included. Organization owners may need to approve fine-grained tokens.

Never commit a token. Never put one in test fixtures.

---

## 6. Project structure

```
src/
  entrypoints/
    background.ts            # Service worker: message router only
    github-profile.content/  # Content script on github.com profile pages
      index.tsx              # Bootstrap: page detection, observers, mounts UI
      style.css
    options/                 # Options page: token, emails, clear cache
      index.html
      main.tsx
    popup/                   # Small status popup (optional)
  core/                      # Pure TypeScript. No chrome.*, no fetch, no DOM.
    types.ts                 # Commit, DayBucket, PrivacyMode, Contributions
    dedupe.ts
    privacy.ts               # Privacy policies (strategy pattern)
    aggregate.ts             # Group commits by local day, compute levels
    grid.ts                  # 53 × 7 grid layout math
  services/                  # Used by the service worker
    github/
      client.ts              # GitHubClient interface + fetch implementation
      queries.ts             # GraphQL query strings
      mappers.ts             # API responses -> core types
    cache/
      store.ts               # CacheStore interface + IndexedDB implementation
    settings.ts              # Typed wrapper over chrome.storage
    contributions.ts         # Orchestrates one GET_CONTRIBUTIONS request
    concurrency.ts           # Small promise pool
  messaging/
    protocol.ts              # Message and response types (shared)
    client.ts                # sendMessage helpers for the content script
  dom/
    github-page.ts           # All GitHub selectors and page detection
  ui/
    Prompt.tsx
    Heatmap.tsx
    DayDetail.tsx
    Toggle.tsx
tests/
  unit/                      # Vitest, mirrors src/core and src/services
  e2e/                       # Playwright
```

Import rules:

- `core/` imports nothing outside `core/`.
- `services/` may import `core/` and `messaging/protocol.ts`.
- `ui/` and `dom/` may import `core/` (types, grid math) and `messaging/`, never `services/`.
- `entrypoints/` wire things together and contain as little logic as possible.

---

## 7. Architecture

### Components

- **Content script** (`github.com/*`): detects profile pages, shows the prompt, renders the heatmap. **Never calls the GitHub API and never sees the token.**
- **Background service worker:** the only component that talks to GitHub. Owns the token, fetching, deduping, the privacy rule and the cache.
- **Options page:** token entry, the user's commit emails, a "clear cache" button. Writes to `chrome.storage`.
- **IndexedDB:** commit cache per (login, privacy mode).
- **chrome.storage.local:** token and settings.

### Trust boundary

The page (GitHub's DOM) is untrusted territory: other extensions and page scripts share it. Anything the content script holds could leak to the page. So:

- The token lives only in the service worker and `chrome.storage.local`.
- The content script only ever receives data that has already passed the privacy filter.
- Render data with Preact (escaped text). Never build HTML strings from commit messages or repo names.

### Patterns

**Layered architecture (core → services → entrypoints).**
`core/` is a pure functional core: deterministic functions over plain data, fully unit-testable. `services/` is the imperative shell that does I/O. Entrypoints are thin adapters to Chrome. Most bugs will be in counting logic, and keeping that pure makes it easy to test.

**Ports and adapters.**
`services/` depends on interfaces, not implementations:

```ts
interface GitHubClient {
  getViewerAndUser(login: string): Promise<ViewerAndUser>;
  listRepos(login: string, mode: PrivacyMode): Promise<RepoRef[]>;
  getBranchCommits(repo: RepoRef, author: AuthorFilter, since?: string): Promise<RawCommit[]>;
  getMergedPrCommits(login: string, since?: string): Promise<RawCommit[]>;
}

interface CacheStore {
  get(key: CacheKey): Promise<CacheEntry | undefined>;
  put(key: CacheKey, entry: CacheEntry): Promise<void>;
  clear(): Promise<void>;
}
```

Tests pass in fakes; production passes the `fetch` and IndexedDB implementations. Construct them once in `background.ts` and hand them to `contributions.ts` (manual dependency injection, no container library).

**Typed message protocol (discriminated unions).**
All messages between the content script and the worker are declared in `messaging/protocol.ts`:

```ts
type Request =
  | { type: 'GET_CONTRIBUTIONS'; login: string }
  | { type: 'CLEAR_CACHE' };

type Response =
  | { ok: true; data: Contributions }
  | { ok: false; error: ErrorCode };

type ErrorCode = 'NO_TOKEN' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'NOT_FOUND' | 'NETWORK' | 'UNKNOWN';
```

The worker's `onMessage` handler is a single `switch` on `type`, so TypeScript checks every case. Don't add untyped messages.

**Strategy pattern for privacy.**
Each privacy mode is a policy object with the same interface:

```ts
interface PrivacyPolicy {
  mode: PrivacyMode; // 'owner' | 'publicPlusCounts' | 'publicOnly'
  includeRepo(repo: RepoRef): boolean;
  present(commit: Commit): Commit | CountOnly; // strips details when needed
}
```

`privacy.ts` exports `policyFor(mode)`. The pipeline never branches on mode itself, so a new mode means a new policy, not edits everywhere.

**Pipeline.**
A request runs as a fixed sequence of steps, each a function from one shape to the next:

```
resolve mode → list repos → fetch (branches + PRs) → normalize → dedupe → apply policy → aggregate by day → cache → respond
```

Keep each step a named function in its own module, so the order is readable in `contributions.ts`.

**Cache-aside with incremental sync.**
`contributions.ts` reads the cache first. On a hit, it fetches only commits newer than `lastSync` (`since` on GraphQL `history`), merges them by SHA, and writes the cache back. The cache key is `{ viewerLogin, profileLogin, mode }`. Entries older than 24 hours trigger a refresh from `since = lastSync`; a full refetch happens only on "clear cache" or a schema version change.

**Request coalescing.**
If two tabs ask for the same profile at once, share one in-flight promise (a `Map<key, Promise>` in the worker) instead of fetching twice.

**Bounded concurrency.**
Fetch about 4 repos at a time with a small promise pool in `concurrency.ts`. Read `rateLimit { remaining resetAt }` from GraphQL responses. Below a threshold (e.g. 200 points), stop and return partial results with a flag rather than burning the whole quota.

**DOM adapter.**
Every GitHub selector and URL rule lives in `dom/github-page.ts`: `isProfilePage(url)`, `getProfileLogin(url)`, `findContributionGraph(root)`. GitHub changes its markup; when it does, only this file changes. Each lookup has a fallback selector and fails quietly (no UI) rather than breaking the page.

**Stateless service worker.**
Manifest V3 can stop the worker at any time. Keep no important state in module variables between events; persist to `chrome.storage` or IndexedDB. The in-flight request map is the only exception, and losing it is harmless. For long fetches, keep the worker alive with a `chrome.runtime.connect` port from the content script, or return `true` from `onMessage` and respond asynchronously.

**Typed errors, no throws across boundaries.**
Services may throw internally, but the message handler catches everything and maps it to an `ErrorCode`. The UI shows a specific message per code (e.g. `NO_TOKEN` links to the options page; `RATE_LIMITED` shows the reset time).

---

## 8. Data model (`core/types.ts`)

```ts
type PrivacyMode = 'owner' | 'publicPlusCounts' | 'publicOnly';

interface RepoRef { owner: string; name: string; isPrivate: boolean; isFork: boolean }

interface Commit {
  sha: string;
  authoredDate: string;      // ISO; use this, not committedDate
  messageHeadline: string;
  repo: RepoRef;
  branch?: string;           // undefined for commits found only via a PR
  source: 'branch' | 'pr';
}

interface CountOnly { sha: string; authoredDate: string; private: true }

interface DayBucket { date: string /* YYYY-MM-DD, viewer's local time */; count: number; commits?: Commit[] }

interface Contributions {
  login: string;
  mode: PrivacyMode;
  days: Record<string, DayBucket>;
  totals: { commits: number; repos: number };
  partial: boolean;          // true if rate limits cut the fetch short
  fetchedAt: string;
}
```

---

## 9. Flow on a profile visit

1. **Scroll (content script).** `dom/github-page.ts` reads the username from the URL path (a single segment such as `/octocat`; ignore `/orgs`, `/settings`, repo pages). A `MutationObserver` waits for the contribution graph, since GitHub loads it after the page. An `IntersectionObserver` (threshold ~0.5) shows the prompt when the graph is in view. Re-run setup on `turbo:load`, since GitHub swaps pages without a full reload; clean up observers and the mounted UI when the page changes.
2. **Prompt (content script).** Mount the prompt with `createShadowRootUi` (`cssInjectionMode: 'ui'`) next to the graph. On accept, send `{ type: 'GET_CONTRIBUTIONS', login }`. If "always show" is saved in settings, skip the prompt. Show a loading state.
3. **Privacy check (service worker).** Read the token from settings; if missing, respond `NO_TOKEN`. Query the viewer and the profile user (see queries below). Resolve the `PrivacyMode` and the matching `PrivacyPolicy`.
4. **Fetch (service worker + cache + API).** Check the cache. List repos for the mode:
   - `owner`: `viewer.repositories(affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER])`
   - others: `user.repositories(privacy: PUBLIC)` plus `repositoriesContributedTo`, plus private ones only if mode is `publicPlusCounts` and the token can see them

   Skip forks. For each repo, fetch every branch's history filtered by author, once with `author: { id }` and once with `author: { emails }` for the user's extra emails (owner mode only, since emails come from settings). Then fetch merged-PR commits to recover squash-merged work, keeping only commits authored by this user.
5. **Combine (service worker).** Normalize to `Commit`, dedupe by SHA (prefer the `branch` source over `pr` when both exist), apply the policy, and group by `authoredDate` in the viewer's local time zone. Save the cache, then respond with `Contributions`.
6. **Render (content script).** Build the 53 × 7 grid starting on the Sunday about a year ago (`core/grid.ts`). Compute 5 color levels by quartile, like GitHub. Color with GitHub's CSS variables (e.g. `var(--contribution-default-bgColor-2)`); custom properties pass into the Shadow DOM, so light and dark mode match automatically. Add the toggle against the native graph and the click-a-day detail view (details only for commits the policy didn't strip). Label the graph "All commits across branches".

---

## 10. GraphQL queries (`services/github/queries.ts`)

Viewer and profile user (step 3):

```graphql
query ViewerAndUser($login: String!) {
  viewer { login id }
  user(login: $login) {
    id
    login
    contributionsCollection { restrictedContributionsCount }
  }
  rateLimit { remaining resetAt }
}
```

Branches and history for one repo (step 4):

```graphql
query BranchCommits($owner: String!, $name: String!, $author: CommitAuthor!, $since: GitTimestamp, $refCursor: String) {
  repository(owner: $owner, name: $name) {
    isPrivate
    refs(refPrefix: "refs/heads/", first: 50, after: $refCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        target {
          ... on Commit {
            history(author: $author, since: $since, first: 100) {
              pageInfo { hasNextPage endCursor }
              nodes { oid authoredDate messageHeadline }
            }
          }
        }
      }
    }
  }
  rateLimit { remaining resetAt }
}
```

Merged PR commits (step 4):

```graphql
query MergedPrCommits($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        repository { owner { login } name isPrivate isFork }
        commits(first: 100) {
          nodes { commit { oid authoredDate messageHeadline author { user { login } } } }
        }
      }
    }
  }
  rateLimit { remaining resetAt }
}
```

With `q = "author:<login> is:pr is:merged"`, plus `merged:>=<date>` for incremental syncs.

Paginate any connection whose `pageInfo.hasNextPage` is true. The same commit appears on many branches, so expect heavy duplication before dedupe.

---

## 11. Testing

- **Unit (Vitest):** every module in `core/`, with table-driven tests. Must-have cases: the same SHA on 3 branches counts once; a squash-merged PR contributes its original commits; a private commit in `publicPlusCounts` mode has no message or repo; dates near midnight land on the correct local day; the grid starts on a Sunday and has 53 columns.
- **Service tests (Vitest):** `contributions.ts` with a fake `GitHubClient` and `fake-indexeddb`. Cover cache hit plus incremental fetch, rate-limit cut-off (`partial: true`), and each `ErrorCode`.
- **GitHub fixtures:** store recorded GraphQL responses (with tokens and private data removed) in `tests/fixtures/` for the mappers.
- **End-to-end (Playwright):** load the built extension into Chromium, open a public profile, scroll to the graph, accept the prompt, and check the heatmap renders. Use a token from an environment variable, never a file in the repo.
- Run `pnpm typecheck && pnpm lint && pnpm test` before every commit.

---

## 12. Conventions

- TypeScript strict mode; no `any`. Prefer `type` unions over enums.
- Pure functions in `core/`; side effects only in `services/` and entrypoints.
- One GitHub selector module (`dom/github-page.ts`); no selectors anywhere else.
- Never log the token or full API responses. Send the token only to `api.github.com`.
- Render user-provided text (commit messages, repo names) as text, never as HTML.
- Small commits with conventional messages: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- When a design decision changes, update this file in the same commit.

---

## 13. Build order

1. Scaffold with WXT and Preact; content script logs when a profile's graph scrolls into view.
2. Options page saves a token; worker answers `GET_CONTRIBUTIONS` with the viewer's login (end-to-end message path works).
3. `core/` types, dedupe, aggregate and grid, with unit tests.
4. GitHub client: own profile, owner mode, branch commits only. Render the heatmap.
5. Merged-PR commits (squash-merge recovery).
6. IndexedDB cache and incremental sync.
7. Privacy modes for other people's profiles; resolve the open question in section 3.
8. Toggle, day detail view, error states, rate-limit handling.
9. Playwright tests, then a Chrome Web Store build (`pnpm zip`).
10. Later: OAuth device flow to replace the pasted token.

## 14. Not in scope (for now)

- Changing what other visitors see on a profile. Only people who install the extension see the all-branches graph. A separate GitHub Action that regenerates an SVG for a profile README could cover that later.
- Firefox and Safari builds. WXT supports them, so keep code browser-agnostic (`browser.*` from WXT, not `chrome.*` directly) where it costs nothing.
