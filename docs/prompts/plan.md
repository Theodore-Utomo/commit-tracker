# Planning Prompt

Take a short description of a change and produce a technical implementation plan.

<planning_context>

## Goal

Produce a focused, implementation-ready plan that delivers what the description asks for. Write it to `docs/plans/`. When a GitHub remote exists, open or update a pull request against `main`. Plan pull requests never target a different long-lived branch. This repo has no `dev` branch. The plan is the source of truth for `docs/prompts/implement.md`.

The `plan-simplifier`, `plan-scope-guard`, `plan-scrutinizer`, and `plan-compliance-audit` subagents are mandatory review passes for every planning task. They live in `.cursor/agents/` and are registered automatically. Launch each one as its own subagent task. Do not review the plan yourself and record that as the pass.

## Required Context

Read before drafting:

1. `AGENTS.md`
2. `CLAUDE.md` — the sections the change touches, plus the privacy rule and the build order
3. `README.md`
4. `docs/reference/quick-reference.md`
5. `docs/plans/README.md`
6. `docs/guides/testing/testing.md`
7. The description inside `<planning_context>`

## Process

1. **Understand the description.** Identify the goal, the scope, and what "done" looks like. Resolve ambiguities from the code and from CLAUDE.md before drafting. If a user-visible behavior is unclear, ask once or add `Human Feedback Requested`. Do not invent a visual design. User-visible UI follows CLAUDE.md: shadow DOM, GitHub's contribution colors, and text rendered as text.
2. **Audit the codebase.** Open the files the work will touch. Confirm every existing file and symbol you name is real. New files are marked `(create)` and must match the layout in CLAUDE.md. Find the unit tests next to that behavior under `tests/unit/`.
3. **Draft the plan.** Follow the template below. Write the `File Map` first, then derive `Task Order` from it. Every logic change gets a `Unit Tests` row, and every new or updated test file appears in the `File Map`.
4. **Run the four subagents in sequence** on each authored plan. Apply findings between passes. Record a 2–3 sentence summary in `Subagent Takeaways`. A goal index is not a plan: run only `plan-simplifier` and `plan-scope-guard` on it, and record those takeaways in the phase plans.

   | Order | Subagent | Pass it |
   | --- | --- | --- |
   | 1 | `plan-simplifier` | Draft plan + original description |
   | 2 | `plan-scope-guard` | Draft plan + original description |
   | 3 | `plan-scrutinizer` | Draft plan + original description |
   | 4 | `plan-compliance-audit` | Draft plan |

   Launch each as a subagent with `run_in_background: false`. Resolve every `blocker` before the next pass. Apply `should-fix` items or note why not. If applying findings materially rewrites the plan, rerun that pass once. Stop after two rounds and move anything still unresolved into `Human Feedback Requested`.

