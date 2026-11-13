# Plan: Public-Only for Other Profiles

Date: 2026-11-12
Status: Pending

## Summary

Opening someone else's profile should show their public commits across branches, and nothing from a private repository. Done means a private repo cannot change the count or the tooltip text, and the viewer's own profile still uses owner mode.

## Acceptance Criteria

- When the profile login equals the viewer login, the mode is `owner` and private repos are included.
- When the logins differ, the mode is `publicOnly`. Private repositories are not listed and cannot appear in `days`.
- `restrictedContributionsCount` is requested and then ignored. A non-zero value still selects `publicOnly`.
- A login GitHub does not know (`user: null`) returns `NOT_FOUND` and makes no repo, history, or search call.
- A cache entry written in `owner` mode is not returned for `publicOnly`, even for the same profile login.
- A `publicOnly` result is cached through the same path, under its own key `{ viewerLogin, profileLogin, mode: 'publicOnly', schemaVersion: 1 }`. A `partial: true` result is still not written.
- `contributions.ts` contains no comparison against a mode name. It reads the policy's fields instead.
- The heatmap heading is still `All commits across branches`.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.
- `pnpm test:e2e` also opens a public profile that is not the viewer's, accepts the prompt, and finds the heading.

## Privacy

`resolveMode(viewerLogin, profileLogin)` returns `owner` or `publicOnly` only. It compares logins with `toLowerCase()`. `publicPlusCounts` stays unselected. After the `NO_TOKEN` check and before any repo fetch, call `getViewerAndUser`. If `user` is `null`, return `NOT_FOUND`.

Each `PrivacyPolicy` gains the fields the pipeline needs, so the pipeline never branches on the mode itself (CLAUDE.md section 7):

| Field | `owner` | `publicOnly` |
| --- | --- | --- |
| `repoSource` | `'viewerAffiliated'` (`listOwnerRepos`) | `'userPublic'` (`listPublicRepos`) |
| `authorId` | `viewer.id` | `user.id`, the profile user's id |
| `useSavedEmails` | `true` | `false` |
| `prSearchQualifiers` | `''` | `' is:public'` |

`listPublicRepos` paginates `user.repositories(privacy: PUBLIC, isFork: false, orderBy: { field: PUSHED_AT, direction: DESC })` and `repositoriesContributedTo(privacy: PUBLIC, orderBy: { field: PUSHED_AT, direction: DESC })` with `first: 50`. Each stops at the first repository whose `pushedAt` is before `since`, and `PUBLIC_REPOS` selects `isPrivate`, `isFork`, and `pushedAt`. Drop forks and any repo `policy.includeRepo` rejects.

The merged-PR search is `author:<login> is:pr is:merged<prSearchQualifiers> merged:>=<since>`. `<login>` is `user.login` as GitHub returned it, never the URL text, and must match `LOGIN_PATTERN`. Saved emails are passed only when `useSavedEmails` is true. `since` is the grid start on a miss and the cache phase's overlap window on a hit. The in-flight key from the cache phase uses the mode `resolveMode` returns.

The manual check, not a code branch: with a token that can see a friend's private contributions, open their profile once with Private contributions on and once off, and record whether `restrictedContributionsCount` tracks the toggle. If the result is conclusive, write it into CLAUDE.md section 3 in that same change. Do not flip the mode in this phase.

## Messages

