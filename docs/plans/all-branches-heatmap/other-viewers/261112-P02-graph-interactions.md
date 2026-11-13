# Plan: Graph Interactions

Date: 2026-11-12
Status: Pending

## Summary

Let the viewer switch between GitHub's graph and the all-branches graph, click a day to read that day's commits, and see a clear message when the token is missing or GitHub is rate limiting. Done means those three interactions work on both the viewer's profile and a public profile.

## Acceptance Criteria

- A toggle hides GitHub's graph or the heatmap. `showAllBranches` defaults to true. After a successful response, the heatmap is shown and `hidden` is set on the element from `findContributionGraph`. The other position clears `hidden` and hides the heatmap. The choice is remembered.
- If the graph lookup returns `undefined`, the heatmap still renders and nothing throws.
- Clicking a day lists full commits as text: message, `owner/name`, and branch when present. Any `CountOnly` values add one line `<n> private commits` and no message or repository. A day with no commits shows `No commits`.
- `NO_TOKEN` shows `Add a token in the extension options.` and an `Open extension options` button, and draws no squares. The button sends `OPEN_OPTIONS`, and the options page opens in a new tab.
- `RATE_LIMITED` shows `GitHub rate limit reached` and the local time of `resetAt` when it is present, and draws no squares.
- `UNAUTHORIZED` shows `The saved token was rejected. Save a new one in the extension options.` and the same `Open extension options` button.
- `NOT_FOUND` shows `GitHub has no user with that login.`
- `NETWORK` shows `Could not reach GitHub. Try again.`
- `UNKNOWN` shows `Something went wrong. Try again.`
- A success with `partial: true` draws the heatmap and adds `Results are incomplete because the rate limit was close.`
- On any error, do not change `hidden` on GitHub's graph.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

The day list renders `commits` when they are present and, when they are absent, only the count. It does not treat a missing message as a reason to ask the worker for more. `CountOnly` values never include `messageHeadline` or `repo` because the core policy already removed them.

## Messages

The UI reads `error` and `resetAt` from the existing failure response.

One new message, `{ type: 'OPEN_OPTIONS' }`. A content script cannot call `runtime.openOptionsPage()`, and github.com cannot link to a `chrome-extension://` page that is not web-accessible, so the worker opens it. Success is `{ ok: true, data: { opened: true } }`. If `openOptionsPage` rejects, the response is `UNKNOWN`. The handler is `handleOpenOptions({ openOptionsPage })` in `src/services/handle-message.ts`, and `background.ts` passes `browser.runtime.openOptionsPage`. The listener uses `sendResponse` and `return true`. Do not add `web_accessible_resources` or a new permission for this.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/ui/day-detail.test.ts` | A full commit contributes its message and `owner/name`; a `CountOnly` value contributes a private-commits line and neither a message nor a repository; an empty day returns `No commits` |
| `tests/unit/services/preferences.test.ts` | Unset `getShowAllBranches` returns true; `setShowAllBranches(false)` then get returns false |
| `tests/unit/services/handle-message.test.ts` | `OPEN_OPTIONS` calls the injected `openOptionsPage` once and returns `{ opened: true }`; a rejection returns `UNKNOWN` |

The test imports `dayLines` from `DayDetail.tsx` and does not render the component.

## File Map

```text
src/
├── ui/
│   ├── DayDetail.tsx                               (create)
│   │   ├── + dayLines
│   │   └── + DayDetail
│   ├── Toggle.tsx                                  (create)
│   │   └── + Toggle
│   └── Heatmap.tsx                                 (update)
│       └── + onSelectDay
├── core/
│   └── types.ts                                    (update)
│       └── ~ DayBucket.commits
├── messaging/
│   └── protocol.ts                                 (update)
│       └── + OPEN_OPTIONS
├── services/
│   ├── preferences.ts                              (update)
│   │   └── + getShowAllBranches, setShowAllBranches
│   └── handle-message.ts                           (update)
│       └── + handleOpenOptions
└── entrypoints/
    ├── background.ts                               (update)
    │   └── + OPEN_OPTIONS case
    └── github-profile.content/
        ├── index.tsx                               (update)
        │   └── ~ error copy, options button, toggle, day detail
        └── style.css                               (update)
CLAUDE.md                                           (update)
    └── ~ section 7: OPEN_OPTIONS in the Request union
tests/
└── unit/
    ├── services/
    │   ├── handle-message.test.ts                  (update)
    │   └── preferences.test.ts                     (update)
    └── ui/
        └── day-detail.test.ts                      (create)
```

`showAllBranches` defaults to true when unset. `Toggle.tsx` receives the current value and `onToggle` and does not import `src/services/` or `src/dom/`. `index.tsx` calls `findContributionGraph` and `src/services/preferences.ts`. It never imports `src/services/settings.ts`. `DayBucket.commits` becomes `(Commit | CountOnly)[] | undefined` in `src/core/types.ts`. `dayLines` emits one line per full commit and, when any `CountOnly` is present, one line `<n> private commits`. `DayDetail` renders those strings as Preact text. Native graph nodes stay in the DOM.

## Task Order

1. **Toggle and detail** — Add `dayLines` on `DayDetail.tsx` with its tests, the toggle, the remembered preference, and the day panel.
2. **Errors** — Replace a bare error code in the shadow root with the sentences above, including the partial-results line. Add `OPEN_OPTIONS`, its handler test, the options button, and the CLAUDE.md protocol update.

## Subagent Takeaways

- **plan-simplifier**: `dayLines` lives on `DayDetail.tsx` instead of a new file.
- **plan-scope-guard**: No material findings. Two tasks. Toggle, day detail, and errors are one build-order step.
- **plan-scrutinizer**: Named the sentence for every `ErrorCode`, including the options link for `NO_TOKEN`. A missing graph does not throw. `DayBucket.commits` can hold `CountOnly` values.
- **plan-compliance-audit**: No material findings. `Toggle.tsx` does not import services or DOM helpers.
- **plan-review (2026-11-12)**: The `NO_TOKEN` "link to the options page" could not work from a content script. It is now a button that sends a new `OPEN_OPTIONS` message, and the worker calls `openOptionsPage()`. `UNAUTHORIZED` gets the same button. `showAllBranches` lives in the token-free `preferences.ts`, not `settings.ts`.
