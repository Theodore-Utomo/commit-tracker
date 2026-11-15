import { describe, expect, it, vi } from 'vitest';
import { localDay, startOfLocalDayIso } from '../../../src/core/aggregate';
import { gridDays } from '../../../src/core/grid';
import type { Commit, Contributions, RepoRef } from '../../../src/core/types';
import type { Response } from '../../../src/messaging/protocol';
import { SCHEMA_VERSION, createCacheStore, type CacheEntry, type CacheKey, type CacheStore } from '../../../src/services/cache/store';
import type { CommitAuthor, GitHubResult, Page, RateBudget } from '../../../src/services/github/client';
import type { ViewerAndUser } from '../../../src/services/github/mappers';
import { getContributions, type ContributionsDeps } from '../../../src/services/contributions';

const NEW_YORK = 'America/New_York';
const NOW = new Date('2024-01-11T17:00:00Z'); // 12:00 in New York: grid 2023-01-08 .. 2024-01-13
const SINCE = '2023-01-08T00:00:00-05:00';
const VIEWER = { login: 'monalisa', id: 'U_viewer' };
const PLENTY = { remaining: 4000, resetAt: '2024-01-11T18:00:00Z' };
const LOW = { remaining: 199, resetAt: '2024-01-11T18:00:00Z' };

function repo(name: string, overrides: Partial<RepoRef> = {}): RepoRef {
  return { owner: 'acme', name, isPrivate: false, isFork: false, ...overrides };
}

function commit(sha: string, r: RepoRef, overrides: Partial<Commit> = {}): Commit {
  return {
    sha,
    authoredDate: '2024-01-10T15:00:00Z',
    messageHeadline: `commit ${sha}`,
    repo: r,
    branch: 'main',
    source: 'branch',
    ...overrides,
  };
}

const page = <T>(items: T[], truncated = false): GitHubResult<Page<T>> => ({ ok: true, data: { items, truncated } });

type BranchAnswer = { result: GitHubResult<Page<Commit>>; rateLimit?: typeof PLENTY };

/**
 * A fake client. Like the real one, it records the rate limit only after an await, so tasks
 * the pool has already started see the budget as it was when they started.
 */
function fakeClient(options: {
  repos?: RepoRef[];
  reposRateLimit?: typeof PLENTY;
  listResult?: GitHubResult<Page<RepoRef>>;
  branches?: Record<string, BranchAnswer>;
  /** Answers for the `author: { emails }` pass. A missing repo answers with no commits. */
  emailBranches?: Record<string, BranchAnswer>;
  prs?: GitHubResult<Page<Commit>>;
  identity?: GitHubResult<ViewerAndUser>;
  /** Repositories returned by `listPublicRepos`. Defaults to none. */
  publicRepos?: RepoRef[];
  publicListResult?: GitHubResult<Page<RepoRef>>;
}) {
  const client = {
    getViewerAndUser: vi.fn(async (_token: string, login: string) => {
      if (options.identity) {
        return options.identity;
      }
      const user = login.toLowerCase() === VIEWER.login.toLowerCase() ? VIEWER : { login, id: `U_${login.toLowerCase()}` };
      return { ok: true as const, data: { viewer: VIEWER, user, restrictedContributionsCount: 0 } };
    }),
    listOwnerRepos: vi.fn(async (_token: string, _since: string, budget: RateBudget) => {
      await Promise.resolve();
      budget.record(options.reposRateLimit ?? PLENTY);
      return options.listResult ?? page(options.repos ?? []);
    }),
    listPublicRepos: vi.fn(async (_token: string, _login: string, _since: string, budget: RateBudget) => {
      await Promise.resolve();
      budget.record(options.reposRateLimit ?? PLENTY);
      return options.publicListResult ?? page(options.publicRepos ?? []);
    }),
    getBranchCommits: vi.fn(async (_token: string, r: RepoRef, author: CommitAuthor, _since: string, budget: RateBudget) => {
      await Promise.resolve();
      const table = 'emails' in author ? options.emailBranches : options.branches;
      const answer = table?.[r.name] ?? { result: page<Commit>([]) };
      budget.record(answer.rateLimit ?? PLENTY);
      return answer.result;
    }),
    getMergedPrCommits: vi.fn(async () => options.prs ?? page<Commit>([])),
  } satisfies ContributionsDeps['client'];
  return client;
}

function memoryCache(): CacheStore {
  const entries = new Map<string, CacheEntry>();
  const id = (key: CacheKey) =>
    `${key.viewerLogin.toLowerCase()}|${key.profileLogin.toLowerCase()}|${key.mode}|${SCHEMA_VERSION}`;
  return {
    get: vi.fn(async (key) => {
      const entry = entries.get(id(key));
      return entry !== undefined && entry.schemaVersion === SCHEMA_VERSION ? entry : undefined;
    }),
    put: vi.fn(async (key, entry) => {
      entries.set(id(key), entry);
    }),
    clear: vi.fn(async () => {
      entries.clear();
    }),
  };
}

