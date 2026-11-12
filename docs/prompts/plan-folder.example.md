# Day Detail

> Example goal `index.md`. Reference only. Not a real planned project. A goal with one sequence keeps this file at `docs/plans/<goal-slug>/index.md`. Several sequences keep a parent index at `docs/plans/<goal-slug>/index.md` (`Sequence | Status | Index | Depends on | Purpose`) and put this phase table at `docs/plans/<goal-slug>/<sequence-slug>/index.md`. The H1 is this sequence's title (2 to 5 words). Implementation reads one phase file, never this index. New phase files use `P01`, not `P1`.

Let a person click a day on the all-branches heatmap and read that day's commits. The click handler, the list of commits, and the empty-day message ship as separate phases. This index is the source of truth for phase order, status, and dependencies. Later phases are stub rows until someone asks for them.

## Phase order

Ship top to bottom unless a row says otherwise.

| Order | Status | Plan | Depends on | Purpose |
| --- | --- | --- | --- | --- |
| 1 | Pending | `261112-P01-day-click.md` | — | Clicking a day tells the heatmap which date was chosen, with its test. |
| 2 | — | _(not written)_ | 1 | Show that day's commit messages when the privacy rule allows it. |
| 3 | — | _(not written)_ | 2 | A short line when the day has no commits. |

Status vocabulary matches a normal plan: `Pending`, `In Progress`, `Done`, `Superseded`. An unwritten phase uses `—` in Status and `_(not written)_` in Plan.

## Shared decisions

- The list shows only commits the privacy policy already returned to the content script. A later phase must not fetch extra detail from the page.
- Repository names and messages render as text.

## Goal acceptance criteria

- Clicking a day with commits shows those commits.
- A private commit the viewer is not allowed to read does not show a repository name or a message.
- A day with no commits shows a short empty message.

## Out of scope

- Editing or opening the commit on GitHub.
- Counting commits that the heatmap does not already have.
