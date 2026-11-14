# Plan: Owner Branch Commits

Date: 2026-11-12
Status: In Progress

## Summary

When the viewer's own profile graph scrolls into view, fetch that person's commits on every non-fork branch and log the count. Done means the page logs one number for the year, the same SHA is counted once, and a short rate-limit budget stops the fetch without throwing away the commits already gathered. The heatmap phase adds the first visible UI.

## Acceptance Criteria

- On the viewer's own profile, the page logs `N commits across all branches` for the grid year. A failure logs only the error code. Nothing is inserted into GitHub's page in this phase.
- A commit present on three branches counts once.
- Another profile is not fetched and still only logs the viewer login from the previous phase.
- Repositories that are forks are not queried. Repositories last pushed before the grid start are not queried.
- A repository that GraphQL returns as `null` or with a `FORBIDDEN` error (for example, SAML single sign-on) is skipped. The other repositories still count.
- The content script keeps the worker alive with a pinged `keepalive` port for as long as the request is open.
- Commits whose local day falls outside the grid year are not counted.
- If rate-limit points fall below 200 after at least one commit was kept, the total is still logged and the returned `Contributions.partial` is true. If the first request cannot run because of the limit, the page gets `RATE_LIMITED` and `resetAt`.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

Owner mode only, and only when the profile login equals `viewer.login`. The content script receives full `Commit` objects for that case. The logged line uses `totals.commits` and does not print repository names. No cache yet. Extra commit emails are not used yet; the merged-PRs phase adds them.

## Messages

`GET_CONTRIBUTIONS` success `data` becomes `Contributions` when the profile is the viewer. When it is not, `data` stays `{ viewerLogin: string }`. This phase returns `NOT_FOUND` only for a login that fails `LOGIN_PATTERN`, and does not query `user(login)`. `RATE_LIMITED` includes `resetAt`. `handleGetContributions` returns the pipeline `Response` unchanged.

Dependencies: `getContributions(login, { client, getToken, now, timeZone })`, where `now: () => Date` and `timeZone: string`. `handleGetContributions` takes the same deps and passes them through. `background.ts` builds them once: the client, `getToken` from settings, `() => new Date()`, and `Intl.DateTimeFormat().resolvedOptions().timeZone`. Tests pass a fixed `now` and `'America/New_York'`.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/services/github/mappers.test.ts` | A branch history node becomes a `Commit` with `source: 'branch'`; a missing `target` is skipped; a `null` repository is skipped; `isFork: true` is not returned from `mapRepos` |
| `tests/unit/services/github/client.test.ts` | A second refs page and a second history page are requested when `hasNextPage` is true, and the later SHA is kept; the history follow-up uses the same author id and `since`; the branch name is a variable, not interpolated; `listOwnerRepos` requests `orderBy: { field: PUSHED_AT, direction: DESC }` and stops paging at the first repo whose `pushedAt` is before `since`; a repo page with `data` plus a `FORBIDDEN` error returns the other repos |
| `tests/unit/services/concurrency.test.ts` | With limit 4, no more than 4 tasks run at once; results keep input order; a task that rejects does not stop the others, and its rejection is returned in its slot |
| `tests/unit/services/contributions.test.ts` | Owner mode calls `getBranchCommits` with `viewer.id`; three branch copies of the same SHA produce `totals.commits === 1` and `days[that date].count === 1`; a different login does not call `listOwnerRepos` or `getBranchCommits`; remaining 199 with zero commits kept returns `RATE_LIMITED` and does not call `getBranchCommits`; remaining 199 after one kept commit starts no further repo or history page, returns `partial: true`, and still contains that commit; a client `RATE_LIMITED` result after one kept commit returns `partial: true` with that commit; a `getBranchCommits` result that skips a forbidden repo still returns the other repos' commits; with `now` fixed, a commit dated the day before the grid start is not in `days` or `totals` |
| `tests/unit/services/handle-message.test.ts` | The viewer's own login returns `Contributions`; another login returns `{ viewerLogin }`; the deps reach `getContributions` unchanged |

Fixture JSON for the mapper lives in `tests/fixtures/branch-history.json` with no token and no private names that are not obviously fake (`acme/widgets`).

## File Map

```text
src/
├── messaging/
│   └── protocol.ts                                 (update)
│       ├── ~ Response success union
│       └── + KEEPALIVE_PORT, KeepalivePing
├── services/
│   ├── concurrency.ts                              (create)
│   │   └── + mapPool
│   ├── contributions.ts                            (create)
│   │   └── + getContributions
│   ├── handle-message.ts                           (update)
│   │   └── ~ call getContributions with now and timeZone
│   └── github/
│       ├── client.ts                               (update)
│       │   ├── + listOwnerRepos
│       │   └── + getBranchCommits
│       ├── queries.ts                              (update)
│       │   ├── + OWNER_REPOS
│       │   ├── + BRANCH_COMMITS
│       │   └── + BRANCH_HISTORY
│       └── mappers.ts                              (update)
│           ├── + mapRepos
│           └── + mapBranchCommits
├── entrypoints/
│   ├── background.ts                               (update)
│   │   ├── ~ build client, getToken, now, timeZone once
│   │   └── + onConnect listener for the keepalive port
│   └── github-profile.content/
│       └── index.ts                                (update)
│           ├── ~ log the commit total for a Contributions response
│           └── + keepalive port, pinged every 20 seconds
CLAUDE.md                                           (update)
    └── ~ section 7: GitHubClient port methods as built (getViewer, listOwnerRepos, getBranchCommits)
