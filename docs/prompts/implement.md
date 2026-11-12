# Implementation Prompt

Implement the following task end to end:

<task_specific_description>

## Goal

Deliver the requested change with code that follows this repo, the checks that prove it, and a pull-request-ready wrap-up.

The `implementation-simplifier`, `test-coverage-audit`, `branch-compliance-audit`, `bugbot`, `security-review`, and `pr-readiness-review` subagents are mandatory. If a pass is low-signal for the task, still run it and record that it produced no material findings. Do not skip a pass and summarize it yourself.

## Required Context

Before editing, read:

1. `AGENTS.md`
2. `CLAUDE.md` — the sections this change touches
3. `README.md`
4. `docs/reference/quick-reference.md`
5. The plan in `docs/plans/`, when one exists
6. `docs/guides/testing/testing.md`

The passes in `.cursor/agents/` are registered automatically. `bugbot` and `security-review` are built-in Cursor subagents. Launch them with the prompt in section 6. They read the repository themselves. Do not paste the diff into their prompt.

## Process

### 1) Understand the task

- Restate the requirements and what "done" looks like.
- If a plan exists, read it before editing and treat it as the source of truth unless the code proves a line wrong. Its `Unit Tests` section is the list of cases you must cover. Its `Privacy` and `Messages` sections are binding.
- A goal folder (`docs/plans/<goal-slug>/index.md`, or a sequence index under it) is a table of phases, not a task list. Implement one phase file. Read the index first, confirm every phase it depends on is `Done`, and set that row to `In Progress` before editing. Do not implement later phases on the same branch. Pull-request title: `[<Type>] <Goal Title> — P01 <Phase Title>`. When the phase is merged, set the plan and the index row to `Done`. If the user pointed at the index and did not name a phase, take the first row whose status is `Pending`. Stop if that row is `_(not written)_` and say which phase still needs a plan.
- If no plan exists, and the change is at least 5 files or 3 tasks, write a short plan with `docs/prompts/plan.md` before editing. Smaller work can proceed from a few sentences of intent.
- List the entrypoints, core modules, services, messages, tests, and docs you will touch.

### 2) Audit the branch and the code

- Review git status and the branch before editing.
- Read the surrounding code and follow it. Do not introduce a second pattern for something this repo already does.
- Resolve open questions from the code and from CLAUDE.md before changing behavior.

### 3) Implement in the plan's order

Follow the plan's **Task Order** when a plan exists. Otherwise work foundation-first: `src/core/` → `src/services/` → `src/messaging/` → entrypoints and UI.

- Keep the diff inside the request.
- Follow `AGENTS.md` and `docs/reference/quick-reference.md`.
- **Core:** Pure functions over plain data. No `browser`, no `fetch`, no DOM.
- **Services:** The service worker is the only caller. Construct the GitHub client and the cache in the background entrypoint and pass them in. Do not import a service from `src/ui/` or `src/dom/`.
- **Messages:** Add a union member in `src/messaging/protocol.ts`. Handle it in one `switch`. Return `{ ok: false, error }` for failures.
- **Privacy:** Resolve the mode before fetching. Strip private details in the worker. Key the cache by viewer, profile, and mode.
- **UI:** Preact inside `createShadowRootUi`. Render commit messages and repository names as text. Read GitHub's page only through `src/dom/github-page.ts`.
- **Permissions:** Leave `wxt.config.ts` alone unless the plan changes permissions and CLAUDE.md in the same change.
- **Token:** Read it from extension storage inside the worker. Send it only to `api.github.com`. Never log it.
- **Tests:** Add or update `tests/unit/` cases in the same task as the code. Cover every `Unit Tests` row. Use fakes. A bug fix gets a test that fails before the fix.
- Do not leave debug logging in the diff.
- Do not silence a failure with `any`, `@ts-expect-error`, or a disabled lint rule. Fix the cause.

### 4) Validate before review

- While working, run the one file you are editing: `pnpm exec vitest run tests/unit/<path>`.
- Before review, `pnpm typecheck`, `pnpm lint`, `pnpm test -- --run`, and `pnpm build` must pass. Run the tests and the typecheck before the build.
- **When a test fails, fix it before moving on.** The plan's acceptance criteria decide whether the code or the test is wrong. Update a test only when the intended behavior changed, and say so in the pull-request description. Never land `.skip`, `.only`, `.todo`, deleted assertions, or a weaker matcher. Re-run `pnpm test -- --run` until it passes. If a failure already exists on the base branch and is outside this task, record it. Do not hide it.
- For a user-visible change, load the extension with `pnpm dev` or a `pnpm build` unpacked load and exercise the flow in Chrome. See `docs/guides/testing/testing.md`.
- Run `pnpm test:e2e` only when the plan includes an end-to-end case.
- Write down the commands you ran and anything you could not run.

