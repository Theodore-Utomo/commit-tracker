import { describe, expect, it, vi } from 'vitest';
import type { RepoRef } from '../../../../src/core/types';
import { createGitHubClient, createRateBudget } from '../../../../src/services/github/client';
import {
  BRANCH_COMMITS,
  BRANCH_HISTORY,
  MERGED_PR_COMMITS,
  OWNER_REPOS,
  PR_COMMITS,
  VIEWER_QUERY,
} from '../../../../src/services/github/queries';

const TOKEN = 'test-token';
const NOW = Date.parse('2026-11-13T00:00:00.000Z');
const VIEWER = { viewer: { login: 'octocat', id: 'U_1' } };

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function clientReturning(response: Response | Error) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  return { fetch, client: createGitHubClient({ fetch, now: () => NOW }) };
}

describe('GitHubClient.getViewer', () => {
  it('POSTs the viewer query as JSON to the GraphQL endpoint with a bearer token', async () => {
    const { fetch, client } = clientReturning(reply(200, { data: VIEWER }));

    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: true, data: { login: 'octocat', id: 'U_1' } });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(init.body as string)).toEqual({ query: VIEWER_QUERY });
  });

  it('maps status 401 to UNAUTHORIZED', async () => {
    const { client } = clientReturning(reply(401, { message: 'Bad credentials' }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('maps a 200 body with an UNAUTHENTICATED error to UNAUTHORIZED', async () => {
    const { client } = clientReturning(reply(200, { data: null, errors: [{ type: 'UNAUTHENTICATED' }] }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('maps status 403 with x-ratelimit-remaining 0 to RATE_LIMITED with the reset as ISO', async () => {
    const reset = 1_794_528_000;
    const { client } = clientReturning(
      reply(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }),
    );
    await expect(client.getViewer(TOKEN)).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(reset * 1000).toISOString(),
    });
  });

  it('maps status 429 with retry-after to RATE_LIMITED about that many seconds ahead', async () => {
    const { client } = clientReturning(reply(429, {}, { 'retry-after': '60' }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(NOW + 60_000).toISOString(),
    });
  });

  it('maps a 200 body with a RATE_LIMITED error to RATE_LIMITED', async () => {
    const { client } = clientReturning(
      reply(200, { data: null, errors: [{ type: 'RATE_LIMITED' }] }, { 'x-ratelimit-reset': '1794528000' }),
    );
    await expect(client.getViewer(TOKEN)).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(1_794_528_000 * 1000).toISOString(),
    });
  });

  it('maps a 403 with only retry-after (secondary rate limit) to RATE_LIMITED', async () => {
    const { client } = clientReturning(reply(403, {}, { 'retry-after': '30' }));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(NOW + 30_000).toISOString(),
    });
  });

  it('prefers x-ratelimit-reset over retry-after when both are present', async () => {
    const { client } = clientReturning(
      reply(429, {}, { 'x-ratelimit-reset': '1794528000', 'retry-after': '60' }),
    );
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(1_794_528_000 * 1000).toISOString(),
    });
  });

  it('falls back to retry-after when x-ratelimit-reset is zero or not a number', async () => {
    for (const reset of ['0', 'abc']) {
      const { client } = clientReturning(
        reply(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset, 'retry-after': '60' }),
      );
      await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({
        ok: false,
        error: 'RATE_LIMITED',
        resetAt: new Date(NOW + 60_000).toISOString(),
      });
    }
  });

  it('omits resetAt when no header gives a usable time', async () => {
    const { client } = clientReturning(reply(429, {}, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'RATE_LIMITED' });
  });

  it('maps a 200 RATE_LIMITED error with no headers to RATE_LIMITED without resetAt', async () => {
    const { client } = clientReturning(reply(200, { data: null, errors: [{ type: 'RATE_LIMITED' }] }));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'RATE_LIMITED' });
  });

  it('maps a 200 body with data and an UNAUTHENTICATED error to UNAUTHORIZED, not data', async () => {
    const { client } = clientReturning(reply(200, { data: VIEWER, errors: [{ type: 'UNAUTHENTICATED' }] }));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('maps a 429 with no rate-limit headers to NETWORK', async () => {
    const { client } = clientReturning(reply(429, {}));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'NETWORK' });
  });

  it('maps a 403 with remaining quota (a permission error) to NETWORK, not RATE_LIMITED', async () => {
    const { client } = clientReturning(
      reply(403, {}, { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1794528000' }),
    );
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'NETWORK' });
  });

  it('maps 403 without rate-limit headers, 500, and a thrown TypeError to NETWORK', async () => {
    for (const response of [reply(403, {}), reply(500, {}), new TypeError('Failed to fetch')]) {
      const { client } = clientReturning(response);
      await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'NETWORK' });
    }
  });

  it('maps any other thrown error to UNKNOWN', async () => {
    const { client } = clientReturning(new Error('boom'));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it('returns the data when a 200 body has both data and errors', async () => {
    const errors = [{ type: 'FORBIDDEN', path: ['viewer', 'organization'] }];
    const { client } = clientReturning(reply(200, { data: VIEWER, errors }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({
      ok: true,
      data: { login: 'octocat', id: 'U_1' },
      errors,
    });
  });

  it('maps a 200 body with errors and no data to UNKNOWN', async () => {
    const { client } = clientReturning(reply(200, { data: null, errors: [{ type: 'INTERNAL' }] }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it('maps a body without a viewer, or one that is not JSON, to UNKNOWN', async () => {
    const notJson = new Response('<html>', { status: 200 });
    for (const response of [reply(200, { data: {} }), notJson]) {
      const { client } = clientReturning(response);
      await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
    }
  });
});

// Paging, rate budget, and skipped repositories (owner-graph P02).
const SINCE = '2023-01-08T00:00:00-05:00';
const AUTHOR = { id: 'U_viewer' };
const REPO: RepoRef = { owner: 'acme', name: 'widgets', isPrivate: true, isFork: false };
const PLENTY = { remaining: 4000, resetAt: '2024-01-11T13:00:00Z' };
const LOW = { remaining: 199, resetAt: '2024-01-11T13:00:00Z' };

interface Call {
  query: string;
  variables: Record<string, unknown>;
}

/** A fake fetch that answers each request with the next scripted body and records what was sent. */
function scripted(bodies: (unknown | Response)[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string) as Call);
    const next = bodies.shift();
    if (next === undefined) {
      throw new Error('unexpected extra request');
    }
    return next instanceof Response
      ? next
      : new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { calls, client: createGitHubClient({ fetch }) };
}

function repoNode(name: string, pushedAt: string | null, extra: Record<string, unknown> = {}) {
  return { name, owner: { login: 'acme' }, isPrivate: false, isFork: false, pushedAt, ...extra };
}

function reposPage(nodes: unknown[], next: string | null, rateLimit = PLENTY) {
  return {
    data: {
      viewer: { repositories: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } },
      rateLimit,
    },
  };
}

function historyNode(oid: string) {
  return { oid, authoredDate: '2024-01-10T15:00:00Z', messageHeadline: `commit ${oid}` };
}

function history(oids: string[], next: string | null) {
  return { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes: oids.map(historyNode) };
}

function refsPage(branches: { name: string; oids: string[]; next?: string }[], nextRefs: string | null, rateLimit = PLENTY) {
  return {
    data: {
      repository: {
        refs: {
          pageInfo: { hasNextPage: nextRefs !== null, endCursor: nextRefs },
          nodes: branches.map((b) => ({ name: b.name, target: { history: history(b.oids, b.next ?? null) } })),
        },
      },
      rateLimit,
    },
  };
}

function historyPage(oids: string[], next: string | null, rateLimit = PLENTY) {
  return { data: { repository: { ref: { target: { history: history(oids, next) } } }, rateLimit } };
}

describe('GitHubClient.listOwnerRepos', () => {
  it('requests the viewer repositories newest-pushed first, forks excluded, with all three affiliations', async () => {
    const { calls, client } = scripted([reposPage([repoNode('a', '2024-01-10T00:00:00Z')], null)]);
    await client.listOwnerRepos(TOKEN, SINCE, createRateBudget());
    expect(calls[0]?.query).toBe(OWNER_REPOS);
    expect(OWNER_REPOS).toContain('orderBy: { field: PUSHED_AT, direction: DESC }');
    expect(OWNER_REPOS).toContain('isFork: false');
    expect(OWNER_REPOS).toContain('affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]');
    expect(OWNER_REPOS).toContain('rateLimit { remaining resetAt }');
  });

  it('follows pageInfo to a second page with the end cursor', async () => {
    const { calls, client } = scripted([
      reposPage([repoNode('a', '2024-01-10T00:00:00Z')], 'c1'),
      reposPage([repoNode('b', '2024-01-09T00:00:00Z')], null),
    ]);
    const result = await client.listOwnerRepos(TOKEN, SINCE, createRateBudget());
    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          { owner: 'acme', name: 'a', isPrivate: false, isFork: false },
          { owner: 'acme', name: 'b', isPrivate: false, isFork: false },
        ],
        truncated: false,
      },
    });
    expect(calls.map((c) => c.variables.cursor)).toEqual([null, 'c1']);
  });

  it('stops paging at the first repository pushed before since', async () => {
    const { calls, client } = scripted([
      reposPage([repoNode('fresh', '2023-06-01T00:00:00Z'), repoNode('stale', '2023-01-08T04:59:59Z'), repoNode('after', '2024-01-01T00:00:00Z')], 'c1'),
    ]);
    const result = await client.listOwnerRepos(TOKEN, SINCE, createRateBudget());
    expect(result.ok && result.data.items.map((r) => r.name)).toEqual(['fresh']);
    expect(calls).toHaveLength(1);
  });

  it('keeps a repository pushed exactly at since', async () => {
    const { client } = scripted([reposPage([repoNode('edge', '2023-01-08T05:00:00Z')], null)]);
    const result = await client.listOwnerRepos(TOKEN, SINCE, createRateBudget());
    expect(result.ok && result.data.items.map((r) => r.name)).toEqual(['edge']);
  });

  it('skips a repository that was never pushed without stopping', async () => {
    const { client } = scripted([reposPage([repoNode('empty', null), repoNode('kept', '2024-01-01T00:00:00Z')], null)]);
    const result = await client.listOwnerRepos(TOKEN, SINCE, createRateBudget());
    expect(result.ok && result.data.items.map((r) => r.name)).toEqual(['kept']);
  });

  it('returns the other repositories when a page has data plus a FORBIDDEN error', async () => {
    const page = reposPage([null, repoNode('kept', '2024-01-01T00:00:00Z')], null);
    const { client } = scripted([
      { ...page, errors: [{ type: 'FORBIDDEN', path: ['viewer', 'repositories', 'nodes', 0] }] },
    ]);
    const result = await client.listOwnerRepos(TOKEN, SINCE, createRateBudget());
    expect(result).toEqual({
      ok: true,
      data: { items: [{ owner: 'acme', name: 'kept', isPrivate: false, isFork: false }], truncated: false },
    });
  });

  it('records the rate limit and stops before the next page when it falls below 200', async () => {
    const budget = createRateBudget();
    const { calls, client } = scripted([reposPage([repoNode('a', '2024-01-10T00:00:00Z')], 'c1', LOW)]);
    const result = await client.listOwnerRepos(TOKEN, SINCE, budget);
    expect(result).toEqual({
      ok: true,
      data: { items: [{ owner: 'acme', name: 'a', isPrivate: false, isFork: false }], truncated: true },
    });
    expect(calls).toHaveLength(1);
    expect(budget.exhausted()).toBe(true);
    expect(budget.resetAt()).toBe(LOW.resetAt);
  });

  it('returns a failure from any page as the failure', async () => {
    const { client } = scripted([new Response('{}', { status: 500 })]);
    await expect(client.listOwnerRepos(TOKEN, SINCE, createRateBudget())).resolves.toEqual({
      ok: false,
      error: 'NETWORK',
    });
  });
});

