# Plan: Owner Branch Commits

Date: 2026-11-12
Status: Pending

## Summary

When the viewer's own profile graph scrolls into view, fetch that person's commits on every non-fork branch and show the count. Done means the page shows one number for the year, the same SHA is counted once, and a short rate-limit budget stops the fetch without throwing away the commits already gathered.

## Acceptance Criteria

- On the viewer's own profile, the graph shows a line "N commits across all branches" for the grid year.
- A commit present on three branches counts once.
- Another profile is not fetched and still only logs the viewer login from the previous phase. `NOT_FOUND` is only for a GitHub user that does not exist.
- Repositories that are forks are not queried.
- If rate-limit points fall below 200 after at least one commit was kept, the line still renders and the returned `Contributions.partial` is true. If the first request cannot run because of the limit, the page gets `RATE_LIMITED` and `resetAt`.
- The options page can save extra commit emails. Those emails are sent only as the GraphQL author filter, in owner mode.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

Owner mode only, and only when the profile login equals `viewer.login`. The content script receives full `Commit` objects for that case. The displayed line uses `totals.commits` and does not print repository names. No cache yet.

## Messages

`GET_CONTRIBUTIONS` success `data` becomes `Contributions` when the profile is the viewer. When it is not, `data` stays `{ viewerLogin: string }`. This phase does not return `NOT_FOUND` and does not query `user(login)`. `RATE_LIMITED` includes `resetAt`. `handleGetContributions` returns the pipeline `Response` unchanged.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/services/github/mappers.test.ts` | A branch history node becomes a `Commit` with `source: 'branch'`; a missing `target` is skipped; `isFork: true` is not returned from `mapRepos` |
| `tests/unit/services/github/client.test.ts` | A second refs page and a second history page are requested when `hasNextPage` is true, and the later SHA is kept; the history follow-up uses the same author id and `since`; the branch name is a variable, not interpolated |
| `tests/unit/services/contributions.test.ts` | Owner mode calls `getBranchCommits` with `viewer.id` and, when emails are saved, again with those emails; three branch copies and one email-pass copy of the same SHA produce `totals.commits === 1` and `days[that date].count === 1`; a different login does not call `listOwnerRepos` or `getBranchCommits`; remaining 199 with zero commits kept returns `RATE_LIMITED` and does not call `getBranchCommits`; remaining 199 after one kept commit starts no further repo or history page, returns `partial: true`, and still contains that commit |
| `tests/unit/services/settings.test.ts` | `setCommitEmails` round-trips; the default is an empty list |

Fixture JSON for the mapper lives in `tests/fixtures/branch-history.json` with no token and no private names that are not obviously fake (`acme/widgets`).

## File Map

```text
src/
├── messaging/
│   └── protocol.ts                                 (update)
│       └── ~ Response success union
├── services/
│   ├── settings.ts                                 (update)
│   │   └── + getCommitEmails, setCommitEmails
│   ├── concurrency.ts                              (create)
│   │   └── + mapPool
│   ├── contributions.ts                            (create)
│   │   └── + getContributions
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
│   │   └── ~ pass client, settings, and time zone into getContributions
│   ├── options/
│   │   └── main.tsx                                (update)
│   │       └── + email list field
│   └── github-profile.content/
│       └── index.ts                                (update)
│           └── ~ render the commit total for a Contributions response
tests/
├── fixtures/
│   └── branch-history.json                         (create)
└── unit/
    └── services/
        ├── contributions.test.ts                   (create)
        ├── settings.test.ts                        (update)
        └── github/
            ├── client.test.ts                      (create)
            └── mappers.test.ts                     (update)
```

`listOwnerRepos` uses `affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]`, `isFork: false`, `first: 50`, and follows `pageInfo`. It selects `name`, `owner { login }`, `isPrivate`, `isFork`, and `rateLimit { remaining resetAt }`. `mapRepos` drops forks.

`getViewer` runs first. Owner mode is `profileLogin.toLowerCase() === viewer.login.toLowerCase()`. Any other login returns `{ viewerLogin }` and does not call `listOwnerRepos` or `getBranchCommits`.

Civil today is the `YYYY-MM-DD` of the worker clock in `Intl.DateTimeFormat().resolvedOptions().timeZone`, not UTC. `since` is `gridDays(today)[0]` at 00:00:00 in that zone, encoded as an ISO timestamp with the zone offset.

`getBranchCommits` uses `refs(refPrefix: "refs/heads/", first: 50, after: $refCursor)`. When a branch history has `hasNextPage`, `BRANCH_HISTORY` continues with variables `$qualifiedName` (`"refs/heads/" + name`), `$author`, `$since`, and `$cursor`, and `history(first: 100)`. Each repository is fetched twice when emails are saved: `author: { id: viewer.id }`, then `author: { emails }` for the non-blank saved emails. Emails are not logged and are not copied onto `Commit`.

Concatenate the kept commits, then `dedupeCommits`, then `policyFor('owner')` (drop a repo when `includeRepo` is false, then `present`), then `aggregateByDay` in the worker time zone. `totals` and `days` are that result. `days[date].commits` is the commits counted into that day. One SHA returned for three branches, or for both the id pass and the email pass, adds 1 to `totals.commits`.

After every GraphQL response, store `remaining` and `resetAt`. If `remaining < 200` and no commit has been kept, return `{ ok: false, error: 'RATE_LIMITED', resetAt }` and send nothing else. If at least one commit has been kept, start no further repo, ref page, or history page, wait for the in-flight repo tasks (at most 4), and set `partial: true`. The page renders `N commits across all branches` from `totals.commits` whenever `ok` is true, including when `partial` is true. `RATE_LIMITED` does not render a zero total.

## Task Order

1. **Queries and mappers** — Add the repo and history queries, the history cursor query, and the mapper tests from the fixture.
2. **Pipeline** — Add `getContributions` for the owner match, with the pool and the service tests. Wire it from `handleGetContributions`.
3. **Page and emails** — Save extra emails on the options page and render the commit total from a `Contributions` response.

## Subagent Takeaways

- **plan-simplifier**: Trimmed repeated no-fetch wording in the acceptance criteria. Left the rate-limit rule in the pipeline paragraph.
- **plan-scope-guard**: No material findings. Three tasks and thirteen files.
- **plan-scrutinizer**: The author filter uses `viewer.id`. Every GraphQL response checks the 200-point budget, including history pages. Another profile does not trigger a `user(login)` query in this phase. A second pass added the `dedupeCommits` and `aggregateByDay` step so three copies of one SHA count once.
- **plan-compliance-audit**: No material findings. GitHub access stays in `src/services/github/`.
