# Other Viewers

> Sequence index. Implementation reads one phase file, not this page. Do not start until Owner Graph is `Done`.

Let the extension open someone else's profile without leaking private work, then finish the interactions around the graph.

## Phase order

| Order | Status | Plan | Depends on | Purpose |
| --- | --- | --- | --- | --- |
| 1 | Pending | `261112-P01-privacy-modes.md` | — | Other profiles are public-only. The viewer's own profile stays owner mode. |
| 2 | Pending | `261112-P02-graph-interactions.md` | 1 | Toggle GitHub's graph, open a day, and show token and rate-limit errors. |
| 3 | — | _(not written)_ | 1 | If a manual check proves `restrictedContributionsCount`, select `publicPlusCounts` when that count is non-zero. Before the response is built, reduce each private `CountOnly` to a per-day count: no SHA and no timestamp reach the content script or the cache. |

## Shared decisions

- A day list shows only what the worker already returned. It does not fetch more when the day is clicked.

## Goal acceptance criteria

- Another person's private repositories do not change the heatmap and do not appear in a day list.
- The viewer can switch between GitHub's graph and the all-branches graph, and can read a day's commits when the policy left the details in place.
- A missing token and a rate limit each show their own message.

## Subagent Takeaways

- **plan-simplifier**: No material findings.
- **plan-scope-guard**: No material findings. `publicPlusCounts` stays an unwritten follow-up.