function deps(
  client: ContributionsDeps['client'],
  options?: { token?: string | undefined; emails?: readonly string[]; cache?: CacheStore; now?: () => Date },
): ContributionsDeps {
  // A missing argument uses a token. Passing `token: undefined` is the no-token case.
  const token = options !== undefined && 'token' in options ? options.token : 'token';
  return {
    client,
    getToken: async () => token,
    getCommitEmails: vi.fn(async () => options?.emails ?? []),
    now: options?.now ?? (() => NOW),
    timeZone: NEW_YORK,
    cache: options?.cache ?? memoryCache(),
  };
}

/** A pull-request commit: `source: 'pr'` and no branch name. */
function prOnly(sha: string, r: RepoRef, overrides: Partial<Commit> = {}): Commit {
  return {
    sha,
    authoredDate: '2024-01-10T15:00:00Z',
    messageHeadline: `commit ${sha}`,
    repo: r,
    source: 'pr',
    ...overrides,
  };
}

function contributions(response: Response): Contributions {
  if (!response.ok || !('days' in response.data)) {
    throw new Error(`expected Contributions, got ${JSON.stringify(response)}`);
  }
  return response.data;
}

describe('getContributions: who is asked', () => {
  it('returns NO_TOKEN without calling GitHub when the token is missing or blank', async () => {
    for (const token of [undefined, '  ']) {
      const client = fakeClient({});
      const dependencies = deps(client, { token });
      await expect(getContributions('monalisa', dependencies)).resolves.toEqual({ ok: false, error: 'NO_TOKEN' });
      expect(client.getViewerAndUser).not.toHaveBeenCalled();
      expect(dependencies.getCommitEmails).not.toHaveBeenCalled();
    }
  });

  it('passes a viewer failure through, with resetAt only for RATE_LIMITED', async () => {
    const limited = fakeClient({ identity: { ok: false, error: 'RATE_LIMITED', resetAt: LOW.resetAt } });
    await expect(getContributions('monalisa', deps(limited))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
    const unauthorized = fakeClient({ identity: { ok: false, error: 'UNAUTHORIZED' } });
    await expect(getContributions('monalisa', deps(unauthorized))).resolves.toStrictEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    });
  });

  it('returns NOT_FOUND for an unknown login and lists no repositories', async () => {
    const client = fakeClient({ identity: { ok: false, error: 'NOT_FOUND' }, publicRepos: [repo('a')] });
    await expect(getContributions('ghost', deps(client))).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(client.listPublicRepos).not.toHaveBeenCalled();
    expect(client.listOwnerRepos).not.toHaveBeenCalled();
    expect(client.getBranchCommits).not.toHaveBeenCalled();
    expect(client.getMergedPrCommits).not.toHaveBeenCalled();
  });

  it('treats the viewer login case-insensitively', async () => {
    const client = fakeClient({ repos: [] });
    const result = await getContributions('MonaLisa', deps(client));
    expect(contributions(result).login).toBe('monalisa');
    expect(client.listOwnerRepos).toHaveBeenCalled();
  });
});

