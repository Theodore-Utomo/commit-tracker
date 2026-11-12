# Detect and Auth

> Sequence index. Implementation reads one phase file, not this page.

Notice a GitHub profile, store a token, and prove the page can ask the service worker a question. No commit counting yet.

## Phase order

| Order | Status | Plan | Depends on | Purpose |
| --- | --- | --- | --- | --- |
| 1 | Pending | `261112-P01-profile-detection.md` | — | Log when a profile's contribution graph scrolls into view. |
| 2 | Pending | `261112-P02-token-and-viewer.md` | 1 | Save a token and return the viewer's login across the message boundary. |

## Shared decisions

- `src/entrypoints/content.ts` is removed in phase 1. The only content script is `github-profile.content`.
- Phase 2 sends `GET_CONTRIBUTIONS` as soon as the graph is in view, and the success payload is `{ viewerLogin: string }`. The owner-graph sequence replaces that payload and replaces the automatic send with a prompt.

## Goal acceptance criteria

- Opening a profile and scrolling to the graph logs that profile's login.
- A saved token lets the page log the GitHub login that owns the token.
- No token means no request to `api.github.com`.

## Subagent Takeaways

- **plan-simplifier**: No material findings.
- **plan-scope-guard**: No material findings. Two phases, and the second depends on the first.
