# Quick Reference

Condensed rules for agents. [CLAUDE.md](../../CLAUDE.md) is the source of truth. If this file and CLAUDE.md disagree, follow CLAUDE.md and fix this file in the same change.

## Layers

| Work | Belongs in |
| --- | --- |
| Commit types, dedupe, privacy policy, day aggregation, grid math | `src/core/`. Pure functions. No `browser`, no `fetch`, no DOM. |
| GitHub client, IndexedDB cache, settings, the contributions pipeline | `src/services/`. Only the service worker calls these. |
| Display preferences the page may read (`alwaysShow`) | `src/storage/`. WXT `storage` and `src/core/` only. No token and no `src/services/`. |
| Message and response types | `src/messaging/protocol.ts` |
| `sendMessage` helpers for the content script | `src/messaging/client.ts` |
| GitHub selectors and profile-page detection | `src/dom/github-page.ts` only |
| Prompt, heatmap, day detail, toggle | `src/ui/`, rendered with Preact inside `createShadowRootUi` |
| Service worker, content script, options page, popup | `src/entrypoints/`. Wire dependencies here. Almost no logic. |

## Import rules

- `src/core/` imports nothing outside `src/core/`.
- `src/services/` may import `src/core/` and `src/messaging/protocol.ts`.
- `src/storage/` may import WXT `storage` and `src/core/` only. It never imports `src/services/`.
- `src/ui/` and `src/dom/` may import `src/core/`, `src/messaging/`, and `src/storage/`. They never import `src/services/`.
- The profile content script may import `src/storage/`. It never imports `src/services/`. ESLint enforces that for the content script, `src/ui/`, and `src/dom/`.
- `src/entrypoints/` may wire the layers together.
- Use `browser` from WXT, not a direct `chrome.*` call, where the two are equivalent.

## Privacy invariants

1. The content script never calls `api.github.com` and never receives the token.
2. The privacy check runs before any commit fetch. Until CLAUDE.md section 3 resolves `restrictedContributionsCount`, other people's profiles default to `publicOnly`.
3. Private commit details are stripped in the service worker, before the response is built. The content script never receives a repo name or message it is not allowed to show.
4. A cache entry is stored and read only for the privacy mode it was fetched with. An `owner` entry is never served to a different viewer or mode.
5. The token lives only in the service worker and extension storage (`chrome.storage.local` via WXT `storage`). It is sent only to `api.github.com`. It is never logged, committed, or placed in a fixture.
6. Commit messages and repository names are rendered as Preact text, never interpolated into HTML.
7. `src/core/` stays free of browser APIs, `fetch`, and DOM.
8. `src/ui/`, `src/dom/`, and the profile content script never import `src/services/`. Display preferences come from `src/storage/`, which never imports `src/services/`.
9. Permissions stay `storage` plus `https://github.com/*` and `https://api.github.com/*`, unless CLAUDE.md and `wxt.config.ts` change together. Do not add `tabs`, `scripting`, or `<all_urls>` without that update.
10. Every content-script message is a discriminated union in `src/messaging/protocol.ts`. The worker's handler catches failures and returns an `ErrorCode`. It does not throw across that boundary.

## Commands

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test -- --run`
- `pnpm build`

`pnpm test` without `--run` starts Vitest in watch mode. End-to-end tests are `pnpm test:e2e` and are not part of the default check.
