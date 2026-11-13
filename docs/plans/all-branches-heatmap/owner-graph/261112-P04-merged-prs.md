# Plan: Squash-Merge Recovery and Extra Emails

Date: 2026-11-12
Status: Pending

## Summary

Commits that were squash-merged disappear from the branch list once the branch is deleted, and commits made with an email that isn't linked to the GitHub account don't match the author id. This phase reads the commits on merged pull requests and adds a list of extra commit emails, so both kinds of work are counted. Done means a commit that exists only on a merged pull request, or only under an extra email, shows up in the total and, after the heatmap phase, in the squares.

## Acceptance Criteria

- A commit the fake client returns only from a merged pull request is included, with `source: 'pr'` and no branch name.
- The same SHA from a branch and from a pull request is stored once, as the branch copy.
- A pull-request commit whose author login is someone else is dropped. In owner mode, a commit with no linked user is kept when its author email is one of the saved emails.
- The options page can save extra commit emails. In owner mode each repository's branches are fetched a second time with `author: { emails }`. Those emails are sent only as GraphQL author filters, in owner mode.
- The search window is the same grid year as the branch fetch (`merged:>=<grid start>`).
- A rate limit or network failure during the pull-request search, after branch commits were kept, returns `partial: true` with those commits.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

Owner mode only. Pull-request commits and email-pass commits go into the same pipeline as branch commits. The content script still receives only the finished `Contributions` object. Emails are not logged and are not copied onto `Commit`.

## Messages

No protocol change.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/services/github/mappers.test.ts` | A pull-request commit node becomes `source: 'pr'`; a node whose `author.user.login` differs from the profile is omitted; a null user with a matching email is kept |
| `tests/unit/services/github/client.test.ts` | With `search.pageInfo.hasNextPage`, a second search page is requested; with `commits.pageInfo.hasNextPage`, `PR_COMMITS` is called with `$owner`, `$name`, `$number`, and `$cursor`; a `null` repository or a `FORBIDDEN` error skips only that pull request; a `viewer.login` that fails `LOGIN_PATTERN` makes no search request; `getBranchCommits` with `author: { emails }` sends the emails as a variable |
| `tests/unit/services/contributions.test.ts` | The pipeline includes a SHA that only `getMergedPrCommits` returns; a SHA returned by both methods survives once and keeps `source: 'branch'`; the search string uses `viewer.login`; a pull-request commit authored before the grid start is not counted; with saved emails, `getBranchCommits` is called again with those emails, and a SHA from both the id pass and the email pass counts once; the search returning `RATE_LIMITED` after one branch commit was kept gives `partial: true` with that commit; a branch phase that ended `partial` does not call `getMergedPrCommits` |
| `tests/unit/services/settings.test.ts` | `setCommitEmails` round-trips; the default is an empty list; blank entries are dropped |

## File Map

```text
src/
├── services/
│   ├── settings.ts                                 (update)
│   │   └── + getCommitEmails, setCommitEmails
│   ├── contributions.ts                            (update)
│   │   ├── ~ email pass after the id pass
│   │   └── ~ call getMergedPrCommits after the branch pool
│   └── github/
│       ├── client.ts                               (update)
│       │   └── + getMergedPrCommits
│       ├── queries.ts                              (update)
│       │   ├── + MERGED_PR_COMMITS
│       │   └── + PR_COMMITS
│       └── mappers.ts                              (update)
│           └── + mapMergedPrCommits
├── entrypoints/
│   ├── background.ts                               (update)
│   │   └── ~ pass getCommitEmails into the deps
│   └── options/
│       └── main.tsx                                (update)
│           └── + email list field
tests/
├── fixtures/
│   └── merged-pr-commits.json                      (create)
└── unit/
    └── services/
        ├── contributions.test.ts                   (update)
        ├── settings.test.ts                        (update)
        └── github/
            ├── client.test.ts                      (update)
            └── mappers.test.ts                     (update)
