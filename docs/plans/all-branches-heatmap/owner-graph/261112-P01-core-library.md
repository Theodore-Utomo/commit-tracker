# Plan: Core Counting Library

Date: 2026-11-12
Status: Pending

## Summary

Add the pure functions that turn a list of commits into a one-year grid, including the privacy rules for what a caller is allowed to keep. Done means the unit tests lock those rules and no file in this phase touches the network or the DOM.

## Acceptance Criteria

- The same commit SHA on three branches produces one commit, and a branch copy wins over a pull-request copy.
- A timestamp just before local midnight and one just after land on different days.
- The grid for a fixed day has 371 days, starts on a Sunday, and ends on the Saturday of that day's week.
- A private commit passed through `publicPlusCounts` keeps only the SHA, the date, and `private: true`.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

This phase does not fetch or display anything. It defines `policyFor`:

- `owner`: include private and public non-forks; return the full commit.
- `publicPlusCounts`: include private non-forks; a private commit becomes `{ sha, authoredDate, private: true }` with no message and no repo. A public commit stays full.
- `publicOnly`: `includeRepo` is false for private repos. Public non-forks stay full.

Forks are excluded in every mode. No phase in this goal selects `publicPlusCounts`. The function still exists so the stripping rule is tested before any fetch uses it.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/core/dedupe.test.ts` | Three branch copies of one SHA collapse to one and keep the first branch name; a branch copy wins when it is before the pull-request copy and when it is after; two different SHAs both remain |
| `tests/unit/core/aggregate.test.ts` | `2024-01-11T04:30:00Z` in `America/New_York` is `2024-01-10`; `2024-01-11T05:30:00Z` is `2024-01-11`; a repeated SHA does not raise `count` or `totals.commits` and `days[date].commits` holds that SHA once; a `CountOnly` value raises the day count and `totals.commits`, is stored on that day, and leaves `totals.repos` unchanged |
| `tests/unit/core/grid.test.ts` | For today `2024-01-11` and for Sunday `2024-01-07`, the start is `2023-01-08`, the length is 371, and the last day is `2024-01-13`; each date is one civil day after the previous |
| `tests/unit/core/privacy.test.ts` | `publicPlusCounts` returns a new count-only object for a private non-fork and leaves the input's message in place; `publicOnly` makes `present` return `undefined` for a private commit; `owner` keeps a private non-fork copy; every mode rejects a fork |

## File Map

```text
src/
└── core/
    ├── types.ts                                    (create)
    │   └── + PrivacyMode, RepoRef, Commit, CountOnly, DayBucket, Contributions
    ├── dedupe.ts                                   (create)
    │   └── + dedupeCommits
    ├── aggregate.ts                                (create)
    │   └── + aggregateByDay
    ├── grid.ts                                     (create)
    │   └── + gridDays
    └── privacy.ts                                  (create)
        └── + PrivacyPolicy, policyFor
tests/
└── unit/
    └── core/
        ├── dedupe.test.ts                          (create)
        ├── aggregate.test.ts                       (create)
        ├── grid.test.ts                            (create)
        └── privacy.test.ts                         (create)
```

`Contributions` matches CLAUDE.md: `login`, `mode`, `days`, `totals`, `partial`, `fetchedAt`. `gridDays(today)` splits `YYYY-MM-DD` on `-` and uses those numbers. It does not call `Date.parse` or `new Date(today)`. It finds the Sunday of that civil week, subtracts 52 weeks, and returns 371 consecutive dates. Today `2024-01-07` (a Sunday) starts `2023-01-08` and ends `2024-01-13`, the same window as `2024-01-11`.

`aggregateByDay(commits, timeZone)` returns `{ days, totals }`. Each SHA adds at most 1 to that day's `count` and to `totals.commits`. `totals.repos` counts distinct `owner/name` on full commits. A `CountOnly` value increments the day count and the commit total and adds no repo. `days[date].commits` is the items counted into that day, full commits and `CountOnly` values. Day keys use `Intl.DateTimeFormat` in `timeZone`.

`dedupeCommits` keeps one item per SHA. `source: "branch"` wins over `source: "pr"` whether the branch copy is first or last. Two branch copies keep the first branch name.

`present` returns a new object and does not mutate its input. For `publicOnly`, a private repo or a fork makes `present` return `undefined`. `publicPlusCounts` returns `{ sha, authoredDate, private: true }` for a private non-fork and a full copy for a public non-fork. Empty days are not inserted by `aggregateByDay`.

## Task Order

1. **Types** — Add the data model in `types.ts`. No behavior.
2. **Dedupe and days** — Add `dedupeCommits` and `aggregateByDay` with their tests.
3. **Grid and privacy** — Add `gridDays` and `policyFor` with their tests.

## Subagent Takeaways

- **plan-simplifier**: No material findings.
- **plan-scope-guard**: No material findings. Three tasks and nine files. `policyFor` is not wired to a fetch here.
- **plan-scrutinizer**: `gridDays` now parses a civil date instead of `Date.parse`. Dedupe order, `present` returning a new object, and `publicOnly` returning `undefined` for a private commit are specified. A later pass stores the counted items on `days[date].commits` so the cache can rebuild the year.
- **plan-compliance-audit**: No material findings. This phase stays inside `src/core/`.
