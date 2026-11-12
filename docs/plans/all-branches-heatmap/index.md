# All-Branches Heatmap

Show a GitHub profile's commits on every branch, not only the default branch. The person who installs the extension is the only one who sees it. Version 1 uses a personal access token. This index is the source of truth for sequence order, status, and the decisions later phases must not reopen.

The WXT, Preact, and pnpm scaffold is already on `main`. These sequences build the product described in CLAUDE.md on top of it. The starter popup stays; a status popup is optional and is not part of this goal.

## Sequences

Ship top to bottom. A sequence starts only after every sequence it depends on is `Done`.

| Sequence | Status | Index | Depends on | Purpose |
| --- | --- | --- | --- | --- |
| Detect and auth | Pending | `detect-and-auth/index.md` | — | Notice a profile graph, save a token, and prove the content script can ask the worker a question. |
| Owner graph | Pending | `owner-graph/index.md` | Detect and auth | Count the viewer's own branch commits, draw the heatmap, recover squash merges, and cache the result. |
| Other viewers | Pending | `other-viewers/index.md` | Owner graph | Show other people's public commits safely, then add the toggle, day detail, and error states. |
| Device login | — | _(not written)_ | Other viewers | Replace the pasted token with GitHub's device login. CLAUDE.md lists this as later, and the flow is not specified yet. |

## Shared decisions

- The fetch window is the same year the grid draws: from the Sunday 52 weeks before the current week, through the Saturday of the current week. A full refetch does not walk a user's entire history.
- One message, `GET_CONTRIBUTIONS`, carries the whole feature. Detect-and-auth returns `{ viewerLogin }`. The branch-commits phase returns `Contributions` when the profile is the viewer and keeps `{ viewerLogin }` otherwise. The privacy phase removes the `{ viewerLogin }` shape. Do not add a second message for the same request. The only other messages are `CLEAR_CACHE` (cache phase) and `OPEN_OPTIONS` (graph-interactions phase), because a content script cannot open the options page itself.
- The message handler lives in `src/services/handle-message.ts`, not in `background.ts`, so Vitest can import it. `background.ts` only constructs dependencies and registers listeners. Listeners call `sendResponse` and `return true`; they do not rely on returning a promise.
- Failures are `{ ok: false, error, resetAt? }`. `resetAt` is set only for `RATE_LIMITED`. The worker does not throw across the message boundary.
- Stopping early because fewer than 200 rate-limit points remain, after some commits were collected, is a success with `partial: true`. `RATE_LIMITED` is only for when the first request cannot proceed. HTTP 403 or 429 responses that carry rate-limit headers are `RATE_LIMITED` too, not `NETWORK`.
- A GraphQL response with both `data` and `errors` is not a failure of the whole request. A repository that comes back `null` or `FORBIDDEN` (for example, an organization behind SAML single sign-on) is skipped and the fetch continues.
- A login is valid only if it matches GitHub's username pattern, `^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$`. The page and the worker both check it. Search strings are built from the `login` GitHub returns, never from the URL text.
- Long fetches keep the service worker alive with a `keepalive` port that the content script pings every 20 seconds. An open port that sends nothing does not keep a Manifest V3 worker alive.
- Every result only counts commits whose local day is inside the grid year. Commits outside it are dropped before `aggregateByDay`, on a fresh fetch and on a cache hit.
- Other people's profiles use `publicOnly` until a later, unwritten phase turns on `publicPlusCounts`. The core policies for all three modes exist earlier so the tests can lock the stripping behavior. The resolver must not select `publicPlusCounts` in the phases written here.
- Private details are removed in the worker before the response is built. The content script never calls `api.github.com` and never reads the token.
- Cache key is viewer login, profile login, and mode, plus schema version `1`. An `owner` entry is never served for another mode or viewer.
- Commit messages and repository names are Preact text, never HTML.
- The extension permissions stay `storage`, `https://github.com/*`, and `https://api.github.com/*`.
- `pnpm zip` already exists. Publishing to the Chrome Web Store is not a phase.

## Goal acceptance criteria

- On the viewer's own profile, accepting the prompt shows a year of commits from every branch, with the same commit counted once.
- A squash-merged pull request still contributes the commits that never landed on the default branch.
- On someone else's profile, private repositories add nothing: no count, no name, no message.
- A missing token does not call GitHub. A rate limit stops the fetch and says when it resets.
- `pnpm test -- --run` covers the counting rules, the privacy policies, and the service pipeline.

## Out of scope

- Firefox, Safari, and a profile-README image for visitors who do not have the extension.

## Subagent Takeaways

- **plan-simplifier**: Cut three out-of-scope lines that repeated the sequence table and the public-only decision. Left the Firefox and permissions notes, because those are the boundaries an implementer would otherwise widen.
- **plan-scope-guard**: No material findings. Four sequences, with the authored work split so no table is a single ten-phase plan. Device login stays unwritten.
- **plan-review (2026-11-12)**: Two review passes before implementation. Added shared decisions for the handler module, `sendResponse`, partial GraphQL errors, 403/429 rate limits, login validation, the pinged keepalive port, the grid-year filter, and `OPEN_OPTIONS`. Phase files carry the details.