describe('GitHubClient.getBranchCommits', () => {
  it('sends the repository, author id, and since as variables', async () => {
    const { calls, client } = scripted([refsPage([{ name: 'main', oids: ['a1'] }], null)]);
    await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(calls[0]).toEqual({
      query: BRANCH_COMMITS,
      variables: { owner: 'acme', name: 'widgets', author: AUTHOR, since: SINCE, refCursor: null },
    });
  });

  it('maps commits with the given repository and branch', async () => {
    const { client } = scripted([refsPage([{ name: 'main', oids: ['a1'] }], null)]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result).toEqual({
      ok: true,
      data: {
        items: [{ sha: 'a1', authoredDate: '2024-01-10T15:00:00Z', messageHeadline: 'commit a1', repo: REPO, branch: 'main', source: 'branch' }],
        truncated: false,
      },
    });
  });

  it('requests a second refs page and a second history page, and keeps the later SHAs', async () => {
    const { calls, client } = scripted([
      refsPage([{ name: 'feature/x', oids: ['a1'], next: 'h1' }], 'r1'),
      historyPage(['a2'], null),
      refsPage([{ name: 'main', oids: ['b1'] }], null),
    ]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result.ok && result.data.items.map((c) => [c.sha, c.branch])).toEqual([
      ['a1', 'feature/x'],
      ['a2', 'feature/x'],
      ['b1', 'main'],
    ]);
    expect(calls.map((c) => c.query)).toEqual([BRANCH_COMMITS, BRANCH_HISTORY, BRANCH_COMMITS]);
    expect(calls[2]?.variables.refCursor).toBe('r1');
  });

  it('continues history with the same author id and since, and the branch as a variable', async () => {
    const { calls, client } = scripted([
      refsPage([{ name: 'feature/"quoted"', oids: ['a1'], next: 'h1' }], null),
      historyPage(['a2'], 'h2'),
      historyPage(['a3'], null),
    ]);
    await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(calls[1]?.variables).toEqual({
      owner: 'acme',
      name: 'widgets',
      author: AUTHOR,
      since: SINCE,
      qualifiedName: 'refs/heads/feature/"quoted"',
      cursor: 'h1',
    });
    expect(calls[2]?.variables.cursor).toBe('h2');
    for (const call of calls) {
      expect(call.query).not.toContain('quoted');
    }
  });

  it('returns no commits and no failure for a null repository', async () => {
    const { client } = scripted([{ data: { repository: null, rateLimit: PLENTY } }]);
    await expect(client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget())).resolves.toEqual({
      ok: true,
      data: { items: [], truncated: false },
    });
  });

  it('skips a repository named in a FORBIDDEN or NOT_FOUND error, even if some data came back', async () => {
    for (const type of ['FORBIDDEN', 'NOT_FOUND']) {
      const page = refsPage([{ name: 'main', oids: ['a1'] }], null);
      const { client } = scripted([{ ...page, errors: [{ type, path: ['repository'] }] }]);
      await expect(client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget())).resolves.toEqual({
        ok: true,
        data: { items: [], truncated: false },
      });
    }
  });

  it('stops before a history follow-up when the budget falls below 200, keeping what it has', async () => {
    const budget = createRateBudget();
    const { calls, client } = scripted([refsPage([{ name: 'main', oids: ['a1'], next: 'h1' }], 'r1', LOW)]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, budget);
    expect(result.ok && result.data).toEqual({ items: [expect.objectContaining({ sha: 'a1' })], truncated: true });
    expect(calls).toHaveLength(1);
  });

  it('stops before the next refs page when the budget falls below 200', async () => {
    const { calls, client } = scripted([refsPage([{ name: 'main', oids: ['a1'] }], 'r1', LOW)]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result.ok && result.data.truncated).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('returns a first-page failure as the failure', async () => {
    const { client } = scripted([new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1704978000' } })]);
    await expect(client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget())).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(1_704_978_000 * 1000).toISOString(),
    });
  });

  it('keeps the commits already gathered when a later page fails, and reports the failure', async () => {
    const { client } = scripted([
      refsPage([{ name: 'main', oids: ['a1'], next: 'h1' }], null),
      new Response('{}', { status: 502 }),
    ]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result).toEqual({
      ok: true,
      data: { items: [expect.objectContaining({ sha: 'a1' })], truncated: true, failure: { ok: false, error: 'NETWORK' } },
    });
  });

  it('moves on when a branch disappears between pages', async () => {
    const { client } = scripted([
      refsPage([{ name: 'gone', oids: ['a1'], next: 'h1' }, { name: 'main', oids: ['b1'] }], null),
      { data: { repository: { ref: null }, rateLimit: PLENTY } },
    ]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result.ok && result.data).toEqual({
      items: [expect.objectContaining({ sha: 'a1' }), expect.objectContaining({ sha: 'b1' })],
      truncated: false,
    });
  });
});