tests/
├── fixtures/
│   └── branch-history.json                         (create)
└── unit/
    └── services/
        ├── concurrency.test.ts                     (create)
        ├── contributions.test.ts                   (create)
        ├── handle-message.test.ts                  (update)
        └── github/
            ├── client.test.ts                      (update)
            └── mappers.test.ts                     (update)
```

`listOwnerRepos` uses `affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]`, `isFork: false`, `orderBy: { field: PUSHED_AT, direction: DESC }`, `first: 50`, and follows `pageInfo`. It selects `name`, `owner { login }`, `isPrivate`, `isFork`, `pushedAt`, and `rateLimit { remaining resetAt }`. Because the list is newest-pushed first, it stops at the first repository whose `pushedAt` is before `since` and requests no further pages. A partial result therefore holds the most recently active repositories. `mapRepos` drops forks.

A GraphQL response with `data` and `errors` is used, not rejected. A repository that comes back `null`, or whose path appears in an error of type `FORBIDDEN` or `NOT_FOUND`, is skipped and adds no commits. Its name is not logged.

`getViewer` runs first. Owner mode is `profileLogin.toLowerCase() === viewer.login.toLowerCase()`. Any other login returns `{ viewerLogin }` and does not call `listOwnerRepos` or `getBranchCommits`.

Civil today is `localDay(now().toISOString(), timeZone)`. `since` is `gridDays(today)[0]` at 00:00:00 in `timeZone`, encoded as an ISO timestamp with the zone offset.

`getBranchCommits` uses `refs(refPrefix: "refs/heads/", first: 50, after: $refCursor)`. When a branch history has `hasNextPage`, `BRANCH_HISTORY` continues with variables `$qualifiedName` (`"refs/heads/" + name`), `$author`, `$since`, and `$cursor`, and `history(first: 100)`. The author filter is `{ id: viewer.id }`.

Pipeline: concatenate the kept commits, then `dedupeCommits`, then `policyFor('owner')` (drop a repo when `includeRepo` is false, then `present`), then `inGridYear(…, gridDays(today), timeZone)`, then `aggregateByDay`. `days[date].commits` is the commits counted into that day.

After every GraphQL response, store `remaining` and `resetAt`. If `remaining < 200` and no commit has been kept, return `{ ok: false, error: 'RATE_LIMITED', resetAt }` and send nothing else. If at least one commit has been kept, start no further repo, ref page, or history page, wait for the in-flight repo tasks (at most 4), and set `partial: true`. A client `RATE_LIMITED` (for example a 403 or 429) or `NETWORK` result after at least one commit was kept is handled the same way: `partial: true` with the commits kept. Before any commit is kept, that result is returned as the failure.

Keepalive: before `sendMessage`, the content script opens `browser.runtime.connect({ name: KEEPALIVE_PORT })` and posts `{ type: 'PING' }` on it every 20 seconds. It stops the timer and disconnects when the response arrives, when it errors, or on `turbo:load`. `background.ts` accepts ports named `KEEPALIVE_PORT` from its own extension id, ignores their messages, and does nothing else. `protocol.ts` exports `KEEPALIVE_PORT = 'keepalive'` and `type KeepalivePing = { type: 'PING' }`. The port carries no data.

This phase is at its size limit. Put new findings in a follow-up, not here.

## Task Order

1. **Queries and mappers** — Add the repo and history queries, the history cursor query, the client paging tests, and the mapper tests from the fixture.
2. **Pipeline** — Add `mapPool` with its tests and `getContributions` for the owner match with the service tests. Wire it from `handleGetContributions` with the injected deps, and update CLAUDE.md section 7.
3. **Page** — Log the commit total from a `Contributions` response and add the keepalive port.

## Subagent Takeaways

- **plan-simplifier**: Trimmed repeated no-fetch wording in the acceptance criteria. Left the rate-limit rule in the pipeline paragraph.
- **plan-scope-guard**: No material findings. Three tasks and thirteen files.
- **plan-scrutinizer**: The author filter uses `viewer.id`. Every GraphQL response checks the 200-point budget, including history pages. Another profile does not trigger a `user(login)` query in this phase. A second pass added the `dedupeCommits` and `aggregateByDay` step so three copies of one SHA count once.
- **plan-compliance-audit**: No material findings. GitHub access stays in `src/services/github/`.
- **plan-review (2026-11-12)**: The keepalive port moved here from the cache phase, with a 20-second ping, because this is the first long fetch. Repos are listed newest-pushed first and stop at the grid start, so large organizations don't drain the budget. A forbidden or `null` repository is skipped instead of failing the request. Commits outside the grid year are dropped before aggregation. A client rate limit or network error after a kept commit is `partial: true`.
- **plan-simplifier (rerun 2026-11-12)**: `client.test.ts` is `(update)`, not `(create)`; the auth phase creates it. Removed restated `NOT_FOUND` and Chrome 114 wording.
- **plan-scope-guard (rerun 2026-11-12)**: The review additions pushed this phase to 15 files. Extra commit emails moved to the merged-PRs phase, which already matches commits by email, to make room for the scrutinizer's tests. Now 16 files and full.
- **plan-scrutinizer (rerun 2026-11-12)**: `now` and `timeZone` are injected here instead of in the cache phase, so the grid-year test is deterministic. Added `concurrency.test.ts` for `mapPool`. `handle-message.ts` and its test are in the File Map. Failure output is specified.
- **plan-compliance-audit (rerun 2026-11-12)**: The total is logged instead of drawn from the entrypoint, so no UI lives outside `src/ui/` and `createShadowRootUi`; the heatmap phase adds the first UI. The grid-year filter calls core `inGridYear`. CLAUDE.md section 7 records the client methods as built.