### 5) Prepare the review bundle

Build this once for the custom review passes:

1. The comparison point is `git merge-base HEAD origin/main` when `origin/main` exists, otherwise `git merge-base HEAD main`.
2. Record `MERGE_BASE=<sha>` and `HEAD=<sha>`.
3. Capture `git diff --name-only "<MERGE_BASE>"...HEAD`.
4. Capture the unified diff, or save it under `.agent-handoff/` and point the subagent at that path. `.agent-handoff/` is local scratch. Do not commit it.

### 6) Run the review passes

Run all six in order, each as a subagent task. They are read-only. You apply what they report.

| Order | Subagent | Pass it |
| --- | --- | --- |
| 1 | `implementation-simplifier` | Review bundle + task description or plan acceptance criteria |
| 2 | `test-coverage-audit` | Review bundle + task description or plan acceptance criteria |
| 3 | `branch-compliance-audit` | Review bundle (file list and diff) |
| 4 | `bugbot` | Launch as specified below |
| 5 | `security-review` | Launch as specified below |
| 6 | `pr-readiness-review` | Review bundle, draft pull-request title and description, validation results, plan file, and the verdicts from passes 1–5 |

Launch passes 4 and 5 after passes 1–3 are applied. Each gets `run_in_background: false`. Do not compute a diff for them. Pass 4: description `Bugbot`, `subagent_type` `bugbot`. Pass 5: description `Security Review`, `subagent_type` `security-review`. Prompt for both:

```text
Full Repository Path: <absolute path of this git repository>
Diff: branch changes
```

Add `Base Branch: main` when the pull-request base is `main` and that is not the name the subagent would assume. If either subagent type is unavailable, record that the pass did not run. Do not replace it with your own review.

Draft the pull-request title and description after passes 1–5. Run pass 6 last.

Between passes:

- Resolve every `blocker`. Do not continue with one open.
- Apply `should-fix` items, or write one line explaining why not. When `test-coverage-audit` names a missing unit test for changed logic, add it.
- Apply each Bugbot and Security Review finding, or write one line explaining why not. An unresolved high-severity Security Review finding is a blocker.
- Rebuild the bundle and re-run `pnpm test -- --run` after any code change.
- If applying findings materially changes the diff, rerun that pass once. Stop after two rounds. Put anything still unresolved in the pull-request description.
- Record what each pass found and what you did with it.

### 7) Pull-request metadata

- Title: `[<type>] Title In Title Case` (`Feature`, `Fix`, `Chore`, and so on).
- Body: a short summary, a link to the plan when one exists, the tests you added, how to test, and any open questions.
- Turn the plan's acceptance criteria into the test checklist.

### 8) Wrap up

- Re-read the diff for drive-by edits.
- If a design decision changed, update `CLAUDE.md` in the same change.
- `pnpm typecheck`, `pnpm lint`, `pnpm test -- --run`, and `pnpm build` pass, or a repo issue that blocks them is written down.
- Stage only the files that belong in the change.
- Commit only when the user asked for a commit. Push and open the pull request only when the user asked for that.

## Layer reminders

- Editing `src/core/**`: no I/O. Add the test in `tests/unit/core/` in the same change.
- Editing `src/services/**`: fake the GitHub client and IndexedDB in `tests/unit/`. The content script must not import this folder.
- Editing `src/messaging/protocol.ts`: extend the union. Do not add a second, untyped message channel.
- Editing `src/dom/**`: selectors live here only. A lookup that fails does so quietly.
- Editing `src/ui/**`: Preact text nodes for anything that came from GitHub.
- Editing `src/entrypoints/**`: wire dependencies and send messages. Do not count commits here.
- Editing `wxt.config.ts`: permissions stay minimal. A new permission updates CLAUDE.md too.

## Deliverables

- The task is done against the plan's acceptance criteria when a plan exists.
- Unit tests cover the changed logic and the plan's `Unit Tests` rows.
- `pnpm typecheck`, `pnpm lint`, `pnpm test -- --run`, and `pnpm build` were run. Failures were fixed, not skipped.
- All six review passes ran. Every blocker is resolved. The rest were applied or justified.
- The privacy invariants in `docs/reference/quick-reference.md` still hold.
- A pull-request title and description are ready.
- The change is committed and pushed only if the user asked.

</task_specific_description>
