# Repository Guidelines

## Documentation Index

### Reference

- [CLAUDE.md](CLAUDE.md) — product design and source of truth. Update it in the same change when a design decision changes.
- [Quick reference](docs/reference/quick-reference.md) — layers, import rules, and privacy invariants
- [README](README.md) — install, scripts, and token handling
- [Testing guide](docs/guides/testing/testing.md) — Vitest, fakes, and manual checks

### Prompts And Plans

- [Prompts index](docs/prompts/README.md) — how to start a planning or implementation task
- [Planning prompt](docs/prompts/plan.md) — write a plan, then run the four plan subagents
- [Implementation prompt](docs/prompts/implement.md) — implement a plan, then run the six review passes
- [Plan example](docs/prompts/plan.example.md) — worked single plan (not a real task)
- [Plan folder example](docs/prompts/plan-folder.example.md) — worked goal index (not a real task)
- [Plans index](docs/plans/README.md) — where plans live and how they move to done

## Cursor Subagents

Planning review passes, in order, from [plan.md](docs/prompts/plan.md):

- [Plan simplifier](.cursor/agents/plan-simplifier.md) — cut plan bloat
- [Plan scope guard](.cursor/agents/plan-scope-guard.md) — keep one plan to one PR
- [Plan scrutinizer](.cursor/agents/plan-scrutinizer.md) — find gaps and unsafe ordering
- [Plan compliance audit](.cursor/agents/plan-compliance-audit.md) — check layers and privacy invariants

Implementation review passes, in order, from [implement.md](docs/prompts/implement.md):

- [Implementation simplifier](.cursor/agents/implementation-simplifier.md) — simplify the diff without changing behavior
- [Test coverage audit](.cursor/agents/test-coverage-audit.md) — unit-test gaps and manual steps
- [Branch compliance audit](.cursor/agents/branch-compliance-audit.md) — layers and privacy invariants on the diff
- Bugbot — built-in `bugbot` subagent. Launch instructions are in [implement.md](docs/prompts/implement.md).
- Security Review — built-in `security-review` subagent. Launch instructions are in [implement.md](docs/prompts/implement.md).
- [PR readiness review](.cursor/agents/pr-readiness-review.md) — last gate before handoff

These files in `.cursor/agents/` are registered as subagents. Launch each pass as its own subagent task. Do not do the pass inline and call it done.

## Core Rules

Start with [quick-reference](docs/reference/quick-reference.md), then read the part of [CLAUDE.md](CLAUDE.md) the change touches. The privacy invariants in the quick reference are blocking. Review passes check them explicitly.

This is one pnpm package: a Manifest V3 Chrome extension built with WXT, TypeScript, and Preact. There is no backend.

- Pure counting logic: `src/core/`
- GitHub, cache, and settings I/O: `src/services/`, called from the background service worker
- GitHub page DOM: `src/dom/`
- Heatmap UI: `src/ui/`, mounted from the content script inside a shadow root
- Chrome entrypoints: `src/entrypoints/`
