import { describe, expect, it, vi } from 'vitest';
import type { Commit, Contributions, RepoRef } from '../../../src/core/types';
import type { Response } from '../../../src/messaging/protocol';
import type { CommitAuthor, GitHubResult, Page, RateBudget } from '../../../src/services/github/client';
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
  viewer?: GitHubResult<typeof VIEWER>;
}) {
  const client = {
    getViewer: vi.fn(async () => options.viewer ?? ({ ok: true, data: VIEWER } as const)),
    listOwnerRepos: vi.fn(async (_token: string, _since: string, budget: RateBudget) => {
      await Promise.resolve();
      budget.record(options.reposRateLimit ?? PLENTY);
      return options.listResult ?? page(options.repos ?? []);
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

function deps(
  client: ContributionsDeps['client'],
  options?: { token?: string | undefined; emails?: readonly string[] },
): ContributionsDeps {
  // A missing argument uses a token. Passing `token: undefined` is the no-token case.
  const token = options !== undefined && 'token' in options ? options.token : 'token';
  return {
    client,
    getToken: async () => token,
    getCommitEmails: vi.fn(async () => options?.emails ?? []),
    now: () => NOW,
    timeZone: NEW_YORK,
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
      expect(client.getViewer).not.toHaveBeenCalled();
      expect(dependencies.getCommitEmails).not.toHaveBeenCalled();
    }
  });

  it('passes a viewer failure through, with resetAt only for RATE_LIMITED', async () => {
    const limited = fakeClient({ viewer: { ok: false, error: 'RATE_LIMITED', resetAt: LOW.resetAt } });
    await expect(getContributions('monalisa', deps(limited))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: LOW.resetAt,
    });
    const unauthorized = fakeClient({ viewer: { ok: false, error: 'UNAUTHORIZED' } });
    await expect(getContributions('monalisa', deps(unauthorized))).resolves.toStrictEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    });
  });

  it('returns { viewerLogin } for another login and fetches nothing more', async () => {
    const client = fakeClient({ repos: [repo('a')] });
    const dependencies = deps(client);
    await expect(getContributions('octocat', dependencies)).resolves.toEqual({
      ok: true,
      data: { viewerLogin: 'monalisa' },
    });
    expect(client.listOwnerRepos).not.toHaveBeenCalled();
    expect(client.getBranchCommits).not.toHaveBeenCalled();
    expect(client.getMergedPrCommits).not.toHaveBeenCalled();
    expect(dependencies.getCommitEmails).not.toHaveBeenCalled();
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
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', '2023-01-08', [], expect.anything());
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
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', '2023-01-08', emails, expect.anything());
    expect(data.totals.commits).toBe(2);
    expect(data.days['2024-01-10']?.commits).toEqual([commit('s1', a), commit('e1', a)]);
  });

  it('does not fetch by email when every saved entry is blank', async () => {
    const a = repo('a');
    const client = fakeClient({ repos: [a], branches: { a: { result: page([commit('s1', a)]) } } });
    await getContributions('monalisa', deps(client, { emails: ['  ', ''] }));
    expect(client.getBranchCommits).toHaveBeenCalledTimes(1);
    expect(client.getMergedPrCommits).toHaveBeenCalledWith('token', 'monalisa', '2023-01-08', [], expect.anything());
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
