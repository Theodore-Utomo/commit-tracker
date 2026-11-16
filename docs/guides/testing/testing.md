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

- Every module in `src/core/`, with table-driven cases. Time-zone-sensitive code takes an explicit `timeZone` argument, and its tests pass one instead of relying on the machine zone. A test that changes `process.env.TZ` restores it with `delete` when it was unset, and uses a date that crosses a week boundary when shifted (a Sunday). As an occasional check, run `TZ=Pacific/Pago_Pago pnpm exec vitest run tests/unit/core` and the same with `TZ=Pacific/Kiritimati`.
- `src/services/contributions.ts`, using a fake `GitHubClient` and the in-memory cache. No real GitHub requests.
- `src/services/github/client.ts` response mapping, with a fake `fetch`. Cover each status and body rule, including the rate-limit header edge cases.
- `src/services/github/client.ts` paging. Cover every loop exit: a first-page failure versus a later-page failure, a budget stop before a refs page and before a history page, a deleted branch, and a repository hidden on the first page versus a later one. Every paged response must record its `rateLimit`, and a test should prove it. When unsure a test is strong enough, break the line on a scratch copy and confirm a test fails.
- `src/services/handle-message.ts`, with a fake client and `getToken`. Cover each `ErrorCode`.
- The pure helpers in `src/messaging/`: `sendMessage` with an injected send function, and `isRequest`.
- A bug fix gets a test that fails before the fix and passes after it.

Required cases once those modules exist: the same SHA on three branches counts once; a squash-merged pull request contributes its original commits; a private commit in `publicPlusCounts` has no message and no repository; a timestamp near local midnight lands on the right day; the grid starts on a Sunday and has 53 columns. Service tests cover a cache hit plus an incremental fetch, a rate-limit cutoff (`partial: true`), and each `ErrorCode`.

Not required for copy, color, and layout-only components. Those are manual or end-to-end checks.

## Fakes

Tests construct the fakes and pass them in. Production constructs the `fetch` client and the IndexedDB store in the background entrypoint and passes those in. Tests never call the network and never embed a token.

`vitest.config.ts` loads `WxtVitest()`, so WXT's auto-imports (`browser`, `storage`) resolve in tests. Tests that touch extension storage use `fakeBrowser` from `wxt/testing/fake-browser` and call `fakeBrowser.reset()` in `beforeEach`.

## End to end

Playwright loads the built extension, opens a public profile, scrolls to the contribution graph, accepts the prompt, and checks that the heatmap renders. The token comes from an environment variable, never from a file in the repo.

## Manual

1. `pnpm dev`, or `pnpm build` and load `.output/chrome-mv3` at `chrome://extensions`.
2. Open a GitHub profile and scroll until the contribution graph is in view.
3. For a privacy change, check the viewer's own profile and one other profile. Confirm the other profile shows no private repository names or commit messages.

### Profile detection

With DevTools open on github.com:

1. Open `https://github.com/<user>` and scroll until the contribution graph is at least half visible. The button `See commits across all branches` appears once, after the graph. Scrolling away and back adds nothing more, and the content-script console logs nothing.
2. Open a repository page (`/<user>/<repo>`) and denylisted routes such as `/settings`, `/trending`, and `/orgs/<org>`. No prompt appears, and the extension throws no errors.
3. From one profile, navigate to another inside GitHub (for example from Followers) before scrolling to the first graph. Only the second profile shows the button, and the first profile's heatmap is not left behind.
4. Open a page with no contribution graph, such as an organization overview. The page is unchanged and there are no uncaught errors.

### Token and viewer

Options page (open it from `chrome://extensions` → Details → Extension options):

1. With no token saved, the page shows the token input and a Save button, and no `A token is saved.` text.
2. Save with the input empty or only spaces. `Enter a token first.` appears, and extension storage has no `githubToken` key.
3. Save a valid token. `Token saved.` and `A token is saved.` appear, and the input is empty.
4. Close and reopen the page. `A token is saved.` shows, and the input is empty, `type="password"`, with no placeholder. Searching the Elements panel for the token finds nothing. The Always show checkbox round-trips: check it, reopen, and it stays checked; uncheck it, reopen, and it stays unchecked.
5. Extra commit emails starts empty. Save ` dev@example.com `, a blank line, `a@example.com, b@example.com`, and `other@example.com`. The status says `Emails saved.` The field shows those four addresses, one per line, and reopening the page shows the same four. No console line contains an address.

Content script and worker (DevTools on a github.com profile, content-script console context). Always show is off unless a step says otherwise. Nothing is fetched until Accept.