describe('createRateBudget', () => {
  it('is not exhausted before any response and ignores a missing rate limit', () => {
    const budget = createRateBudget();
    budget.record(undefined);
    expect(budget.exhausted()).toBe(false);
    expect(budget.resetAt()).toBeUndefined();
  });

  it('keeps the lowest count in a window, so an older reply arriving late cannot refill it', () => {
    const budget = createRateBudget();
    budget.record({ remaining: 199, resetAt: '2024-01-11T13:00:00Z' });
    budget.record({ remaining: 4000, resetAt: '2024-01-11T13:00:00Z' });
    expect(budget.exhausted()).toBe(true);
  });

  it('starts over when a later window begins', () => {
    const budget = createRateBudget();
    budget.record({ remaining: 150, resetAt: '2024-01-11T13:00:00Z' });
    budget.record({ remaining: 5000, resetAt: '2024-01-11T14:00:00Z' });
    expect(budget.exhausted()).toBe(false);
    expect(budget.resetAt()).toBe('2024-01-11T14:00:00Z');
    budget.record({ remaining: 100, resetAt: '2024-01-11T13:00:00Z' }); // a late reply from the old window
    expect(budget.exhausted()).toBe(false);
    expect(budget.resetAt()).toBe('2024-01-11T14:00:00Z');
  });

  it('is exhausted below 200 and not at 200', () => {
    const budget = createRateBudget();
    budget.record({ remaining: 200, resetAt: 'r' });
    expect(budget.exhausted()).toBe(false);
    budget.record({ remaining: 199, resetAt: 'r' });
    expect(budget.exhausted()).toBe(true);
  });
});