No new message. `Contributions.mode` is `owner` or `publicOnly`. The `{ viewerLogin }` success shape is removed from `protocol.ts` and the content script. Every profile that GitHub knows returns `Contributions`. An unknown login is `NOT_FOUND`.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/core/privacy.test.ts` | `resolveMode` returns `owner` for equal logins and for `Octocat` versus `octocat`; it returns `publicOnly` for different logins; the `owner` and `publicOnly` policies have the field values in the table above |
| `tests/unit/services/contributions.test.ts` | A different login calls `listPublicRepos` and not `listOwnerRepos`; the author id is the profile user's id; `Octocat` versus viewer `octocat` still calls `listOwnerRepos`; saved emails are not passed for `publicOnly`; `user: null` returns `NOT_FOUND` and does not call `listPublicRepos`; the merged-PR query uses `user.login` from `getViewerAndUser`, not the request's `login`; the public merged-PR query contains `is:public` and a private pull-request commit is absent from `days`; an owner merged-PR query does not contain `is:public`, and a private owner pull-request commit remains in `days`; a `publicOnly` result calls `put` with `mode: 'publicOnly'`, and a stored `owner` entry for the same profile is not read |
| `tests/unit/services/github/client.test.ts` | `getViewerAndUser` sends `$login` as a variable; a second page of `repositories` and of `repositoriesContributedTo` is requested when `hasNextPage`; paging stops at the first repo whose `pushedAt` is before `since`; the `getViewer` tests from the auth phase are removed in the same change |
| `tests/unit/services/github/mappers.test.ts` | A contributed-to node maps to a `RepoRef`; `isFork: true` is dropped; `user: null` maps to a not-found result |
| `tests/unit/services/handle-message.test.ts` | A request for another profile and a request for the viewer's own profile do not share an in-flight promise |

## File Map

```text
src/
├── core/
│   └── privacy.ts                                  (update)
│       ├── + resolveMode
│       └── + repoSource, authorId, useSavedEmails, prSearchQualifiers on each policy
├── messaging/
│   └── protocol.ts                                 (update)
│       └── - { viewerLogin } success shape
├── services/
│   ├── contributions.ts                            (update)
│   │   └── ~ read the policy fields instead of branching on mode
│   └── github/
│       ├── client.ts                               (update)
│       │   ├── ~ getViewer → getViewerAndUser
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
CLAUDE.md                                           (update)
    ├── ~ section 7: GitHubClient port and PrivacyPolicy fields as built
    └── ~ section 3: manual-check result, only if conclusive
tests/
├── e2e/
│   └── other-profile.spec.ts                       (create)
└── unit/
    ├── core/
    │   └── privacy.test.ts                         (update)
    └── services/
        ├── contributions.test.ts                   (update)
        ├── handle-message.test.ts                  (update)
        └── github/
            ├── client.test.ts                      (update)
            └── mappers.test.ts                     (update)
```

`VIEWER_AND_USER` is the query in CLAUDE.md section 10, including `restrictedContributionsCount` and `rateLimit`. Replace `getViewer` with `getViewerAndUser`. Do not keep both.

`other-profile.spec.ts` reuses the token rules from `own-profile.spec.ts` (traces, screenshots, and video off; a temporary profile directory; the token never printed). It opens `https://github.com/octocat`, skips when the viewer is `octocat`, accepts the prompt, and expects the heading.

## Task Order

1. **Mode** — Add `resolveMode` and the policy fields to `src/core/privacy.ts` with their tests. Wire `VIEWER_AND_USER` and the `NOT_FOUND` case, replacing the `getViewer` tests.
2. **Public repos** — Add `listPublicRepos` with its client and mapper tests. Make `getContributions` read the policy fields, with the pipeline and handler tests. Update CLAUDE.md section 7.
3. **Page** — Draw the heatmap for a `publicOnly` response. Delete the `{ viewerLogin }` branch from the protocol and the content script. Add `other-profile.spec.ts`.

## Subagent Takeaways

- **plan-simplifier**: Replaced the either/or around `getViewer` with one method, `getViewerAndUser`.
- **plan-scope-guard**: No material findings. Turning on `publicPlusCounts` stays unwritten.
- **plan-scrutinizer**: Other profiles use the profile user's id, not the viewer's. Merged pull requests add `is:public` only in `publicOnly`, and saved emails are not sent. Login comparison ignores case. A second pass kept `is:public` off the owner's search so private squash-merged commits stay.
- **plan-compliance-audit**: No material findings. `publicPlusCounts` is still not selected.
- **plan-review (2026-11-12)**: The public search uses `user.login` from GitHub, not the URL text. `since` on a hit follows the cache phase's 14-day overlap. `publicOnly` results are cached under their own mode key.
- **plan-simplifier (rerun 2026-11-12)**: `resolveMode` moved into `src/core/privacy.ts` beside `policyFor`. That drops `src/services/privacy-mode.ts` and its test file.
- **plan-scope-guard (rerun 2026-11-12)**: In scope at 14 files. Added `protocol.ts` and CLAUDE.md to the File Map; both were edited but not listed. Added an end-to-end check on someone else's profile, where the privacy rule matters most.
- **plan-scrutinizer (rerun 2026-11-12)**: `user: null` now maps to `NOT_FOUND` before any fetch. Added client tests for the new methods. `listPublicRepos` uses the same `pushedAt` order and stop as the owner list. `PUBLIC_REPOS` selects `isPrivate`.
- **plan-compliance-audit (rerun 2026-11-12)**: The pipeline no longer branches on mode. The per-mode repo source, author id, email use, and search qualifier are policy fields, as CLAUDE.md section 7 requires. The in-flight key includes the resolved mode.