6. With a valid token, scroll the graph half into view. The button `See commits across all branches` appears and no GraphQL request has been sent. Click it. The button is disabled and the shadow tree shows `Loading commits…`. On your own profile the heading `All commits across branches` then appears. On someone else's profile the same heading appears, and no private repository name or commit message is shown. Scrolling again adds nothing. The page's Network panel shows no `api.github.com` request; the service worker makes it.
7. In the service worker's Network panel, after Accept (or as soon as the graph is half visible when Always show is on), the request is a POST to `https://api.github.com/graphql`. No console line anywhere shows the token, the Authorization header, or raw JSON.
8. With no token saved, Accept shows `Add a token in the extension options.` and an `Open extension options` button, and draws no squares. The service worker makes no request to `api.github.com`.
9. With an invalid token in storage, Accept shows `The saved token was rejected. Save a new one in the extension options.` and the same button.
10. Open a profile, reload the extension at `chrome://extensions`, then scroll the old tab to the graph and click Accept. The shadow tree shows `Something went wrong. Try again.` and a `Try again` button, with no uncaught "Extension context invalidated" error.
11. Navigate to a second profile inside GitHub before scrolling the first. Only the second profile's prompt appears, and no heatmap for the first one is left on the page.
12. After `pnpm build`, `grep -c githubToken .output/chrome-mv3/content-scripts/*.js` and `grep -c api.github.com` on the same files both print `0`.

### Branch commits

DevTools open on your own profile (content-script console context), and the service worker's Network panel open from `chrome://extensions` → service worker → inspect:

1. Scroll the graph half into view and click Accept. The heading `All commits across branches` appears, with a 53 by 7 grid. No repository name or commit message is shown. With Always show on, the same heatmap appears without the button, after the graph is half visible.
2. After Accept (or after the graph is half visible, when Always show is on), the service worker sends `OwnerRepos`, then `BranchCommits` requests. `variables.author.id` is your node id, and `since` is the grid's first Sunday at local midnight with your offset. No query text contains a branch name; `BranchHistory` passes it as `qualifiedName`. No fork appears. On your own profile it then sends `MergedPrCommits` with `author:<your login> is:pr is:merged merged:>=` the grid's first Sunday. If extra emails are saved, each repository gets a second `BranchCommits` whose `author` is `{ emails }`, and that list appears in no console line.
3. On someone else's profile, click Accept. The heading `All commits across branches` appears. The service worker sends `ViewerAndUser`, then `PublicRepos`, `BranchCommits`, and `MergedPrCommits`. The search query contains `is:public`. No `OwnerRepos` query. A day that has only private commits stays the empty color. The heatmap does not show repository names or commit messages.
4. Push one commit to three branches, then reload and accept again. The day's count goes up by exactly 1.
5. A repository last pushed before the grid start is never named in a `BranchCommits` request.
6. In an organization with SAML single sign-on and no active session, the heatmap still appears (never an error notice), and the organization's repository names appear nowhere on the page.

### Graph interactions

DevTools open on a github.com profile. Run the toggle and day steps on your own profile and on someone else's.

1. Accept the prompt. The heatmap and a checked `Show commits from all branches` checkbox appear, and GitHub's own graph is hidden (`hidden` is set on it in the Elements panel; the node is still in the DOM).
2. Uncheck the box. GitHub's graph reappears and the heatmap and day list are hidden; the checkbox stays. Reload and accept again: the box is still unchecked and GitHub's graph is showing. Check it again to restore the heatmap.
3. Click a day with commits. On your own profile the list shows each commit as `<message> — <owner>/<name> (<branch>)`, without a branch for a commit found only through a pull request. On someone else's profile, no private repository name or message appears. Click an empty day: `No commits`. Clicking makes no new request in the service worker's Network panel.
4. With no token saved, click `Open extension options`. The options page opens in a new tab, not a dialog. Save a token, reload the profile, and accept again.
5. `NOT_FOUND` cannot be reached from a URL: GitHub serves its 404 page for an unknown login, so no graph and no prompt appear. Instead, on a profile tab, switch the DevTools console context to the extension's content script and run `chrome.runtime.sendMessage({ type: 'GET_CONTRIBUTIONS', login: 'github' })`. `github` is an organization, so `user` is null and the reply is `{ ok: false, error: 'NOT_FOUND' }`. The notice copy for that code is covered by `tests/unit/ui/error-notice.test.ts`.
6. Offline mode in the page's DevTools does not reach the worker, which makes the fetch. Set the service worker offline instead (its DevTools → Network → Offline) and accept. `Could not reach GitHub. Try again.` appears with `Try again`. Go back online and click `Try again`: `Loading commits…`, then the heatmap.
7. On any error, GitHub's graph stays visible.
8. Accept on a profile, follow a link to another page, and press Back. GitHub's graph is never left hidden without the heatmap beside it.
9. Before accepting, delete GitHub's calendar table (`.js-calendar-graph-table`) in the Elements panel, then accept. The heatmap and the checkbox still render and stay visible (the outer `.js-yearly-contributions` container that holds them is not hidden), toggling works, and the console shows no uncaught error.
10. Push a commit whose headline is `<b>bold</b> & <img src=x>`, accept, and click its day. The line shows that literal text, the shadow root has no `<b>` or `<img>` element, and no request goes to `x`.

