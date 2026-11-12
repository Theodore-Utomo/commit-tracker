# Plan: Token and Viewer Login

Date: 2026-11-12
Status: Pending

## Summary

Add an options page that stores a GitHub personal access token, and make the profile content script ask the service worker who the token belongs to. Done means the page logs that login after the graph scrolls into view, and a missing token never calls GitHub.

## Acceptance Criteria

- The options page saves a token and, on a later open, shows that a token is saved without putting the token back into the input.
- After the graph is half visible, the page logs the viewer's login from the worker.
- With no token, the worker returns `NO_TOKEN` and the network panel shows no call to `api.github.com`.
- An invalid token returns `UNAUTHORIZED`.
- The content script source does not read the token.
- `pnpm test -- --run` passes, including the new cases in Unit Tests.

## Privacy

No commit data is fetched. The worker calls only `viewer { login id }`. The content script receives the login string and nothing else.

## Messages

- Request: `{ type: 'GET_CONTRIBUTIONS', login: string }`. `login` is the profile from the URL. This phase does not use it for the response.
- Success: `{ ok: true, data: { viewerLogin: string } }`. The branch-commits phase replaces `data` with `Contributions`.
- Failure: `{ ok: false, error: ErrorCode, resetAt?: string }` with `ErrorCode` = `NO_TOKEN` | `UNAUTHORIZED` | `RATE_LIMITED` | `NOT_FOUND` | `NETWORK` | `UNKNOWN`. This phase returns `NO_TOKEN`, `UNAUTHORIZED`, `NETWORK`, and `UNKNOWN`. It does not set `resetAt`. The field stays on the type so later phases do not widen it.
- `handleGetContributions(message, { getToken, client })` returns `Promise<Response>` and never throws. `background.ts` registers `browser.runtime.onMessage.addListener` and returns that promise for `GET_CONTRIBUTIONS`.
- `getToken()` yields `undefined` for a missing value and for a blank or whitespace-only string. Those cases return `NO_TOKEN` and do not call the client.
- `getViewer` POSTs to `https://api.github.com/graphql` with `Content-Type: application/json`, body `{ query: VIEWER_QUERY }`, and `Authorization: Bearer <token>`. Status `401`, and a body whose `errors[].type` is `UNAUTHENTICATED`, become `UNAUTHORIZED`. Any other rejected status, and a `TypeError` from `fetch`, become `NETWORK`. Any other throw becomes `UNKNOWN`.

## Unit Tests

| Test file | Behaviors to check |
| --- | --- |
| `tests/unit/services/github/mappers.test.ts` | A viewer payload maps to `{ login, id }`; a payload with no `viewer` is rejected |
| `tests/unit/services/github/client.test.ts` | A fake `fetch`: status 401 is `UNAUTHORIZED`; a 200 body with `errors[0].type === "UNAUTHENTICATED"` is `UNAUTHORIZED`; status 500 and a thrown `TypeError` are `NETWORK`; the request is POST `https://api.github.com/graphql` with `Content-Type: application/json` |
| `tests/unit/services/settings.test.ts` | `getToken` returns `undefined` when unset or blank; `setToken` round-trips through a fake storage area |

The worker behavior is covered by `handleGetContributions(message, { getToken, client })` in `tests/unit/entrypoints/handle-message.test.ts`. `getToken` resolving `undefined` or `"   "` returns `NO_TOKEN` and does not call `client`. A client 401 result returns `UNAUTHORIZED`. A viewer result returns `{ viewerLogin }`. A thrown `TypeError` returns `NETWORK`. A mapper throw returns `UNKNOWN`.

## File Map

```text
src/
├── messaging/
│   ├── protocol.ts                                 (create)
│   │   └── + Request, Response, ErrorCode
│   └── client.ts                                   (create)
│       └── + sendMessage
├── services/
│   ├── settings.ts                                 (create)
│   │   ├── + getToken, setToken
│   │   └── + token storage item
│   └── github/
│       ├── client.ts                               (create)
│       │   └── + GitHubClient.getViewer
│       ├── queries.ts                              (create)
│       │   └── + VIEWER_QUERY
│       └── mappers.ts                              (create)
│           └── + mapViewer
├── entrypoints/
│   ├── background.ts                               (update)
│   │   └── + onMessage switch, handleGetContributions
│   ├── options/
│   │   ├── index.html                              (create)
│   │   └── main.tsx                                (create)
│   │       └── + token form, saved hint
│   └── github-profile.content/
│       └── index.ts                                (update)
│           └── ~ send GET_CONTRIBUTIONS once the graph is in view
tests/
└── unit/
    ├── services/
    │   ├── settings.test.ts                        (create)
    │   └── github/
    │       ├── client.test.ts                      (create)
    │       └── mappers.test.ts                     (create)
    └── entrypoints/
        └── handle-message.test.ts                  (create)
```

`background.ts` exports `handleGetContributions` so the test does not need Chrome. The listener returns the handler promise. `options/index.html` has a mount node and `<script type="module" src="./main.tsx"></script>`, and it does not set `manifest.type` to `browser_action`. On load, a non-empty token shows the fixed text `A token is saved.` The token is not written to the input value, placeholder, text content, or any attribute. The input is `type="password"` and is cleared after a successful save.

## Task Order

1. **Protocol and settings** — Add the message types and the token storage item, with the settings tests, and the options page described above.
2. **Viewer query** — Add `getViewer` and `client.test.ts` with the POST rules in Messages.
3. **Worker and page** — Return the handler promise from the listener. The content script still logs the profile login from phase 1. After the graph intersects it sends `GET_CONTRIBUTIONS` once per setup and logs `viewerLogin` or `error` on a second line. Do not log the token, the Authorization header, or the raw JSON.

## Subagent Takeaways

- **plan-simplifier**: Dropped a test that implied a log helper. Kept optional `resetAt` on the failure type so later phases do not widen it.
- **plan-scope-guard**: No material findings. Three tasks and the options page, protocol, and viewer call are one message path.
- **plan-scrutinizer**: The listener returns the handler promise, blank tokens are `NO_TOKEN`, and the GraphQL POST is specified. The options page is not registered as a popup. The profile login log from phase 1 stays.
- **plan-compliance-audit**: No material findings. The token is written from the options page into storage and is not read by the content script.
