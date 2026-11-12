# Plan: Profile Graph Detection

Date: 2026-11-12
Status: Pending

## Summary

The extension currently logs a line on every GitHub page. This phase limits it to profile pages and logs the username only when the contribution graph has scrolled into view. Done means a profile logs once, and a repository page logs nothing.

## Acceptance Criteria

- On `https://github.com/<user>`, including a trailing slash, a query string, or a hash, scrolling the contribution graph at least halfway into view logs that user's login once, with the original casing.
- `/trending`, `/advisories`, and `/copilot` are in the denylist with the other non-profile routes, and they log nothing.
- `getProfileLogin` and `isProfilePage` take a full URL or a path. Both parse it with `new URL(input, "https://github.com")` and use `.pathname` only. `isProfilePage` is true exactly when `getProfileLogin` returns a string.
- Navigating between profiles with GitHub's in-page navigation logs the new login and does not keep the previous page's observer.
- If the graph markup is missing, the page is unchanged and no error is thrown.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

No commit data is fetched or displayed. No token is read.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/dom/github-page.test.ts` | A path and an absolute URL both yield `octocat`, including a query and a hash; the segment's case is preserved; `/octocat/hello-world`, `/orgs/github`, `/settings`, `/`, `/trending`, `/advisories`, and `/copilot` yield no login; `isProfilePage` matches `getProfileLogin`; `findContributionGraph(root)` returns `.js-calendar-graph-table` when the stub has it, `.js-yearly-contributions` when only that exists, and `undefined` when neither exists. The stub implements `querySelector`. No `document`. |

## File Map

```text
src/
├── dom/
│   └── github-page.ts                              (create)
│       ├── + isProfilePage
│       ├── + getProfileLogin
│       └── + findContributionGraph
└── entrypoints/
    ├── content.ts                                  (delete)
    └── github-profile.content/
        └── index.ts                                (create)
            └── + setup, teardown on turbo:load
tests/
└── unit/
    └── dom/
        └── github-page.test.ts                     (create)
```

## Task Order

1. **URL rules** — Add `isProfilePage` and `getProfileLogin` for a single path segment, rejecting the denylist, with the unit tests.
2. **Graph lookup** — Add `findContributionGraph(root)` with primary `.js-calendar-graph-table` and fallback `.js-yearly-contributions`. A miss returns `undefined`. The test passes a `querySelector` stub and does not use `document`.
3. **Content script** — `github-profile.content/index.ts` default-exports `defineContentScript({ matches: ['https://github.com/*'], main })`. Delete `content.ts`. Register one `turbo:load` listener for the life of the script. On start and on `turbo:load`, disconnect the previous observers, then run setup. Setup reads `getProfileLogin(location.href)`. If that is `undefined`, it does not observe and does not log. Otherwise it creates a `MutationObserver` on `document.documentElement` with `{ childList: true, subtree: true }`. When `findContributionGraph(document)` returns an element, disconnect the mutation observer and observe that element with an `IntersectionObserver` at threshold `0.5`. On the first entry whose `intersectionRatio` is at least `0.5`, disconnect the intersection observer and `console.log` the login once. If the graph never appears, setup leaves the page unchanged and does not throw.

Denylist, exact strings: `settings`, `orgs`, `organizations`, `marketplace`, `features`, `topics`, `collections`, `events`, `explore`, `notifications`, `login`, `signup`, `about`, `pricing`, `sponsors`, `customer-stories`, `security`, `readme`, `new`, `codespaces`, `account`, `projects`, `pulls`, `issues`, `search`, `apps`, `trending`, `advisories`, `copilot`.

During implementation, confirm the two selectors on one live profile. If GitHub has renamed them, change only `github-page.ts` and the test fixture.

## Subagent Takeaways

- **plan-simplifier**: No material findings. The denylist and the live selector check stay.
- **plan-scope-guard**: No material findings. Three tasks and four files.
- **plan-scrutinizer**: The content script now has an explicit `defineContentScript` entry, full-URL parsing, and a one-shot intersection observer. Added `/trending`, `/advisories`, and `/copilot` to the denylist.
- **plan-compliance-audit**: No material findings.