### Worker keepalive

1. Close every DevTools window attached to the service worker first. An open worker DevTools window keeps the worker alive and hides the problem.
2. Use an account whose fetch takes more than 30 seconds. The heatmap still appears, and `chrome://serviceworker-internals` shows the worker RUNNING throughout.
3. Navigate inside GitHub before the heatmap appears. No heatmap for the old page appears, and no further pings are sent.

### Rate-limit cutoff

In a scratch build only (never commit it), raise `RATE_LIMIT_FLOOR` in `src/services/github/client.ts`:

1. Above your remaining points: the shadow tree shows `GitHub rate limit reached. It resets at <time>.`, with the reset in your local time, and a `Try again` button. No squares are drawn, and GitHub's graph stays visible.
2. A little below your remaining points, so the cutoff lands mid-fetch: the heatmap still appears, followed by `Results are incomplete because the rate limit was close.` If the cutoff lands before any commit is kept, the shadow tree shows the rate-limit sentence instead. Reload and accept again. `since` is the grid start, or 14 days before the last complete fetch. It is not the start time of the partial run.

### Cache

1. On your own profile, accept the prompt. The heading `All commits across branches` appears. In the service worker, `BranchCommits` `since` is the grid's first Sunday at local midnight, and `MergedPrCommits` uses that same local day.
2. Reload the profile and accept again. Older days are still on the heatmap. The worker sends `OwnerRepos`, `BranchCommits`, and `MergedPrCommits` again, and `since` is about 14 days before the previous fetch. It also sends `RepoStates` (up to 50 repositories per request) for stored repositories this run did not list, and the result is not marked incomplete.
3. On the options page, click **Clear cache**. The page says `Cache cleared.` IndexedDB `commit-tracker` / `entries` is empty. Accept again. `since` is the grid start from step 1.
4. Leave the options page open, reload the extension, and click **Clear cache** on that page. The page says `Could not clear the cache.`
5. Start a fetch and click **Clear cache** before it finishes. The page says `Cache cleared.` The next accept uses the grid start.
6. Start a fetch, then save a different account's token before it finishes. Accept on that account's profile. The heatmap has none of the first account's repository names or commit messages.
7. On someone else's profile, accept, reload, and accept again. Older days stay filled. `since` is about 14 days before the previous fetch, and the worker still does not send `OwnerRepos`. A private-only day stays empty. Click **Clear cache**, then accept again. `since` is the grid start.
8. On your own profile, accept once with no extra emails saved. Then save an extra email on the options page and accept again. The worker sends `BranchCommits` with `author: { emails }`, and `since` is the grid start, not 14 days before the last fetch: an entry fetched with other emails is a miss. Accept once more and `since` is back to about 14 days before. Remove the email and accept: `since` is the grid start again, and that email's commits leave the heatmap. IndexedDB `entries` shows an `emailsKey` of 64 hex characters, never the address. Finally, start a fetch and save a different email before it finishes, then accept again: `since` is the grid start, and no entry from the interrupted run was written.
9. On someone else's profile, accept so a public repository's commits are cached. Have the owner make that repository private (or use a test repository of your own and a second account), then accept again. The worker sends `RepoStates` for that repository, and its commits, messages, and name are gone from the heatmap and the day list. A repository that was deleted drops the same way. Repeat with the lookup cut short (set the service worker offline after the repository listing, or raise `RATE_LIMIT_FLOOR` in a scratch build): stored commits from unlisted repositories are not shown, `Results are incomplete because the rate limit was close.` or an error appears, and the next accept still uses the earlier `lastSync` because nothing was written.
10. With a token that can see a friend's private contributions, open their profile once with Private contributions on and once off. Read `restrictedContributionsCount` on the `ViewerAndUser` response. Record whether it tracks the toggle. This phase stays `publicOnly` either way. Write the result into CLAUDE.md section 3 only if it is conclusive.
