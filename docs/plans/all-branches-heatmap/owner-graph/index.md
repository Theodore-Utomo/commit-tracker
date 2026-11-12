# Owner Graph

> Sequence index. Implementation reads one phase file, not this page. Do not start until Detect and Auth is `Done`.

Count the signed-in viewer's commits on every branch, draw the heatmap, add squash-merged commits, and cache the result.

## Phase order

| Order | Status | Plan | Depends on | Purpose |
| --- | --- | --- | --- | --- |
| 1 | Pending | `261112-P01-core-library.md` | — | Pure types, dedupe, day grouping, grid, and privacy policies, with tests. |
| 2 | Pending | `261112-P02-branch-commits.md` | 1 | Fetch the viewer's branch commits and show the total on the profile. |
| 3 | Pending | `261112-P03-heatmap.md` | 2 | Replace the total with the year heatmap, gated by the prompt. |
| 4 | Pending | `261112-P04-merged-prs.md` | 2 | Add commits that survived only as a merged pull request. |
| 5 | Pending | `261112-P05-cache.md` | 3, 4 | Cache by viewer, profile, and mode, and fetch only what is new. |

Phase 3 and phase 4 both depend on phase 2. Phase 4 does not need the heatmap. Phase 5 needs the heatmap file and the merged-PR commits, so it depends on both. Phase 3 can merge before phase 4.

## Shared decisions

- The pipeline calls `policyFor('owner')` only. Mode selection for other people is the next sequence.
- Author emails are an options-page list used only in owner mode, on top of the viewer's GitHub id.
- The first fetch uses `since` equal to the grid start from the core library. It does not omit `since`.

## Goal acceptance criteria

- The viewer's profile shows a heatmap of one year of commits from every non-fork branch, counted once per SHA.
- Commits that exist only on a merged pull request appear in that heatmap.
- A second visit reuses the cache and asks GitHub only for commits newer than the last sync.

## Subagent Takeaways

- **plan-simplifier**: No material findings.
- **plan-scope-guard**: Pointed the cache phase at both the heatmap and the merged-PR phases, so it cannot land before `index.tsx` exists. No split.
