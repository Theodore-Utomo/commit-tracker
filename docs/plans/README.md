# Plans

Implementation plans for Commit Tracker. Agents write them from [docs/prompts/plan.md](../prompts/plan.md).

## Conventions

- **Filename:** `docs/plans/<YYMMDD>-descriptive-kebab-name.md`
- **Status values:** `Pending`, `In Progress`, `Done`, `Superseded`
- **PR title:** `[Plan] Title In Title Case`
- **PR base:** `main`. This repo has no long-lived `dev` branch.
- **One plan file per PR.** A change that fits one PR is a single file. Work past one PR (about 8 tasks or about 15 files) is a goal folder: `docs/plans/<goal-slug>/index.md` plus phase files `<YYMMDD>-P01-<name>.md`. See [plan.md](../prompts/plan.md) (Long work) and [plan-folder.example.md](../prompts/plan-folder.example.md).

## Lifecycle

1. The planning agent writes the plan, or a goal folder, and opens a pull request when a GitHub remote exists.
2. A person reviews `Human Feedback Requested` and the acceptance criteria.
3. The implementation agent executes one plan, or one phase, via [implement.md](../prompts/implement.md). A goal index is not a task list.
4. Set that plan's `Status`, and its index row, to `Done` when the work is merged, or `Superseded` if it is replaced. Unwritten phases stay `—`.

## Index

Flat plans are found by the date prefix in the filename. There is no catalog of every plan. A goal folder's `index.md` indexes that goal only.
