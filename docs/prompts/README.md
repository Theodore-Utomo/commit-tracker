# Prompts

Reusable task prompts for agents working in Commit Tracker.

## Index

| Prompt | Purpose |
| --- | --- |
| [plan.md](plan.md) | Write a technical plan before coding |
| [implement.md](implement.md) | Implement an approved plan, or a small task, end to end |
| [plan.example.md](plan.example.md) | Worked example of one plan. Not a real task. |
| [plan-folder.example.md](plan-folder.example.md) | Worked example of a goal-folder index. Not a real task. |

Subagents that those prompts launch live in [.cursor/agents/](../../.cursor/agents/) and are listed in [AGENTS.md](../../AGENTS.md).

## Plan a change

```markdown
@docs/prompts/plan.md

<planning_context>

## Description

On the viewer's own profile, after they accept the prompt, show a heatmap
of their commits on every branch. Private repositories may include messages.
Other people's profiles stay on the public-only default.

</planning_context>
```

The agent reads the design docs, drafts a plan, runs the four plan subagents, writes `docs/plans/<date>-<name>.md`, and opens a pull request titled `[Plan] ...` against `main` when a GitHub remote exists. Work past one pull request becomes a goal folder (`index.md` plus phase files). See [plan-folder.example.md](plan-folder.example.md).

If the change is fewer than 5 files and fewer than 3 tasks, the agent writes a short pull-request description instead of a plan file.

## Implement a plan

```markdown
@docs/prompts/implement.md

<task_specific_description>

Implement docs/plans/261112-owner-branch-heatmap.md.

</task_specific_description>
```

The agent follows that plan's task order and file map, runs `pnpm typecheck`, `pnpm lint`, `pnpm test -- --run`, and `pnpm build`, then runs the six implementation review passes. It commits and opens a pull request only when asked.
