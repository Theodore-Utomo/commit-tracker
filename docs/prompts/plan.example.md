# Plan: Owner Heatmap From Branch Commits

> Worked example of the template in `docs/prompts/plan.md`. Reference only. Not a scheduled plan. Do not implement from this file.

Date: 2026-11-12
Status: Pending

## Summary

On your own GitHub profile, accepting the prompt replaces the usual contribution graph with one that counts commits on every branch. The same commit on several branches counts once. Done means the heatmap appears for the signed-in viewer, and another person's profile is unchanged.

## Acceptance Criteria

- On the viewer's own profile, accepting the prompt shows a 53-by-7 heatmap labeled "All commits across branches".
- A commit that sits on three branches raises that day's count by one.
- The viewer's private repositories contribute, and those days can show the repository name and message.
- Another person's profile still shows only GitHub's own graph. Nothing is fetched for them in this change.
- A missing token returns `NO_TOKEN` and the heatmap area says a token is required. The options page itself is a later change.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

This change uses `owner` only, and only when the profile login matches the token's viewer. The content script receives full commit details for that case. Cache key is `{ viewerLogin, profileLogin, mode: 'owner' }`. Other profiles are out of scope and stay `publicOnly` with no fetch.

## Messages

- `GET_CONTRIBUTIONS` with `{ login }`. Success data is `Contributions` for `mode: 'owner'`. Errors: `NO_TOKEN`, `UNAUTHORIZED`, `RATE_LIMITED`, `NOT_FOUND`, `NETWORK`, `UNKNOWN`. The worker returns `{ ok: false, error }` and does not throw.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/core/dedupe.test.ts` | The same SHA on three branches counts once; a branch record wins over a pull-request record |
| `tests/unit/services/contributions.test.ts` | Owner mode returns days keyed by local date; a missing token becomes `NO_TOKEN` without calling GitHub; a rate-limit stop sets `partial: true` |

## File Map

```text
src/
├── core/
│   ├── types.ts                              (create)
│   │   └── + Commit, Contributions, PrivacyMode
│   └── dedupe.ts                             (create)
│       └── + dedupeCommits
├── messaging/
│   └── protocol.ts                           (create)
│       └── + Request, Response, ErrorCode
├── services/
│   └── contributions.ts                      (create)
│       └── + getContributions
└── entrypoints/
    ├── background.ts                         (update)
    │   └── ~ handle GET_CONTRIBUTIONS
    └── github-profile.content/
        └── index.tsx                         (create)
            └── + mount prompt and heatmap
tests/
└── unit/
    ├── core/
    │   └── dedupe.test.ts                    (create)
    └── services/
        └── contributions.test.ts             (create)
```

Annotation legend:

- `(create)` / `(update)` / `(delete)` — file action.
- `+` add, `~` change, `-` remove — symbol action.

## Task Order

1. **Types and dedupe** — Add `Commit` and `dedupeCommits`, with the three-branch test in the same change.
2. **Message types** — Add `GET_CONTRIBUTIONS` and the `ErrorCode` union in `protocol.ts`.
3. **Owner pipeline** — Add `getContributions` for the viewer's own profile, branch commits only, with the service tests and a fake GitHub client.
4. **Worker and prompt** — Handle the message in the service worker and mount the prompt plus heatmap from the content script. The content script sends the login and renders the returned days.

## Subagent Takeaways

- **plan-simplifier**: Dropped a separate "color scale" task. The heatmap can use GitHub's existing contribution color variables, which need no new module.
- **plan-scope-guard**: No material findings. Four tasks, and the file map stays inside one pull request. Merged-PR commits and other people's profiles stay out.
- **plan-scrutinizer**: The first draft fetched before checking the token. The `NO_TOKEN` path now returns before any GitHub call, and the acceptance criteria say another person's profile is not fetched.
- **plan-compliance-audit**: Confirmed dedupe stays in `src/core/`, the GitHub call stays in the worker, and the content script only receives the finished `Contributions` object.

## Human Feedback Requested

| Location | Question / Issue |
| --- | --- |
| Task: Worker and prompt | Should a second accept on the same profile reuse the in-flight request, or is that a later change? |
