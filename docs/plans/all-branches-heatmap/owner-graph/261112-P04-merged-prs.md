# Plan: Squash-Merge Recovery

Date: 2026-11-12
Status: Pending

## Summary

Commits that were squash-merged disappear from the branch list once the branch is deleted. This phase also reads the commits on merged pull requests and keeps the ones this user authored. Done means a commit that exists only on a merged pull request shows up in the count and, after the heatmap phase, in the squares.

## Acceptance Criteria

- A commit the fake client returns only from a merged pull request is included, with `source: 'pr'` and no branch name.
- The same SHA from a branch and from a pull request is stored once, as the branch copy.
- A pull-request commit whose author login is someone else is dropped. In owner mode, a commit with no linked user is kept when its author email is one of the saved emails.
- The search window is the same grid year as the branch fetch (`merged:>=<grid start>`).
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

Owner mode only. Pull-request commits go through `dedupeCommits` and then `policyFor('owner')` with everything else. The content script still receives only the finished `Contributions` object.

## Messages

No protocol change.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/services/github/mappers.test.ts` | A pull-request commit node becomes `source: 'pr'`; a node whose `author.user.login` differs from the profile is omitted; a null user with a matching email is kept |
| `tests/unit/services/contributions.test.ts` | The pipeline includes a SHA that only `getMergedPrCommits` returns; a SHA returned by both methods survives once and keeps `source: 'branch'`; the search string uses `viewer.login`; a pull-request commit authored before the grid start is not counted |

## File Map

```text
src/
├── services/
│   ├── contributions.ts                            (update)
│   │   └── ~ call getMergedPrCommits after the branch pool
│   └── github/
│       ├── client.ts                               (update)
│       │   └── + getMergedPrCommits
│       ├── queries.ts                              (update)
│       │   ├── + MERGED_PR_COMMITS
│       │   └── + PR_COMMITS
│       └── mappers.ts                              (update)
│           └── + mapMergedPrCommits
tests/
├── fixtures/
│   └── merged-pr-commits.json                      (create)
└── unit/
    └── services/
        ├── contributions.test.ts                   (update)
        └── github/
            └── mappers.test.ts                     (update)
```

`getMergedPrCommits` runs only inside the owner match, and only when the branch phase has not already stopped for rate limit.

Search query: `author:<login> is:pr is:merged merged:>=<gridDays(today)[0]>`. `<login>` is `viewer.login` as GitHub returned it, never the URL text, and must match `LOGIN_PATTERN`. If it does not, skip the search. `MERGED_PR_COMMITS` pages `search(first: 25, after: $cursor)` and selects `rateLimit { remaining resetAt }`, `repository { owner { login } name isPrivate isFork }`, `number`, and `commits(first: 100) { pageInfo { hasNextPage endCursor } nodes { commit { oid authoredDate messageHeadline author { email user { login } } } } }`.

When `commits.pageInfo.hasNextPage` is true, `PR_COMMITS` continues that pull request with `$owner`, `$name`, `$number`, and `$cursor` on `pullRequest(number:) { commits(first: 100, after: $cursor) }`. After every search or commit page, use the same budget rule as branch commits. A rate-limit or network failure after any commit was kept becomes `partial: true` and keeps those commits. It does not replace them with `RATE_LIMITED`. A pull request whose `repository` is `null`, or that a `FORBIDDEN` error points at, is skipped like a forbidden branch repository.

`mapMergedPrCommits(nodes, profileLogin, savedEmails)` keeps a commit when `author.user.login` equals the profile login ignoring case, or when `author.user` is null and `author.email` matches a saved email ignoring case. It drops a null author, a different login, and a null user with no email match. Emails are not copied onto `Commit`. `source` is `'pr'` and `branch` is omitted.

Branch commits and these commits are concatenated, then `dedupeCommits`, then `policyFor('owner')`: drop the commit when `includeRepo` is false, then `present`. Then apply the grid-year filter from the branch-commits phase, since a pull request merged this year can hold commits authored earlier. `aggregateByDay` then fills `totals` and `days`. A SHA that appears on a branch and on a pull request adds 1. The fixture uses a fake email such as `dev@example.com` and contains no token.

## Task Order

1. **Mapper** — Add the merged-PR query, cursor follow-up, and mapper tests from the fixture.
2. **Pipeline** — Call it from `getContributions` before dedupe, and add the two pipeline cases.

## Subagent Takeaways

- **plan-simplifier**: No material findings.
- **plan-scope-guard**: No material findings. Two tasks and seven files.
- **plan-scrutinizer**: Added `PR_COMMITS` for nested commit pages. A rate limit after branch commits were kept returns those commits with `partial: true`. The mapper receives the profile login and the saved emails, and forks are dropped by `includeRepo`. `aggregateByDay` runs after dedupe so a shared SHA still counts once.
- **plan-compliance-audit**: No material findings.
- **plan-review (2026-11-12)**: The search string is built from `viewer.login` and checked against `LOGIN_PATTERN`. Pull-request commits go through the grid-year filter, and forbidden repositories are skipped.