// Loop exits the first paging tests did not pin (test-coverage-audit, owner-graph P02).
describe('GitHubClient.getBranchCommits: every loop exit', () => {
  it('keeps page-1 commits when refs page 2 fails, and reports the failure', async () => {
    for (const failing of [
      new Response('{}', { status: 502 }),
      new Response('{}', { status: 429, headers: { 'retry-after': '60' } }),
    ]) {
      const { calls, client } = scripted([refsPage([{ name: 'main', oids: ['a1'] }], 'r1'), failing]);
      const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
      expect(result.ok).toBe(true);
      expect(result.ok && result.data.items.map((c) => c.sha)).toEqual(['a1']);
      expect(result.ok && result.data.truncated).toBe(true);
      expect(result.ok && result.data.failure?.ok).toBe(false);
      expect(calls).toHaveLength(2);
    }
  });

  it('records the rate limit from a history page and stops before the next one', async () => {
    const { calls, client } = scripted([
      refsPage([{ name: 'main', oids: ['a1'], next: 'h1' }], null),
      historyPage(['a2'], 'h2', LOW),
    ]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result.ok && result.data).toEqual({
      items: [expect.objectContaining({ sha: 'a1' }), expect.objectContaining({ sha: 'a2' })],
      truncated: true,
    });
    expect(calls).toHaveLength(2);
  });

  it('stops before any follow-up when another repository has already exhausted the shared budget', async () => {
    const budget = createRateBudget();
    budget.record(LOW);
    const { calls, client } = scripted([refsPage([{ name: 'main', oids: ['a1'], next: 'h1' }], 'r1', LOW)]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, budget);
    expect(result.ok && result.data.truncated).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('follows up every branch with more history, not only the first', async () => {
    const { calls, client } = scripted([
      refsPage([
        { name: 'one', oids: ['a1'], next: 'h1' },
        { name: 'two', oids: ['b1'], next: 'h2' },
      ], null),
      historyPage(['a2'], null),
      historyPage(['b2'], null),
    ]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result.ok && result.data.items.map((c) => c.sha)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(calls.slice(1).map((c) => c.variables.qualifiedName)).toEqual(['refs/heads/one', 'refs/heads/two']);
  });

  it('after a deleted branch, still follows up the next branch and the next refs page', async () => {
    const { calls, client } = scripted([
      refsPage([
        { name: 'gone', oids: ['a1'], next: 'h1' },
        { name: 'kept', oids: ['b1'], next: 'h2' },
      ], 'r1'),
      { data: { repository: { ref: null }, rateLimit: PLENTY } },
      historyPage(['b2'], null),
      refsPage([{ name: 'main', oids: ['c1'] }], null),
    ]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result.ok && result.data).toEqual({
      items: ['a1', 'b1', 'b2', 'c1'].map((sha) => expect.objectContaining({ sha })),
      truncated: false,
    });
    expect(calls).toHaveLength(4);
  });

  it('keeps the page when a FORBIDDEN error points inside the repository, not at it', async () => {
    const page = refsPage([{ name: 'main', oids: ['a1'] }], null);
    const { client } = scripted([
      { ...page, errors: [{ type: 'FORBIDDEN', path: ['repository', 'refs', 'nodes', 3, 'target'] }] },
    ]);
    const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
    expect(result.ok && result.data).toEqual({ items: [expect.objectContaining({ sha: 'a1' })], truncated: false });
  });

  it('marks the result truncated when the repository becomes hidden on a later refs page', async () => {
    const page2 = refsPage([{ name: 'other', oids: ['b1'] }], null);
    for (const second of [
      { ...page2, errors: [{ type: 'FORBIDDEN', path: ['repository'] }] },
      { data: { repository: null, rateLimit: PLENTY } },
    ]) {
      const { client } = scripted([refsPage([{ name: 'main', oids: ['a1'] }], 'r1'), second]);
      const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
      expect(result.ok && result.data).toEqual({ items: [expect.objectContaining({ sha: 'a1' })], truncated: true });
    }
  });
});

describe('GitHubClient.listOwnerRepos: every loop exit', () => {
  it('returns a failure on page 2 as the failure', async () => {
    const { client } = scripted([
      reposPage([repoNode('a', '2024-01-10T00:00:00Z')], 'c1'),
      new Response('{}', { status: 502 }),
    ]);
    await expect(client.listOwnerRepos(TOKEN, SINCE, createRateBudget())).resolves.toEqual({
      ok: false,
      error: 'NETWORK',
    });
  });

  it('is not truncated when the low-budget page was the last page', async () => {
    const { client } = scripted([reposPage([repoNode('a', '2024-01-10T00:00:00Z')], null, LOW)]);
    const result = await client.listOwnerRepos(TOKEN, SINCE, createRateBudget());
    expect(result.ok && result.data.truncated).toBe(false);
  });

  it('keeps a repository whose pushedAt cannot be parsed, rather than stopping on it', async () => {
    const { client } = scripted([
      reposPage([repoNode('odd', 'not-a-date'), repoNode('kept', '2024-01-01T00:00:00Z')], null),
    ]);
    const result = await client.listOwnerRepos(TOKEN, SINCE, createRateBudget());
    expect(result.ok && result.data.items.map((r) => r.name)).toEqual(['odd', 'kept']);
  });
});

describe('createRateBudget: windows and unparseable times', () => {
  it('lowers the count within the same window', () => {
    const budget = createRateBudget();
    budget.record({ remaining: 4000, resetAt: '2024-01-11T13:00:00Z' });
    budget.record({ remaining: 199, resetAt: '2024-01-11T13:00:00Z' });
    expect(budget.exhausted()).toBe(true);
  });

  it('never lets a reply with an unparseable reset time refill the count', () => {
    const budget = createRateBudget();
    budget.record({ remaining: 150, resetAt: '2024-01-11T13:00:00Z' });
    budget.record({ remaining: 5000, resetAt: 'not-a-date' });
    expect(budget.exhausted()).toBe(true);
    expect(budget.resetAt()).toBe('2024-01-11T13:00:00Z');
  });

  it('takes a parseable reset time after an unparseable one, and still only lowers the count', () => {
    const budget = createRateBudget();
    budget.record({ remaining: 300, resetAt: 'not-a-date' });
    budget.record({ remaining: 4000, resetAt: '2024-01-11T13:00:00Z' });
    expect(budget.exhausted()).toBe(false);
    expect(budget.resetAt()).toBe('2024-01-11T13:00:00Z');
    budget.record({ remaining: 100, resetAt: 'also-bad' });
    expect(budget.exhausted()).toBe(true);
  });
});

describe('GitHubClient.getBranchCommits: repository hidden during a history follow-up', () => {
  it('marks the result truncated when the history reply has no repository, or a FORBIDDEN error on it', async () => {
    for (const reply of [
      { data: { repository: null, rateLimit: PLENTY } },
      { ...historyPage(['x9'], null), errors: [{ type: 'FORBIDDEN', path: ['repository'] }] },
    ]) {
      const { client } = scripted([refsPage([{ name: 'main', oids: ['a1'], next: 'h1' }], null), reply]);
      const result = await client.getBranchCommits(TOKEN, REPO, AUTHOR, SINCE, createRateBudget());
      expect(result.ok && result.data).toEqual({ items: [expect.objectContaining({ sha: 'a1' })], truncated: true });
    }
  });
});

describe('createRateBudget: first stored time unparseable', () => {
  it('keeps the lower count when a parseable time follows an unparseable one', () => {
    const budget = createRateBudget();
    budget.record({ remaining: 150, resetAt: 'not-a-date' });
    budget.record({ remaining: 4000, resetAt: '2024-01-11T13:00:00Z' });
    expect(budget.exhausted()).toBe(true);
    expect(budget.resetAt()).toBe('2024-01-11T13:00:00Z');
  });
});

const PROFILE = 'monalisa';
const MERGED_SINCE = '2023-01-08';

function prCommitNode(oid: string, login: string | null = PROFILE) {
  return {
    commit: {
      oid,
      authoredDate: '2024-01-10T15:00:00Z',
      messageHeadline: `commit ${oid}`,
      author: { email: 'dev@example.com', user: login === null ? null : { login } },
    },
  };
}

function pullRequestNode(
  number: number,
  oid: string,
  next: string | null,
  repository: unknown = { owner: { login: 'acme' }, name: 'widgets', isPrivate: false, isFork: false },
) {
  return {
    number,
    repository,
    commits: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes: [prCommitNode(oid)] },
  };
}

function searchPage(nodes: unknown[], next: string | null, issueCount = nodes.length, rateLimit = PLENTY) {
  return {
    data: {
      search: { issueCount, pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes },
      rateLimit,
    },
  };
}

function prCommitsPage(oids: { oid: string; login?: string | null }[], next: string | null, rateLimit = PLENTY) {
  return {
    data: {
      repository: {
        pullRequest: {
          commits: {
            pageInfo: { hasNextPage: next !== null, endCursor: next },
            nodes: oids.map((entry) => prCommitNode(entry.oid, entry.login)),
          },
        },
      },
      rateLimit,
    },
  };
}

describe('GitHubClient.getMergedPrCommits', () => {
  it('requests the next search page when search.pageInfo.hasNextPage is true', async () => {
    const { calls, client } = scripted([
      searchPage([pullRequestNode(1, 'a1', null)], 'c2', 2),
      searchPage([pullRequestNode(2, 'b1', null)], null, 2),
    ]);
    const result = await client.getMergedPrCommits(TOKEN, PROFILE, MERGED_SINCE, [], createRateBudget());
    expect(calls.map((call) => call.query)).toEqual([MERGED_PR_COMMITS, MERGED_PR_COMMITS]);
    expect(calls[0]?.variables).toEqual({ q: 'author:monalisa is:pr is:merged merged:>=2023-01-08', cursor: null });
    expect(calls[1]?.variables.cursor).toBe('c2');
    expect(result.ok && result.data.items.map((commit) => commit.sha)).toEqual(['a1', 'b1']);
  });

  it('continues a pull request with PR_COMMITS when commits.pageInfo.hasNextPage is true', async () => {
    const { calls, client } = scripted([
      searchPage([pullRequestNode(7, 'a1', 'p2')], null),
      prCommitsPage([{ oid: 'a2' }], null),
    ]);
    const result = await client.getMergedPrCommits(TOKEN, PROFILE, MERGED_SINCE, [], createRateBudget());
    expect(calls[1]).toEqual({
      query: PR_COMMITS,
      variables: { owner: 'acme', name: 'widgets', number: 7, cursor: 'p2' },
    });
    expect(result.ok && result.data.items.map((commit) => commit.sha)).toEqual(['a1', 'a2']);
    expect(result.ok && result.data.items.every((commit) => commit.source === 'pr' && commit.branch === undefined)).toBe(true);
  });

  it('skips a pull request with a null repository or a FORBIDDEN error, and keeps the other', async () => {
    const forbidden = {
      ...searchPage([pullRequestNode(1, 'skip', null), pullRequestNode(2, 'keep', null)], null),
      errors: [{ type: 'FORBIDDEN', path: ['search', 'nodes', 0, 'repository'] }],
    };
    const bodies = [
      searchPage([pullRequestNode(1, 'skip', null, null), pullRequestNode(2, 'keep', null)], null),
      forbidden,
    ];
    for (const body of bodies) {
      const { client } = scripted([body]);
      const result = await client.getMergedPrCommits(TOKEN, PROFILE, MERGED_SINCE, [], createRateBudget());
      expect(result.ok && result.data.items.map((commit) => commit.sha)).toEqual(['keep']);
      expect(result.ok && result.data.truncated).toBe(false);
    }
  });

  it('makes no search request when the login fails LOGIN_PATTERN', async () => {
    const { calls, client } = scripted([]);
    await expect(client.getMergedPrCommits(TOKEN, 'not a login', MERGED_SINCE, [], createRateBudget())).resolves.toEqual({
      ok: true,
      data: { items: [], truncated: false },
    });
    expect(calls).toHaveLength(0);
  });

  it('keeps an unlinked commit when its email was saved, including on a follow-up page', async () => {
    const { client } = scripted([
      searchPage([pullRequestNode(7, 'a1', 'p2')], null),
      prCommitsPage([{ oid: 'e1', login: null }, { oid: 'nope', login: 'someone' }], null),
    ]);
    const kept = await client.getMergedPrCommits(TOKEN, PROFILE, MERGED_SINCE, ['dev@example.com'], createRateBudget());
    expect(kept.ok && kept.data.items.map((commit) => commit.sha)).toEqual(['a1', 'e1']);
  });

  it('drops an unlinked commit when its email was not saved', async () => {
    const unlinked = searchPage(
      [
        {
          number: 4,
          repository: { owner: { login: 'acme' }, name: 'widgets', isPrivate: false, isFork: false },
          commits: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [prCommitNode('e1', null)] },
        },
      ],
      null,
    );
    const { client } = scripted([unlinked]);
    const missed = await client.getMergedPrCommits(TOKEN, PROFILE, MERGED_SINCE, [], createRateBudget());
    expect(missed.ok && missed.data.items).toEqual([]);
  });

  it('sets truncated when issueCount is above 1000, and not when it is 1000', async () => {
    const over = await scripted([searchPage([pullRequestNode(1, 'a1', null)], null, 1001)]).client.getMergedPrCommits(
      TOKEN,
      PROFILE,
      MERGED_SINCE,
      [],
      createRateBudget(),
    );
    expect(over.ok && over.data.truncated).toBe(true);
    expect(over.ok && over.data.items).toHaveLength(1);

    const exact = await scripted([searchPage([pullRequestNode(1, 'a1', null)], null, 1000)]).client.getMergedPrCommits(
      TOKEN,
      PROFILE,
      MERGED_SINCE,
      [],
      createRateBudget(),
    );
    expect(exact.ok && exact.data.truncated).toBe(false);
  });

  it('stops before the next search page, and before a commit follow-up, when the budget falls below 200', async () => {
    const nextSearch = scripted([searchPage([pullRequestNode(1, 'a1', null)], 'c2', 2, LOW)]);
    const searchResult = await nextSearch.client.getMergedPrCommits(TOKEN, PROFILE, MERGED_SINCE, [], createRateBudget());
    expect(nextSearch.calls).toHaveLength(1);
    expect(searchResult.ok && searchResult.data.truncated).toBe(true);

    const followUp = scripted([searchPage([pullRequestNode(7, 'a1', 'p2')], null, 1, LOW)]);
    const followResult = await followUp.client.getMergedPrCommits(TOKEN, PROFILE, MERGED_SINCE, [], createRateBudget());
    expect(followUp.calls).toHaveLength(1);
    expect(followResult.ok && followResult.data.truncated).toBe(true);
  });

  it('keeps commits already gathered when a later search page fails', async () => {
    const { client } = scripted([
      searchPage([pullRequestNode(1, 'a1', null)], 'c2'),
      new Response('{}', { status: 502 }),
    ]);
    await expect(client.getMergedPrCommits(TOKEN, PROFILE, MERGED_SINCE, [], createRateBudget())).resolves.toEqual({
      ok: true,
      data: {
        items: [expect.objectContaining({ sha: 'a1' })],
        truncated: true,
        failure: { ok: false, error: 'NETWORK' },
      },
    });
  });
});

describe('GitHubClient.getBranchCommits author emails', () => {
  it('sends author emails as a variable, including on a history follow-up', async () => {
    const emails = { emails: ['dev@example.com'] };
    const { calls, client } = scripted([
      refsPage([{ name: 'main', oids: ['a1'], next: 'h1' }], null),
      historyPage(['a2'], null),
    ]);
    await client.getBranchCommits(TOKEN, REPO, emails, SINCE, createRateBudget());
    expect(calls[0]?.variables.author).toEqual(emails);
    expect(calls[1]?.variables.author).toEqual(emails);
    expect(calls[1]?.query).toBe(BRANCH_HISTORY);
  });
});
