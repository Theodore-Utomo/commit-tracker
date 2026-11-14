# Owner Graph

> Sequence index. Implementation reads one phase file, not this page. Do not start until Detect and Auth is `Done`.

Count the signed-in viewer's commits on every branch, draw the heatmap, add squash-merged commits, and cache the result.

## Phase order

| Order | Status | Plan | Depends on | Purpose |
| --- | --- | --- | --- | --- |
| 1 | In Progress | `261112-P01-core-library.md` | — | Pure types, dedupe, day grouping, grid, and privacy policies, with tests. |
| 2 | In Progress | `261112-P02-branch-commits.md` | 1 | Fetch the viewer's branch commits and log the total. |
| 3 | In Progress | `261112-P03-heatmap.md` | 2 | Draw the year heatmap, gated by the prompt. First visible UI. |
| 4 | In Progress | `261112-P04-merged-prs.md` | 2 | Add commits that survived only as a merged pull request, and extra commit emails. |
| 5 | Pending | `261112-P05-cache.md` | 3, 4 | Cache by viewer, profile, and mode, and refetch only the last 14 days (approved). |

## Shared decisions

- The pipeline calls `policyFor('owner')` only. Mode selection for other people is the next sequence.
- Author emails are an options-page list used only in owner mode, on top of the viewer's GitHub id. They arrive in phase 4.

## Goal acceptance criteria

- The viewer's profile shows a heatmap of one year of commits from every non-fork branch, counted once per SHA.
- Commits that exist only on a merged pull request appear in that heatmap.
- A second visit reuses the cache and asks GitHub only for the recent window since the last sync.

## Subagent Takeaways

- **plan-simplifier**: No material findings.
- **plan-scope-guard**: Pointed the cache phase at both the heatmap and the merged-PR phases, so it cannot land before `index.tsx` exists. No split.
- **plan-simplifier (rerun 2026-11-12)**: Cut a paragraph that restated the Depends-on column and a line that repeated the goal index's fetch window.
- **plan-scope-guard (rerun 2026-11-12)**: Extra emails moved from phase 2 to phase 4 to keep phase 2 under its limit.
