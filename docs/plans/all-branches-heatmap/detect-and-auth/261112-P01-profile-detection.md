# Plan: Profile Graph Detection

Date: 2026-11-12
Status: Pending

## Summary

The extension currently logs a line on every GitHub page. This phase limits it to profile pages and logs the username only when the contribution graph has scrolled into view. Done means a profile logs once, and a repository page logs nothing.

## Acceptance Criteria

- On `https://github.com/<user>`, including a trailing slash, a query string, or a hash, scrolling the contribution graph at least halfway into view logs that user's login once, with the original casing.
- Routes in the denylist (Task Order) log nothing.
- `getProfileLogin` and `isProfilePage` take a full URL or a path. Both parse it with `new URL(input, "https://github.com")` and use `.pathname` only. `isProfilePage` is true exactly when `getProfileLogin` returns a string.
- A segment is a login only if it matches `^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$`. Percent-encoded text, dots, underscores, a leading or trailing hyphen, a double hyphen, and more than 39 characters all yield no login. The pattern is `LOGIN_PATTERN` in `src/core/login.ts`, a pure module, so the worker can reuse it without importing `src/dom/`. A few legacy accounts have names outside this pattern. They get no prompt, and that is accepted.
- Navigating between profiles with GitHub's in-page navigation logs the new login and does not keep the previous page's observers, including a mutation observer still waiting for a graph that never appeared.
- If the graph markup is missing, the page is unchanged and no error is thrown.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

No commit data is fetched or displayed. No token is read.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/dom/github-page.test.ts` | A path and an absolute URL both yield `octocat`, including a query and a hash; the segment's case is preserved; `/octocat/hello-world`, `/orgs/github`, `/settings`, `/`, `/trending`, `/advisories`, and `/copilot` yield no login; `/octo%20cat`, `/octo_cat`, `/octo.cat`, `/-octocat`, `/octocat-`, `/octo--cat`, and a 40-character segment yield no login, and a 39-character segment does; `isProfilePage` matches `getProfileLogin`; `findContributionGraph(root)` returns `.js-calendar-graph-table` when the stub has it, `.js-yearly-contributions` when only that exists, and `undefined` when neither exists. The stub implements `querySelector`. No `document`. |

## File Map

```text
src/
├── core/
│   └── login.ts                                    (create)
│       └── + LOGIN_PATTERN
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
CLAUDE.md                                           (update)
    └── ~ section 6: core/login.ts (LOGIN_PATTERN, shared by dom/ and services/)
tests/
└── unit/
    └── dom/
        └── github-page.test.ts                     (create)
```

## Task Order

1. **URL rules** — Add `LOGIN_PATTERN` in `src/core/login.ts`, then `isProfilePage` and `getProfileLogin` for a single path segment, rejecting the denylist and any segment that fails the pattern, with the unit tests. Add `login.ts` to CLAUDE.md section 6.
2. **Graph lookup** — Add `findContributionGraph(root)` with primary `.js-calendar-graph-table` and fallback `.js-yearly-contributions`. A miss returns `undefined`. The test passes a `querySelector` stub and does not use `document`.
3. **Content script** — `github-profile.content/index.ts` default-exports `defineContentScript({ matches: ['https://github.com/*'], main })`. Delete `content.ts`. Register one `turbo:load` listener for the life of the script. On start and on `turbo:load`, disconnect every observer from the previous setup (the mutation observer, whether or not the graph appeared, and the intersection observer), then run setup. Setup reads `getProfileLogin(location.href)`. If that is `undefined`, it does not observe and does not log. Otherwise it creates a `MutationObserver` on `document.documentElement` with `{ childList: true, subtree: true }`. When `findContributionGraph(document)` returns an element, disconnect the mutation observer and observe that element with an `IntersectionObserver` at threshold `0.5`. On the first entry whose `intersectionRatio` is at least `0.5`, disconnect the intersection observer and `console.log` the login once. If the graph never appears, setup leaves the page unchanged and does not throw.

Denylist, exact strings: `settings`, `orgs`, `organizations`, `marketplace`, `features`, `topics`, `collections`, `events`, `explore`, `notifications`, `login`, `signup`, `about`, `pricing`, `sponsors`, `customer-stories`, `security`, `readme`, `new`, `codespaces`, `account`, `projects`, `pulls`, `issues`, `search`, `apps`, `trending`, `advisories`, `copilot`.

During implementation, confirm the two selectors on one live profile. If GitHub has renamed them, change only `github-page.ts` and the test fixture.

## Subagent Takeaways

- **plan-simplifier**: No material findings. The denylist and the live selector check stay.
- **plan-scope-guard**: No material findings. Three tasks and four files.
- **plan-scrutinizer**: The content script now has an explicit `defineContentScript` entry, full-URL parsing, and a one-shot intersection observer. Added `/trending`, `/advisories`, and `/copilot` to the denylist.
- **plan-compliance-audit**: No material findings.
- **plan-review (2026-11-12)**: Added GitHub's username pattern as `LOGIN_PATTERN` in `src/core/login.ts`, so a crafted path cannot reach a search query later. It lives in `core/` because `services/` may not import `dom/`.
- **plan-simplifier (rerun 2026-11-12)**: Collapsed the acceptance line that singled out three denylist routes; the list and the test row already name them. Kept `isProfilePage`, because CLAUDE.md section 7 names it.
- **plan-scope-guard (rerun 2026-11-12)**: In scope. Three tasks, six files including CLAUDE.md.
- **plan-scrutinizer (rerun 2026-11-12)**: `turbo:load` teardown now explicitly includes a mutation observer still waiting for a graph.
- **plan-compliance-audit (rerun 2026-11-12)**: `core/login.ts` is compliant. Added the CLAUDE.md section 6 entry.
