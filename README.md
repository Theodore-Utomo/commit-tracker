# Commit Tracker

A Chrome extension that shows a GitHub user's commit activity across all branches, not only the default branch. [CLAUDE.md](CLAUDE.md) is the product design. [AGENTS.md](AGENTS.md) is how agents plan and implement work in this repo.

## Prerequisites

- Node.js 20 or later
- [pnpm](https://pnpm.io/) (`corepack enable`, or `npm i -g pnpm`)
- Google Chrome

A GitHub personal access token is needed once the options page exists. Do not create one until then, and never commit one. See [Token](#token).

## Install

```bash
pnpm install
```

`postinstall` runs `wxt prepare` and writes generated types to `.wxt/`. That directory is gitignored. Run `pnpm install` again after pulling if types look stale.

## Run

Development build, with Chrome opened and the extension loaded:

```bash
pnpm dev
```

Production build, to load in your normal Chrome profile:

```bash
pnpm build
```

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `.output/chrome-mv3`.

A Chrome Web Store zip:

```bash
pnpm zip
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev build, opens Chrome, hot reload |
| `pnpm build` | Production build in `.output/chrome-mv3` |
| `pnpm zip` | Chrome Web Store zip |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test -- --run` | Vitest once. Plain `pnpm test` stays in watch mode. |
| `pnpm test:e2e` | Playwright. Install a browser once with `pnpm exec playwright install chromium`. |

Before a commit, run `pnpm typecheck`, `pnpm lint`, and `pnpm test -- --run`.

## Token

Version 1 takes a personal access token on the options page. The same page can save extra commit emails, used only to find the viewer's own commits that are not linked to the GitHub account. There is no backend and no client secret.

- **Classic token:** scopes `repo`, `read:org`, and `read:user`.
- **Fine-grained token:** read-only Contents, Metadata, and Pull requests, for the repositories you want included. An organization may need to approve the token.

Never commit a token. Never put one in a fixture, a plan, or a log. `.env*` is gitignored. End-to-end tests read a token from an environment variable.

## Layout

Extension source lives in `src/` (`srcDir` in `wxt.config.ts`). Files WXT copies as-is live in `public/` at the repo root. The target module layout, privacy rule, and build order are in [CLAUDE.md](CLAUDE.md).

## Planning a change

Give an agent [docs/prompts/plan.md](docs/prompts/plan.md) and a short description. Implementation of an approved plan starts from [docs/prompts/implement.md](docs/prompts/implement.md). The prompt index is [docs/prompts/README.md](docs/prompts/README.md).