5. **Write the plan.** One concern that fits one pull request goes in `docs/plans/<YYMMDD>-descriptive-name.md`. Work past the limits in [Long work](#long-work) goes in a goal folder instead.
6. **Open the pull request against `main`.** Use `gh pr create --base main`. Title format: `[Plan] Title In Title Case`. A goal folder authored as an index plus the first phase uses `[Plan] <Goal Title>: Index + P01`. The body is a short summary, a link to the plan file or folder, and any `Human Feedback Requested` items. If there is no GitHub remote yet, write the plan file and stop. Say that the pull request was not opened.

## Writing Style

- Plain language. Say what changes and why. Keep file paths and symbol names in the File Map.
- Concise. Soft target: 60–120 lines for Summary, Acceptance Criteria, Task Order, and takeaways.
- No user-story boilerplate.
- Acceptance criteria are observable from outside the code. When the plan changes logic, include "`pnpm test -- --run` passes, including the new cases in Unit Tests."
- Do not restate repository rules. Link to `docs/reference/quick-reference.md` or CLAUDE.md when a rule matters.
- Decide before writing the plan. An unresolved choice goes in `Human Feedback Requested`, not as "either A or B" in a task.

If the change touches fewer than 5 files and fewer than 3 tasks, write a one-paragraph pull-request description instead of a plan.

## Long work

One plan file is the default. When the draft is too big for one pull request, write a goal folder of linked plans. Do not put `PR 1` and `PR 2` groups inside one file. Plans already written that way stay as they are.

Create a goal folder when any of these hold:

- More than about 8 tasks, or more than about 15 files in the file map.
- The work is several increments, and each one is useful after it merges without the rest.
- `plan-scope-guard` returns `Split recommended`.

```text
docs/plans/<goal-slug>/
├── index.md                                      the goal; not a plan template
├── <YYMMDD>-P01-<name>.md                        one phase, one PR, full template
└── <YYMMDD>-P02-<name>.md
```

`<goal-slug>` is kebab-case with no date. Phase files use `P01`, `P02`. The index Order column is `1`, `2`, `3`.

**One sequence.** `index.md` is the phase table. Its H1 is the goal title (2 to 5 words). See `docs/prompts/plan-folder.example.md`.

**Several sequences.** Use this when one phase table would run to about 7 or more phases. `index.md` lists sequences:

| Sequence | Status | Index | Depends on | Purpose |
| --- | --- | --- | --- | --- |
| Short name | Pending | `<sequence-slug>/index.md` | — | One sentence. |

Each sequence lives at `docs/plans/<goal-slug>/<sequence-slug>/index.md` and restarts at `P01`. Do not split only to shrink a diff.

A phase is one mergeable concern, including the tests that prove it. It must be safe to merge before any later phase exists.

Allowed splits, in dependency order: the message types, then the worker that handles them; a pure `core/` function, then the service that calls it; the worker response, then the UI that renders it.

Rejected splits: slices that each mix the worker, the privacy rule, and the UI; a last phase whose only job is the feature's tests; a phase that breaks the extension until a later phase lands.

**What to write now.** Default: the index plus the first phase, in full. Later phases stay stub rows (`—` in Status, `_(not written)_` in Plan) until someone picks them up. When the requester says to author every phase, write each phase file now. Each authored phase runs all four subagents and keeps `Subagent Takeaways`. Run `plan-simplifier` and `plan-scope-guard` on the index.

Shared decisions that later phases must not reopen (a privacy mode, a cache key, a message shape) go in the index once.

Implementation reads one phase. One phase per branch, targeting `main`, title `[<Type>] <Goal Title> — P01 <Phase Title>`. Do not start a phase whose dependency is not `Done`. `docs/prompts/implement.md` is the workflow.

## Output Template Structure

Follow this structure. Omit `Privacy`, `Messages`, and `Human Feedback Requested` only when they have nothing to say. When the change has no logic to test, keep the `Unit Tests` heading and replace the table with one line saying so.

See `docs/prompts/plan.example.md` for a worked plan. See `docs/prompts/plan-folder.example.md` for a goal-folder index. Phase files use the template below. The index does not.

````markdown
# Plan: <Title>

Date: <YYYY-MM-DD>
Status: Pending

## Summary

2–3 sentences in plain language: what problem this solves, what we'll do, and what "done" looks like. No file paths and no symbol names.

## Acceptance Criteria

- One observable condition per bullet.

## Privacy

Which `PrivacyMode` this change uses, what the content script is allowed to receive, and how the cache key includes that mode. One line of "No commit data is fetched or displayed." when that is true.

## Messages

Each new or changed message: `type`, payload, success data, and `ErrorCode` cases. The worker returns `{ ok: false, error }` instead of throwing.

## Unit Tests

One row per test file the change creates or updates. Tests live in `tests/unit/` and use fakes. See `docs/guides/testing/testing.md`.

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/core/dedupe.test.ts` | The same SHA on three branches counts once; a branch hit wins over a pull-request hit |

Unit tests are required for:

- Anything added or changed in `src/core/`.
- `src/services/` behavior, with a fake `GitHubClient` and `fake-indexeddb`. Cover the success path and each `ErrorCode` the plan names.
- Bug fixes: a test that fails before the fix.

Not required for copy, color, and layout-only UI.

## File Map

File tree of every file created, updated, or deleted. Nest the functions that change.

```text
src/
└── core/
    └── dedupe.ts                         (create)
        └── + dedupeCommits
tests/
└── unit/
    └── core/
        └── dedupe.test.ts                (create)
            └── + same SHA on three branches counts once
```

Tests go in `tests/unit/`, not beside `src/`.

Annotation legend:

- `(create)` / `(update)` / `(delete)` — file action.
- `+` add, `~` change, `-` remove — symbol action.

## Task Order

Foundational tasks first. One sentence per task. Each task maps to one or more File Map entries. Write each module's tests in the same task as the code. UI tasks do not repeat the acceptance criteria.

A phase plan uses a flat numbered list. The goal index holds the sequence across phases.

1. **<Task Name>** — one sentence.
2. **<Task Name>** — one sentence.

## Subagent Takeaways

2–3 sentences per subagent. Use "No material findings." when that is true.

- **plan-simplifier**: <summary>
- **plan-scope-guard**: <summary>
- **plan-scrutinizer**: <summary>
- **plan-compliance-audit**: <summary>

## Human Feedback Requested

| Location | Question / Issue |
| --- | --- |
| Task: Create X | Should we support Y? The description does not say. |
````

</planning_context>
