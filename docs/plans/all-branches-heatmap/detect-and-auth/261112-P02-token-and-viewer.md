# Plan: Token and Viewer Login

Date: 2026-11-12
Status: In Progress

## Summary

Add an options page that stores a GitHub personal access token, and make the profile content script ask the service worker who the token belongs to. Done means the page logs that login after the graph scrolls into view, and a missing token never calls GitHub.

## Acceptance Criteria

- The options page saves a token and, on a later open, shows that a token is saved without putting the token back into the input.
- After the graph is half visible, the page logs the viewer's login from the worker.
- With no token, the worker returns `NO_TOKEN` and the network panel shows no call to `api.github.com`.
- An invalid token returns `UNAUTHORIZED`.
- A 403 or 429 response with rate-limit headers returns `RATE_LIMITED` with `resetAt`.
- A `login` that fails `LOGIN_PATTERN` returns `NOT_FOUND` and does not call GitHub.
- After the extension is reloaded, a send from an old content script resolves to `{ ok: false, error: 'UNKNOWN' }` and does not throw.
- The content script source does not read the token.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

No commit data is fetched. The worker calls only `viewer { login id }`. The content script receives the login string and nothing else.

## Messages

- Request: `{ type: 'GET_CONTRIBUTIONS', login: string }`. `login` is the profile from the URL. This phase checks it against `LOGIN_PATTERN` from `src/core/login.ts` and otherwise does not use it for the response.
- Success: `{ ok: true, data: { viewerLogin: string } }`. The branch-commits phase replaces `data` with `Contributions`.
- Failure: `{ ok: false, error: ErrorCode, resetAt?: string }` with `ErrorCode` = `NO_TOKEN` | `UNAUTHORIZED` | `RATE_LIMITED` | `NOT_FOUND` | `NETWORK` | `UNKNOWN`. This phase returns all six. `resetAt` is an ISO timestamp, set only with `RATE_LIMITED`.
- `handleGetContributions(message, { getToken, client })` lives in `src/services/handle-message.ts`, returns `Promise<Response>`, and never throws. `background.ts` imports it, constructs the client, and registers `browser.runtime.onMessage.addListener((message, sender, sendResponse) => …)`. The listener ignores a message whose `sender.id` is not `browser.runtime.id`, and returns `false` without calling `sendResponse` for a `type` it does not handle. For `GET_CONTRIBUTIONS` it calls the handler, passes the result to `sendResponse`, and returns `true`. It does not return the promise.
- `sendMessage(request)` in `src/messaging/client.ts` takes the browser send function as an optional second argument (default `browser.runtime.sendMessage`) and never rejects. A rejected send (for example "Extension context invalidated" after a reload) and an `undefined` reply both resolve to `{ ok: false, error: 'UNKNOWN' }`.
- The token item is `storage.defineItem<string>('local:githubToken')` in `src/services/settings.ts`. `getToken()` yields `undefined` for a missing value and for a blank or whitespace-only string. Those cases return `NO_TOKEN` and do not call the client.
- `getViewer` POSTs to `https://api.github.com/graphql` with `Content-Type: application/json`, body `{ query: VIEWER_QUERY }`, and `Authorization: Bearer <token>`. Map the response in this order:
  1. Status `401`, or a body whose `errors[].type` is `UNAUTHENTICATED`: `UNAUTHORIZED`.
  2. Status `403` or `429` with `x-ratelimit-remaining: 0` or a `retry-after` header, or a body whose `errors[].type` is `RATE_LIMITED`: `RATE_LIMITED`. `resetAt` comes from `x-ratelimit-reset` (epoch seconds) when present, otherwise now plus `retry-after` seconds.
  3. Any other non-2xx status, and a `TypeError` from `fetch`: `NETWORK`.
  4. A 2xx body with `errors` and no usable `data`: `UNKNOWN`. A body with both `data` and `errors` is returned to the caller with the errors attached. The client does not throw for it. Later phases skip the affected repositories.
  5. Any other throw: `UNKNOWN`.

## Test Setup

`vitest.config.ts` adds `WxtVitest()` from `wxt/testing/vitest-plugin` to `plugins`, so WXT's auto-imports (`browser`, `storage`, `defineBackground`) resolve in tests. Settings tests use `fakeBrowser` from `wxt/testing/fake-browser` and call `fakeBrowser.reset()` in `beforeEach`. `tests/setup.ts` keeps the `fake-indexeddb/auto` import.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/services/github/mappers.test.ts` | A viewer payload maps to `{ login, id }`; a payload with no `viewer` is rejected |
| `tests/unit/services/github/client.test.ts` | A fake `fetch`: status 401 is `UNAUTHORIZED`; a 200 body with `errors[0].type === "UNAUTHENTICATED"` is `UNAUTHORIZED`; status 403 with `x-ratelimit-remaining: 0` and `x-ratelimit-reset` is `RATE_LIMITED` with that reset as ISO; status 429 with `retry-after: 60` is `RATE_LIMITED` with `resetAt` about 60 seconds ahead; a 200 body with `errors[0].type === "RATE_LIMITED"` is `RATE_LIMITED`; status 403 with no rate-limit headers, status 500, and a thrown `TypeError` are `NETWORK`; a 200 body with `data` and `errors` returns the data; the request is POST `https://api.github.com/graphql` with `Content-Type: application/json` |
| `tests/unit/services/settings.test.ts` | `getToken` returns `undefined` when unset or blank; `setToken` round-trips through `fakeBrowser` storage under `local:githubToken` |
| `tests/unit/services/handle-message.test.ts` | `getToken` resolving `undefined` or `"   "` returns `NO_TOKEN` and does not call `client`; a `login` of `octo%20cat` returns `NOT_FOUND` and does not call `client`; a client 401 result returns `UNAUTHORIZED`; a client rate-limit result returns `RATE_LIMITED` with `resetAt`; a viewer result returns `{ viewerLogin }`; a thrown `TypeError` returns `NETWORK`; a mapper throw returns `UNKNOWN` |
| `tests/unit/messaging/client.test.ts` | A send function that rejects yields `{ ok: false, error: 'UNKNOWN' }`; one that resolves `undefined` yields the same; one that resolves a `Response` returns it unchanged |