```

**Extra emails.** `getContributions` gains a `getCommitEmails` dep. When the saved list has non-blank entries, each repository is fetched a second time with `author: { emails }` after the `author: { id: viewer.id }` pass. Both passes follow the branch-commits budget rule.

**Merged pull requests.** `getMergedPrCommits` runs only inside the owner match, and only when the branch phase has not already stopped for rate limit. Search query: `author:<login> is:pr is:merged merged:>=<gridDays(today)[0]>`. `<login>` is `viewer.login` as GitHub returned it, never the URL text, and must match `LOGIN_PATTERN`. If it does not, skip the search. `MERGED_PR_COMMITS` pages `search(first: 25, after: $cursor)` and selects `issueCount`, `rateLimit { remaining resetAt }`, `repository { owner { login } name isPrivate isFork }`, `number`, and `commits(first: 100) { pageInfo { hasNextPage endCursor } nodes { commit { oid authoredDate messageHeadline author { email user { login } } } } }`.

When `commits.pageInfo.hasNextPage` is true, `PR_COMMITS` continues that pull request with `$owner`, `$name`, `$number`, and `$cursor` on `pullRequest(number:) { commits(first: 100, after: $cursor) }`. After every search or commit page, use the same budget rule as branch commits. A rate-limit or network failure after any commit was kept becomes `partial: true` and keeps those commits. A pull request whose `repository` is `null`, or that a `FORBIDDEN` error points at, is skipped. GitHub search returns at most 1,000 results; when `issueCount` is above 1,000, set `partial: true`.

`mapMergedPrCommits(nodes, profileLogin, savedEmails)` keeps a commit when `author.user.login` equals the profile login ignoring case, or when `author.user` is null and `author.email` matches a saved email ignoring case. It drops a null author, a different login, and a null user with no email match. `source` is `'pr'` and `branch` is omitted.

These commits join the concatenation before `dedupeCommits`; the rest of the branch-commits pipeline is unchanged. `inGridYear` matters here because a pull request merged this year can hold commits authored earlier. The fixture uses a fake email such as `dev@example.com` and contains no token.

## Task Order

1. **Emails** — Add `getCommitEmails` and `setCommitEmails` with their tests, the options field, and the email pass in `getContributions` with its pipeline test.
2. **Mapper** — Add the merged-PR query, the cursor follow-up, the client paging tests, and the mapper tests from the fixture.
3. **Pipeline** — Call `getMergedPrCommits` from `getContributions` before dedupe, and add the pipeline and failure cases.

## Subagent Takeaways

- **plan-simplifier**: No material findings.
- **plan-scope-guard**: No material findings. Two tasks and seven files.
- **plan-scrutinizer**: Added `PR_COMMITS` for nested commit pages. A rate limit after branch commits were kept returns those commits with `partial: true`. The mapper receives the profile login and the saved emails, and forks are dropped by `includeRepo`. `aggregateByDay` runs after dedupe so a shared SHA still counts once.
- **plan-compliance-audit**: No material findings.
- **plan-review (2026-11-12)**: The search string is built from `viewer.login` and checked against `LOGIN_PATTERN`. Pull-request commits go through the grid-year filter, and forbidden repositories are skipped.
- **plan-simplifier (rerun 2026-11-12)**: The pipeline order is no longer restated; this phase only adds inputs to it.
- **plan-scope-guard (rerun 2026-11-12)**: In scope. Extra emails moved here from branch commits to keep that phase under its limit. Both features recover commits the author id misses, and the mapper already uses saved emails. Three tasks, 12 files.
- **plan-scrutinizer (rerun 2026-11-12)**: Added client tests for search and pull-request paging, the failure cases, and the "branch phase stopped, so no search" rule. A search capped at 1,000 results sets `partial: true`.
- **plan-compliance-audit (rerun 2026-11-12)**: The grid-year filter is the core `inGridYear`, not inline service logic.
