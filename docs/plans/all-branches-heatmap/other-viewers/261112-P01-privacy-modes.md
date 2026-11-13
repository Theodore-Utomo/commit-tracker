# Plan: Public-Only for Other Profiles

Date: 2026-11-12
Status: Pending

## Summary

Opening someone else's profile should show their public commits across branches, and nothing from a private repository. Done means a private repo cannot change the count or the tooltip text, and the viewer's own profile still uses owner mode.

## Acceptance Criteria

- When the profile login equals the viewer login, the mode is `owner` and private repos are included.
- When the logins differ, the mode is `publicOnly`. Private repositories are not listed and cannot appear in `days`.
- `restrictedContributionsCount` is requested and then ignored. A non-zero value still selects `publicOnly`.
- A cache entry written in `owner` mode is not returned for `publicOnly`, even for the same profile login.
- A `publicOnly` result is cached through the same path, under its own key `{ viewerLogin, profileLogin, mode: 'publicOnly', schemaVersion: 1 }`. A `partial: true` result is still not written.
- The heatmap heading is still `All commits across branches`.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

`resolveMode` returns `owner` or `publicOnly` only. Compare logins with `toLowerCase()`. `publicPlusCounts` stays unselected. After the `NO_TOKEN` check and before any repo fetch, call `getViewerAndUser`. The branch author filter is `{ id: user.id }` from the profile user, not the viewer's id. For `publicOnly`, paginate `user.repositories(privacy: PUBLIC, isFork: false)` and `repositoriesContributedTo(privacy: PUBLIC)` with `first: 50`. Drop forks and any repo `policyFor('publicOnly').includeRepo` rejects. Do not pass saved emails. For `publicOnly` only, call `getMergedPrCommits` with `author:<login> is:pr is:merged is:public merged:>=<since>` and do not pass saved emails. `<login>` is `user.login` as GitHub returned it, never the URL text, and must match `LOGIN_PATTERN`. Owner mode keeps `author:<login> is:pr is:merged merged:>=<since>` with no `is:public`, and still passes saved emails. `since` stays the grid start on a miss and the cache phase's overlap window on a hit. Present with `policyFor(mode)`, apply the grid-year filter, then `aggregateByDay`. Forbidden or `null` repositories are skipped as in owner mode. Reuse `mapPool` and the same below-200 stop.

The manual check, not a code branch: with a token that can see a friend's private contributions, open their profile once with Private contributions on and once off, and record whether `restrictedContributionsCount` tracks the toggle. Write the result into CLAUDE.md section 3 in that same change if it is conclusive. Do not flip the mode in this phase.

## Messages

No new message. `Contributions.mode` is `owner` or `publicOnly`. The `{ viewerLogin }` success shape is removed. Every profile that GitHub knows returns `Contributions`. An unknown login is `NOT_FOUND`.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/services/privacy-mode.test.ts` | Equal logins return `owner`; different logins return `publicOnly` even when `restrictedContributionsCount` is greater than 0 |
| `tests/unit/services/contributions.test.ts` | A different login calls `listPublicRepos` and not `listOwnerRepos`; the author id is the profile user's id; `Octocat` versus viewer `octocat` still calls `listOwnerRepos`; saved emails are not passed; the merged-PR query uses `user.login` from `getViewerAndUser`, not the request's `login`; the public merged-PR query contains `is:public` and a private pull-request commit is absent from `days`; an owner merged-PR query does not contain `is:public`, and a private owner pull-request commit remains in `days`; a `publicOnly` result calls `put` with `mode: 'publicOnly'`, and a stored `owner` entry for the same profile is not read |
| `tests/unit/services/github/mappers.test.ts` | A contributed-to node maps to a `RepoRef`; `isFork: true` is dropped |

## File Map

```text
src/
├── services/
│   ├── privacy-mode.ts                             (create)
│   │   └── + resolveMode
│   ├── contributions.ts                            (update)
│   │   └── ~ branch on resolveMode
│   └── github/
│       ├── client.ts                               (update)
│       │   ├── + getViewerAndUser
│       │   └── + listPublicRepos
│       ├── queries.ts                              (update)
│       │   ├── + VIEWER_AND_USER
│       │   └── + PUBLIC_REPOS
│       └── mappers.ts                              (update)
│           └── + mapContributedRepos
├── entrypoints/
│   └── github-profile.content/
│       └── index.tsx                               (update)
│           └── ~ draw the heatmap for publicOnly too
tests/
└── unit/
    └── services/
        ├── privacy-mode.test.ts                    (create)
        ├── contributions.test.ts                   (update)
        └── github/
            └── mappers.test.ts                     (update)
```

`VIEWER_AND_USER` is the query in CLAUDE.md section 10, including `restrictedContributionsCount` and `rateLimit`. Replace `getViewer` with `getViewerAndUser`. Do not keep both.

## Task Order

1. **Mode** — Add `resolveMode` and its tests. Wire `VIEWER_AND_USER`.
2. **Public repos** — Add `listPublicRepos` and the mapper case. Use it from `getContributions` when the mode is `publicOnly`, with `{ id }` as the only author filter.
3. **Page** — Draw the heatmap for a `publicOnly` response. Delete the `{ viewerLogin }` branch from the protocol and the content script.

## Subagent Takeaways

- **plan-simplifier**: Replaced the either/or around `getViewer` with one method, `getViewerAndUser`.
- **plan-scope-guard**: No material findings. Turning on `publicPlusCounts` stays unwritten.
- **plan-scrutinizer**: Other profiles use the profile user's id, not the viewer's. Merged pull requests add `is:public` only in `publicOnly`, and saved emails are not sent. Login comparison ignores case. A second pass kept `is:public` off the owner's search so private squash-merged commits stay.
- **plan-compliance-audit**: No material findings. `publicPlusCounts` is still not selected.
- **plan-review (2026-11-12)**: The public search uses `user.login` from GitHub, not the URL text. `since` on a hit follows the cache phase's 14-day overlap. The grid-year filter and the forbidden-repository skip apply here too. A later pass made `publicOnly` caching explicit: it is written under its own mode key, since the cache phase only described `owner`.