## File Map

```text
src/
├── messaging/
│   ├── protocol.ts                                 (create)
│   │   └── + Request, Response, ErrorCode
│   └── client.ts                                   (create)
│       └── + sendMessage
├── services/
│   ├── handle-message.ts                           (create)
│   │   └── + handleGetContributions
│   ├── settings.ts                                 (create)
│   │   ├── + getToken, setToken
│   │   └── + token storage item
│   └── github/
│       ├── client.ts                               (create)
│       │   └── + GitHubClient.getViewer, response mapping
│       ├── queries.ts                              (create)
│       │   └── + VIEWER_QUERY
│       └── mappers.ts                              (create)
│           └── + mapViewer
├── entrypoints/
│   ├── background.ts                               (update)
│   │   └── + onMessage listener with sendResponse
│   ├── options/
│   │   ├── index.html                              (create)
│   │   └── main.tsx                                (create)
│   │       └── + token form, saved hint
│   └── github-profile.content/
│       └── index.ts                                (update)
│           └── ~ send GET_CONTRIBUTIONS once the graph is in view
vitest.config.ts                                    (update)
    └── + WxtVitest plugin
CLAUDE.md                                           (update)
    ├── ~ section 6: services/handle-message.ts; background.ts only wires
    └── ~ section 7: resetAt on failures, sendResponse and return true
tests/
└── unit/
    ├── messaging/
    │   └── client.test.ts                          (create)
    └── services/
        ├── handle-message.test.ts                  (create)
        ├── settings.test.ts                        (create)
        └── github/
            ├── client.test.ts                      (create)
            └── mappers.test.ts                     (create)
```

`background.ts` holds no logic that needs a test. `options/index.html` has a mount node and `<script type="module" src="./main.tsx"></script>`, and it does not set `manifest.type` to `browser_action`. On load, a non-empty token shows the fixed text `A token is saved.` The token is not written to the input value, placeholder, text content, or any attribute. The input is `type="password"` and is cleared after a successful save.

This phase is at its size limit (18 files). Put new findings in a follow-up, not here.

## Task Order

1. **Protocol, settings, and test setup** — Add `WxtVitest()` to `vitest.config.ts`. Add the message types, `sendMessage` with its tests, and the token storage item with the settings tests. Add the options page described above.
2. **Viewer query** — Add `getViewer` and `client.test.ts` with the response mapping in Messages.
3. **Worker and page** — Add `handleGetContributions` in `src/services/handle-message.ts` with its tests. Register the listener in `background.ts` with `sendResponse` and `return true`. Update CLAUDE.md sections 6 and 7. The content script still logs the profile login from phase 1. After the graph intersects it sends `GET_CONTRIBUTIONS` once per setup and logs `viewerLogin` or `error` on a second line. Do not log the token, the Authorization header, or the raw JSON.

## Subagent Takeaways

- **plan-simplifier**: Dropped a test that implied a log helper. Kept optional `resetAt` on the failure type so later phases do not widen it.
- **plan-scope-guard**: No material findings. Three tasks and the options page, protocol, and viewer call are one message path.
- **plan-scrutinizer**: Blank tokens are `NO_TOKEN`, and the GraphQL POST is specified. The options page is not registered as a popup. The profile login log from phase 1 stays.
- **plan-compliance-audit**: No material findings. The token is written from the options page into storage and is not read by the content script.
- **plan-review (2026-11-12)**: Moved the handler out of `background.ts` and added `WxtVitest()`, because WXT auto-imports make `background.ts` fail to import under plain Vitest. The listener uses `sendResponse` and `return true`; WXT 0.20+ has no polyfill, so returning a promise depends on native Chrome support. 403 and 429 with rate-limit headers map to `RATE_LIMITED`, and `data` plus `errors` is not a whole-request failure. The worker checks `sender.id` and `LOGIN_PATTERN`, imported from `src/core/login.ts`.
- **plan-simplifier (rerun 2026-11-12)**: Removed a stale takeaway clause ("the listener returns the handler promise") that contradicted the `sendResponse` rule, and a repeated import note.
- **plan-scope-guard (rerun 2026-11-12)**: In scope but full. 18 files after the review additions; still one message path, so no split. Do not add more here.
- **plan-scrutinizer (rerun 2026-11-12)**: `sendMessage` never rejects and maps a rejected send or an `undefined` reply to `UNKNOWN`. The token key is named `local:githubToken` so the heatmap phase can check the bundle for it. Unknown message types return `false`.
- **plan-compliance-audit (rerun 2026-11-12)**: Compliant. Added the CLAUDE.md section 6 entry for `handle-message.ts`.