describe('getContributions: owner fetch', () => {
  it('lists repos and fetches each with the viewer id and the grid start in the local zone', async () => {
    const a = repo('a');
    const client = fakeClient({ repos: [a] });
    await getContributions('monalisa', deps(client));
    expect(client.listOwnerRepos).toHaveBeenCalledWith('token', SINCE, expect.anything());
    expect(client.getBranchCommits).toHaveBeenCalledTimes(1);
    expect(client.getBranchCommits).toHaveBeenCalledWith('token', a, { id: 'U_viewer' }, SINCE, expect.anything());
  });

  it('counts one SHA found on three branches once', async () => {
    const a = repo('a');
    const client = fakeClient({
      repos: [a],
      branches: {
        a: {
          result: page([
            commit('s1', a, { branch: 'main' }),
            commit('s1', a, { branch: 'feature' }),
            commit('s1', a, { branch: 'release' }),
          ]),
        },
      },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.totals.commits).toBe(1);
    expect(data.days['2024-01-10']?.count).toBe(1);
    expect(data.days['2024-01-10']?.commits).toEqual([commit('s1', a, { branch: 'main' })]);
  });

  it('returns owner-mode Contributions with every field set', async () => {
    const a = repo('a', { isPrivate: true });
    const b = repo('b');
    const client = fakeClient({
      repos: [a, b],
      branches: { a: { result: page([commit('s1', a)]) }, b: { result: page([commit('s2', b)]) } },
    });
    expect(contributions(await getContributions('monalisa', deps(client)))).toEqual({
      login: 'monalisa',
      mode: 'owner',
      days: { '2024-01-10': { date: '2024-01-10', count: 2, commits: [commit('s1', a), commit('s2', b)] } },
      totals: { commits: 2, repos: 2 },
      partial: false,
      fetchedAt: NOW.toISOString(),
    });
  });

  it('keeps commits from private repositories in owner mode', async () => {
    const secret = repo('secret', { isPrivate: true });
    const client = fakeClient({ repos: [secret], branches: { secret: { result: page([commit('p1', secret)]) } } });
    expect(contributions(await getContributions('monalisa', deps(client))).totals).toEqual({ commits: 1, repos: 1 });
  });

  it('drops a fork commit if one ever reaches the pipeline', async () => {
    const fork = repo('fork', { isFork: true });
    const client = fakeClient({ repos: [fork], branches: { fork: { result: page([commit('f1', fork)]) } } });
    expect(contributions(await getContributions('monalisa', deps(client))).totals.commits).toBe(0);
  });

  it('does not count a commit whose local day is before the grid start', async () => {
    const a = repo('a');
    const client = fakeClient({
      repos: [a],
      branches: {
        a: {
          result: page([
            commit('early', a, { authoredDate: '2023-01-08T04:00:00Z' }), // 2023-01-07 23:00 in New York
            commit('start', a, { authoredDate: '2023-01-08T05:00:00Z' }), // 2023-01-08 00:00 in New York
          ]),
        },
      },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.totals.commits).toBe(1);
    expect(Object.keys(data.days)).toEqual(['2023-01-08']);
  });

  // The client turns a null or forbidden repository into an empty, complete page
  // (client.test.ts covers that); here the pipeline must not treat it as a failure.
  it('still counts the other repositories when one is skipped as forbidden', async () => {
    const hidden = repo('hidden');
    const open = repo('open');
    const client = fakeClient({
      repos: [hidden, open],
      branches: { hidden: { result: page([]) }, open: { result: page([commit('o1', open)]) } },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.totals.commits).toBe(1);
    expect(data.partial).toBe(false);
  });

  it('returns an empty, complete result when the viewer has no commits', async () => {
    const client = fakeClient({ repos: [repo('a')] });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data).toMatchObject({ days: {}, totals: { commits: 0, repos: 0 }, partial: false });
  });
});

describe('getContributions: rate limits and failures', () => {
  it('returns RATE_LIMITED with resetAt when the budget is below 200 before any commit is kept', async () => {
    const client = fakeClient({ repos: [repo('a'), repo('b')], reposRateLimit: LOW });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
    expect(client.getBranchCommits).not.toHaveBeenCalled();
  });

  it('returns RATE_LIMITED when the repo list itself was cut short by the budget', async () => {
    const client = fakeClient({ listResult: page([], true), reposRateLimit: LOW });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
  });

  it('after one kept commit, starts no further repository, waits for those running, and returns partial', async () => {
    const repos = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'].map((name) => repo(name));
    const [r0] = repos as [RepoRef];
    const client = fakeClient({
      repos,
      branches: { r0: { result: page([commit('k1', r0)]), rateLimit: LOW } },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.partial).toBe(true);
    expect(data.totals.commits).toBe(1);
    expect(data.days['2024-01-10']?.commits).toEqual([commit('k1', r0)]);
    // The pool started 4 before any reply; r4 and r5 were never started.
    expect(client.getBranchCommits.mock.calls.map((call) => call[1].name)).toEqual(['r0', 'r1', 'r2', 'r3']);
  });

  it('turns a client RATE_LIMITED after one kept commit into a partial result with that commit', async () => {
    const a = repo('a');
    const b = repo('b');
    const client = fakeClient({
      repos: [a, b],
      branches: {
        a: { result: page([commit('k1', a)]) },
        b: { result: { ok: false, error: 'RATE_LIMITED', resetAt: LOW.resetAt } },
      },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.partial).toBe(true);
    expect(data.totals.commits).toBe(1);
  });

  it('keeps commits from a repository whose later page failed, and marks the result partial', async () => {
    const a = repo('a');
    const client = fakeClient({
      repos: [a],
      branches: {
        a: {
          result: { ok: true, data: { items: [commit('k1', a)], truncated: true, failure: { ok: false, error: 'NETWORK' } } },
        },
      },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.partial).toBe(true);
    expect(data.totals.commits).toBe(1);
  });

  it('stops starting repositories after a failure', async () => {
    const repos = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'].map((name) => repo(name));
    const client = fakeClient({
      repos,
      branches: { r0: { result: { ok: false, error: 'NETWORK' } } },
    });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({ ok: false, error: 'NETWORK' });
    expect(client.getBranchCommits).toHaveBeenCalledTimes(4);
  });

  it('returns the failure when it happens before any commit is kept', async () => {
    const client = fakeClient({
      repos: [repo('a')],
      branches: { a: { result: { ok: false, error: 'RATE_LIMITED', resetAt: LOW.resetAt } } },
    });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
  });

  it('returns RATE_LIMITED when a repository was cut short by the budget before any commit', async () => {
    const client = fakeClient({ repos: [repo('a')], branches: { a: { result: page([], true), rateLimit: LOW } } });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
  });

  it('returns a repo-list failure as the failure', async () => {
    const client = fakeClient({ listResult: { ok: false, error: 'NETWORK' } });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({ ok: false, error: 'NETWORK' });
  });

  it('treats a rejected repository task as UNKNOWN', async () => {
    const a = repo('a');
    const b = repo('b');
    const client = fakeClient({ repos: [a, b], branches: { b: { result: page([commit('k1', b)]) } } });
    client.getBranchCommits.mockImplementationOnce(async () => {
      throw new Error('unexpected');
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.partial).toBe(true);
    expect(data.totals.commits).toBe(1);

    const lone = fakeClient({ repos: [a] });
    lone.getBranchCommits.mockImplementationOnce(async () => {
      throw new Error('unexpected');
    });
    await expect(getContributions('monalisa', deps(lone))).resolves.toStrictEqual({ ok: false, error: 'UNKNOWN' });
  });
});

describe('getContributions: edges the first tests missed', () => {
  it('returns an empty, complete result when the budget is low but there are no repositories to fetch', async () => {
    const client = fakeClient({ repos: [], reposRateLimit: LOW });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data).toMatchObject({ days: {}, totals: { commits: 0, repos: 0 }, partial: false });
    expect(client.getBranchCommits).not.toHaveBeenCalled();
  });

  it('turns a client NETWORK result after one kept commit into a partial result with that commit', async () => {
    const a = repo('a');
    const b = repo('b');
    const client = fakeClient({
      repos: [a, b],
      branches: { a: { result: page([commit('k1', a)]) }, b: { result: { ok: false, error: 'NETWORK' } } },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.partial).toBe(true);
    expect(data.totals.commits).toBe(1);
  });

  it('does not count a commit dated after the grid end', async () => {
    const a = repo('a');
    const client = fakeClient({
      repos: [a],
      branches: {
        a: {
          result: page([
            commit('end', a, { authoredDate: '2024-01-14T04:59:00Z' }), // 2024-01-13 23:59 in New York
            commit('after', a, { authoredDate: '2024-01-14T05:00:00Z' }), // 2024-01-14 00:00 in New York
          ]),
        },
      },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(Object.keys(data.days)).toEqual(['2024-01-13']);
  });

  it('is not RATE_LIMITED when a repository was cut short for another reason with nothing kept', async () => {
    // The probe from the pass 2 rerun: a truncated, empty page while the budget is plentiful.
    const client = fakeClient({ repos: [repo('a')], branches: { a: { result: page([], true) } } });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data).toMatchObject({ days: {}, totals: { commits: 0, repos: 0 }, partial: true });
  });

  it('reports a low budget after the repo list as RATE_LIMITED even before the pool would notice', async () => {
    const client = fakeClient({ repos: [repo('a')], reposRateLimit: LOW });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
    expect(client.getBranchCommits).not.toHaveBeenCalled();
  });
});

describe('getContributions: merged pull requests and extra emails', () => {
  it('includes a commit that only the merged-pull-request search returns', async () => {
    const a = repo('a');
    const only = prOnly('pr1', a, { messageHeadline: 'Squashed' });
    const client = fakeClient({ repos: [a], prs: page([only]) });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.totals.commits).toBe(1);
    expect(data.partial).toBe(false);
    expect(data.days['2024-01-10']?.commits).toEqual([only]);
  });

  it('keeps one copy when a SHA comes from a branch and a pull request, and the copy is the branch one', async () => {
    const a = repo('a');
    const client = fakeClient({
      repos: [a],
      branches: { a: { result: page([commit('s1', a)]) } },
      prs: page([prOnly('s1', a, { messageHeadline: 'from the pull request' })]),
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.totals.commits).toBe(1);
    expect(data.days['2024-01-10']?.commits).toEqual([commit('s1', a)]);
  });

  it('searches with the viewer login and the grid start, not the URL text', async () => {
    const client = fakeClient({ repos: [] });
    await getContributions('MonaLisa', deps(client));
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', '2023-01-08', [], expect.anything(), '');
  });

  it('does not count a pull-request commit authored before the grid start', async () => {
    const a = repo('a');
    const client = fakeClient({
      repos: [a],
      prs: page([prOnly('early', a, { authoredDate: '2023-01-08T04:00:00Z' })]),
    });
    expect(contributions(await getContributions('monalisa', deps(client))).totals.commits).toBe(0);
  });

  it('fetches each repository again with the saved emails and counts a shared SHA once', async () => {
    const a = repo('a');
    const emails = ['dev@example.com'];
    const client = fakeClient({
      repos: [a],
      branches: { a: { result: page([commit('s1', a)]) } },
      emailBranches: {
        a: { result: page([commit('s1', a, { branch: 'feature' }), commit('e1', a)]) },
      },
    });
    const data = contributions(await getContributions('monalisa', deps(client, { emails })));
    expect(client.getBranchCommits).toHaveBeenNthCalledWith(1, 'token', a, { id: 'U_viewer' }, SINCE, expect.anything());
    expect(client.getBranchCommits).toHaveBeenNthCalledWith(2, 'token', a, { emails }, SINCE, expect.anything());
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', '2023-01-08', emails, expect.anything(), '');
    expect(data.totals.commits).toBe(2);
    expect(data.days['2024-01-10']?.commits).toEqual([commit('s1', a), commit('e1', a)]);
  });

  it('does not fetch by email when every saved entry is blank', async () => {
    const a = repo('a');
    const client = fakeClient({ repos: [a], branches: { a: { result: page([commit('s1', a)]) } } });
    await getContributions('monalisa', deps(client, { emails: ['  ', ''] }));
    expect(client.getBranchCommits).toHaveBeenCalledTimes(1);
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', '2023-01-08', [], expect.anything(), '');
  });

  it('keeps the branch commit and marks partial when the pull-request search is rate limited or the network fails', async () => {
    for (const error of ['RATE_LIMITED', 'NETWORK'] as const) {
      const a = repo('a');
      const failure =
        error === 'RATE_LIMITED'
          ? ({ ok: false, error, resetAt: LOW.resetAt } as const)
          : ({ ok: false, error } as const);
      const client = fakeClient({
        repos: [a],
        branches: { a: { result: page([commit('k1', a)]) } },
        prs: failure,
      });
      const data = contributions(await getContributions('monalisa', deps(client)));
      expect(data.partial).toBe(true);
      expect(data.totals.commits).toBe(1);
      expect(data.days['2024-01-10']?.commits).toEqual([commit('k1', a)]);
    }
  });

  it('drops a pull-request commit from a fork', async () => {
    const fork = repo('fork', { isFork: true });
    const client = fakeClient({ repos: [fork], prs: page([prOnly('f1', fork)]) });
    expect(contributions(await getContributions('monalisa', deps(client))).totals.commits).toBe(0);
  });

  it('returns RATE_LIMITED when the search fails before any commit is kept', async () => {
    const client = fakeClient({
      repos: [repo('a')],
      prs: { ok: false, error: 'RATE_LIMITED', resetAt: LOW.resetAt },
    });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
  });

  it('marks partial and does not search when the only repository ends under the rate-limit floor', async () => {
    const a = repo('a');
    const client = fakeClient({
      repos: [a],
      branches: { a: { result: page([commit('k1', a)]), rateLimit: LOW } },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.partial).toBe(true);
    expect(data.totals.commits).toBe(1);
    expect(client.getMergedPrCommits).not.toHaveBeenCalled();
  });

  it('returns RATE_LIMITED when that repository kept nothing', async () => {
    const client = fakeClient({
      repos: [repo('a')],
      branches: { a: { result: page([]), rateLimit: LOW } },
    });
    await expect(getContributions('monalisa', deps(client))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
    expect(client.getMergedPrCommits).not.toHaveBeenCalled();
  });

  it('keeps the id-pass commit when the email pass fails, and does not search', async () => {
    for (const error of ['RATE_LIMITED', 'NETWORK'] as const) {
      const a = repo('a');
      const failure =
        error === 'RATE_LIMITED'
          ? ({ ok: false, error, resetAt: LOW.resetAt } as const)
          : ({ ok: false, error } as const);
      const client = fakeClient({
        repos: [a],
        branches: { a: { result: page([commit('k1', a)]) } },
        emailBranches: { a: { result: failure } },
      });
      const data = contributions(await getContributions('monalisa', deps(client, { emails: ['dev@example.com'] })));
      expect(data.partial).toBe(true);
      expect(data.days['2024-01-10']?.commits).toEqual([commit('k1', a)]);
      expect(client.getBranchCommits).toHaveBeenCalledTimes(2);
      expect(client.getMergedPrCommits).not.toHaveBeenCalled();
    }
  });

  it('includes pull-request commits and marks partial when the search stops early', async () => {
    const a = repo('a');
    const pr = prOnly('pr1', a);
    for (const prs of [
      { ok: true as const, data: { items: [pr], truncated: true } },
      {
        ok: true as const,
        data: { items: [pr], truncated: true, failure: { ok: false as const, error: 'NETWORK' as const } },
      },
    ]) {
      const client = fakeClient({
        repos: [a],
        branches: { a: { result: page([commit('k1', a)]) } },
        prs,
      });
      const data = contributions(await getContributions('monalisa', deps(client)));
      expect(data.partial).toBe(true);
      expect(data.days['2024-01-10']?.commits).toEqual([commit('k1', a), pr]);
    }
  });

  it('does not fetch emails or search after a branch failure that already kept a commit', async () => {
    const a = repo('a');
    const b = repo('b');
    const client = fakeClient({
      repos: [a, b],
      branches: {
        a: { result: page([commit('k1', a)]) },
        b: { result: { ok: false, error: 'RATE_LIMITED', resetAt: LOW.resetAt } },
      },
    });
    const data = contributions(await getContributions('monalisa', deps(client, { emails: ['dev@example.com'] })));
    expect(data.partial).toBe(true);
    expect(data.totals.commits).toBe(1);
    expect(client.getBranchCommits).toHaveBeenCalledTimes(2);
    expect(client.getMergedPrCommits).not.toHaveBeenCalled();
  });

  it('does not search merged pull requests when the branch phase already stopped', async () => {
    const a = repo('a');
    const client = fakeClient({
      repos: [a],
      branches: { a: { result: page([commit('k1', a)], true) } },
    });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(data.partial).toBe(true);
    expect(data.totals.commits).toBe(1);
    expect(client.getMergedPrCommits).not.toHaveBeenCalled();
  });
});

const OVERLAP = '2023-12-28T17:00:00.000Z'; // NOW minus 14 days

describe('getContributions: cache', () => {
  it('misses, then stores lastSync as the clock time from before the first GitHub call', async () => {
    const a = repo('a');
    const cache = memoryCache();
    const marks: string[] = [];
    const client = fakeClient({
      repos: [a],
      branches: { a: { result: page([commit('s1', a)]) } },
    });
    client.getViewerAndUser.mockImplementation(async () => {
      marks.push('viewer');
      return { ok: true, data: { viewer: VIEWER, user: VIEWER, restrictedContributionsCount: 0 } };
    });
    const data = contributions(
      await getContributions(
        'monalisa',
        deps(client, {
          cache,
          now: () => {
            marks.push('now');
            return NOW;
          },
        }),
      ),
    );
    expect(marks[0]).toBe('now');
    expect(marks).toContain('viewer');
    expect(cache.get).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledWith(
      { viewerLogin: 'monalisa', profileLogin: 'monalisa', mode: 'owner' },
      expect.objectContaining({
        lastSync: NOW.toISOString(),
        schemaVersion: 1,
        contributions: data,
      }),
    );
    expect(NOW.toISOString()).not.toBe('2024-01-10T15:00:00Z');
    expect(client.listOwnerRepos).toHaveBeenCalledWith('token', SINCE, expect.anything());
  });

  it('on a hit, refetches from lastSync minus 14 days and counts a repeated SHA once', async () => {
    const a = repo('a');
    const cache = memoryCache();
    const client = fakeClient({
      repos: [a],
      branches: { a: { result: page([commit('s1', a)]) } },
    });
    const dependencies = deps(client, { cache });
    await getContributions('monalisa', dependencies);
    const again = contributions(await getContributions('monalisa', dependencies));

    expect(again.totals.commits).toBe(1);
    expect(client.listOwnerRepos).toHaveBeenLastCalledWith('token', OVERLAP, expect.anything());
    expect(client.getBranchCommits).toHaveBeenLastCalledWith('token', a, { id: 'U_viewer' }, OVERLAP, expect.anything());
    expect(client.getMergedPrCommits).toHaveBeenLastCalledWith('token', 'monalisa', '2023-12-28', [], expect.anything(), '');
  });

  it('counts a commit first returned on the second call with an authoredDate before the first lastSync', async () => {
    const a = repo('a');
    const late = commit('late', a, { authoredDate: '2024-01-05T15:00:00Z' });
    const client = fakeClient({ repos: [a] });
    let call = 0;
    client.getBranchCommits.mockImplementation(async () => {
      call += 1;
      return page(call === 1 ? [commit('s1', a)] : [commit('s1', a), late]);
    });
    const dependencies = deps(client, { cache: memoryCache() });
    await getContributions('monalisa', dependencies);
    const again = contributions(await getContributions('monalisa', dependencies));
    expect(again.totals.commits).toBe(2);
    expect(again.days['2024-01-05']?.commits).toEqual([late]);
  });

  it('on a hit, searches merged pull requests by the UTC day of the since timestamp', async () => {
    const tokyo = 'Asia/Tokyo';
    const gridStartDay = gridDays(localDay(NOW.toISOString(), tokyo))[0] as string;
    const gridStartIso = startOfLocalDayIso(gridStartDay, tokyo);
    const utcDay = new Date(gridStartIso).toISOString().slice(0, 10);
    expect(utcDay < gridStartDay).toBe(true);

    const cache = memoryCache();
    await cache.put(
      { viewerLogin: 'monalisa', profileLogin: 'monalisa', mode: 'owner' },
      {
        schemaVersion: 1,
        lastSync: new Date(gridStartIso).toISOString(),
        contributions: {
          login: 'monalisa',
          mode: 'owner',
          days: {},
          totals: { commits: 0, repos: 0 },
          partial: false,
          fetchedAt: NOW.toISOString(),
        },
      },
    );
    const client = fakeClient({ repos: [repo('a')] });
    await getContributions('monalisa', { ...deps(client, { cache }), timeZone: tokyo });
    expect(client.listOwnerRepos).toHaveBeenCalledWith('token', gridStartIso, expect.anything());
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', utcDay, [], expect.anything(), '');
  });

  it('uses the grid start when lastSync minus 14 days is earlier than the grid', async () => {
    const a = repo('a');
    const cache = memoryCache();
    await cache.put(
      { viewerLogin: 'monalisa', profileLogin: 'monalisa', mode: 'owner' },
      {
        schemaVersion: 1,
        lastSync: '2023-01-10T17:00:00.000Z',
        contributions: {
          login: 'monalisa',
          mode: 'owner',
          days: {},
          totals: { commits: 0, repos: 0 },
          partial: false,
          fetchedAt: '2023-01-10T17:00:00.000Z',
        },
      },
    );
    const client = fakeClient({ repos: [a] });
    await getContributions('monalisa', deps(client, { cache }));
    expect(client.listOwnerRepos).toHaveBeenCalledWith('token', SINCE, expect.anything());
    expect(client.getBranchCommits).toHaveBeenCalledWith('token', a, { id: 'U_viewer' }, SINCE, expect.anything());
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', '2023-01-08', [], expect.anything(), '');
  });

  it('drops a stored commit whose day has rolled out of the grid', async () => {
    const a = repo('a');
    const early = commit('early', a, { authoredDate: '2023-01-10T15:00:00Z' });
    const kept = commit('kept', a);
    const client = fakeClient({ repos: [a] });
    let call = 0;
    client.getBranchCommits.mockImplementation(async () => {
      call += 1;
      return page(call === 1 ? [early, kept] : []);
    });
    let now = NOW;
    const dependencies = deps(client, { cache: memoryCache(), now: () => now });
    const first = contributions(await getContributions('monalisa', dependencies));
    expect(first.days['2023-01-10']?.count).toBe(1);

    now = new Date('2024-01-18T17:00:00Z');
    const newStart = gridDays(localDay(now.toISOString(), NEW_YORK))[0] as string;
    expect(localDay(early.authoredDate, NEW_YORK) < newStart).toBe(true);
    const again = contributions(await getContributions('monalisa', dependencies));
    expect(again.days['2023-01-10']).toBeUndefined();
    expect(again.days['2024-01-10']?.commits).toEqual([kept]);
    expect(again.totals).toEqual({ commits: 1, repos: 1 });
  });

  it('does not write a partial result', async () => {
    const a = repo('a');
    const cache = memoryCache();
    const client = fakeClient({
      repos: [a],
      branches: { a: { result: page([commit('k1', a)], true) } },
    });
    const data = contributions(await getContributions('monalisa', deps(client, { cache })));
    expect(data.partial).toBe(true);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('treats a stored schemaVersion other than 1 as a miss and fetches from the grid start', async () => {
    const cache = createCacheStore();
    await cache.clear();
    await cache.put(
      { viewerLogin: 'monalisa', profileLogin: 'monalisa', mode: 'owner' },
      {
        schemaVersion: 0,
        lastSync: NOW.toISOString(),
        contributions: {
          login: 'monalisa',
          mode: 'owner',
          days: {},
          totals: { commits: 0, repos: 0 },
          partial: false,
          fetchedAt: NOW.toISOString(),
        },
      },
    );
    const client = fakeClient({ repos: [repo('a')] });
    await getContributions('monalisa', deps(client, { cache }));
    expect(client.listOwnerRepos).toHaveBeenCalledWith('token', SINCE, expect.anything());
    expect(client.getBranchCommits).toHaveBeenCalledWith('token', repo('a'), { id: 'U_viewer' }, SINCE, expect.anything());
  });
});

const HUBOT = { login: 'hubot', id: 'U_hubot' };

function hubotIdentity(restrictedContributionsCount = 0): GitHubResult<ViewerAndUser> {
  return { ok: true, data: { viewer: VIEWER, user: HUBOT, restrictedContributionsCount } };
}

describe('getContributions: another profile is public only', () => {
  it('lists public repos for the profile user and does not list the viewer affiliation', async () => {
    const open = repo('open');
    const secret = repo('secret', { isPrivate: true });
    const client = fakeClient({ identity: hubotIdentity(5), publicRepos: [open, secret] });
    const dependencies = deps(client, { emails: ['dev@example.com'] });
    const data = contributions(await getContributions('Hubot', dependencies));

    expect(data.mode).toBe('publicOnly');
    expect(data.login).toBe('hubot');
    expect(client.listPublicRepos).toHaveBeenCalledWith('token', 'hubot', SINCE, expect.anything());
    expect(client.listOwnerRepos).not.toHaveBeenCalled();
    expect(client.getBranchCommits).toHaveBeenCalledTimes(1);
    expect(client.getBranchCommits).toHaveBeenCalledWith('token', open, { id: 'U_hubot' }, SINCE, expect.anything());
    expect(dependencies.getCommitEmails).not.toHaveBeenCalled();
  });

  it('treats Octocat and octocat as the viewer and still lists owner repos', async () => {
    const client = fakeClient({
      identity: {
        ok: true,
        data: {
          viewer: { login: 'octocat', id: 'U_octo' },
          user: { login: 'octocat', id: 'U_octo' },
          restrictedContributionsCount: 0,
        },
      },
    });
    await getContributions('Octocat', deps(client));
    expect(client.listOwnerRepos).toHaveBeenCalled();
    expect(client.listPublicRepos).not.toHaveBeenCalled();
  });

  it('searches with the login GitHub returned and keeps a private pull request off the days', async () => {
    const open = repo('open');
    const secretRepo = repo('secret', { isPrivate: true });
    const kept = prOnly('pub1', open);
    const hidden = prOnly('priv1', secretRepo, { messageHeadline: 'private work' });
    const client = fakeClient({ identity: hubotIdentity(), publicRepos: [open], prs: page([kept, hidden]) });
    const data = contributions(await getContributions('Hubot', deps(client)));

    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'hubot', '2023-01-08', [], expect.anything(), ' is:public');
    expect(data.days['2024-01-10']?.commits).toEqual([kept]);
    expect(JSON.stringify(data)).not.toContain('secret');
    expect(JSON.stringify(data)).not.toContain('private work');
  });

  it('keeps a private owner pull request and does not add is:public', async () => {
    const secretRepo = repo('secret', { isPrivate: true });
    const hidden = prOnly('priv1', secretRepo, { messageHeadline: 'private work' });
    const client = fakeClient({ repos: [], prs: page([hidden]) });
    const data = contributions(await getContributions('monalisa', deps(client)));
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', '2023-01-08', [], expect.anything(), '');
    expect(data.days['2024-01-10']?.commits).toEqual([hidden]);
    expect(data.mode).toBe('owner');
  });

  it('caches publicOnly on its own key and does not read an owner entry for that profile', async () => {
    const cache = memoryCache();
    const secret = commit('secret', repo('hidden', { isPrivate: true }), { messageHeadline: 'do not leak' });
    await cache.put(
      { viewerLogin: 'monalisa', profileLogin: 'hubot', mode: 'owner' },
      {
        schemaVersion: SCHEMA_VERSION,
        lastSync: NOW.toISOString(),
        contributions: {
          login: 'hubot',
          mode: 'owner',
          days: { '2024-01-10': { date: '2024-01-10', count: 1, commits: [secret] } },
          totals: { commits: 1, repos: 1 },
          partial: false,
          fetchedAt: NOW.toISOString(),
        },
      },
    );
    const client = fakeClient({ identity: hubotIdentity(), publicRepos: [] });
    const data = contributions(await getContributions('hubot', deps(client, { cache })));
    expect(data.mode).toBe('publicOnly');
    expect(data.totals.commits).toBe(0);
    expect(JSON.stringify(data)).not.toContain('do not leak');
    expect(cache.get).toHaveBeenCalledWith({ viewerLogin: 'monalisa', profileLogin: 'hubot', mode: 'publicOnly' });
    expect(cache.put).toHaveBeenCalledWith(
      { viewerLogin: 'monalisa', profileLogin: 'hubot', mode: 'publicOnly' },
      expect.objectContaining({ schemaVersion: SCHEMA_VERSION, contributions: data }),
    );
  });

  it('does not write a partial publicOnly result', async () => {
    const open = repo('open');
    const cache = memoryCache();
    const client = fakeClient({
      identity: hubotIdentity(),
      publicRepos: [open],
      branches: { open: { result: page([commit('k1', open)], true) } },
    });
    const data = contributions(await getContributions('hubot', deps(client, { cache })));
    expect(data.partial).toBe(true);
    expect(data.mode).toBe('publicOnly');
    expect(cache.put).not.toHaveBeenCalled();
  });
});
