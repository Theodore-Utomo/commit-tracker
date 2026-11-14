import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetContributionsRequest } from '../../../src/messaging/protocol';
import type { CacheEntry, CacheStore } from '../../../src/services/cache/store';
import type { ContributionsDeps, getContributions } from '../../../src/services/contributions';
import type { GitHubClient } from '../../../src/services/github/client';
import { handleClearCache, handleGetContributions, onTokenChanged } from '../../../src/services/handle-message';

const request: GetContributionsRequest = { type: 'GET_CONTRIBUTIONS', login: 'octocat' };

function fakeClient(getViewer: GitHubClient['getViewer']) {
  return {
    getViewer: vi.fn(getViewer),
    listOwnerRepos: vi.fn<GitHubClient['listOwnerRepos']>(async () => ({ ok: true, data: { items: [], truncated: false } })),
    getBranchCommits: vi.fn<GitHubClient['getBranchCommits']>(async () => ({ ok: true, data: { items: [], truncated: false } })),
    getMergedPrCommits: vi.fn<GitHubClient['getMergedPrCommits']>(async () => ({
      ok: true,
      data: { items: [], truncated: false },
    })),
  };
}

const NOW = new Date('2024-01-11T17:00:00Z');

function memoryCache(): CacheStore {
  return {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
}

/** Fills in the clock, time zone, and cache, which these tests do not exercise. */
function withDeps(partial: Pick<ContributionsDeps, 'getToken' | 'client'> & { cache?: CacheStore }): ContributionsDeps {
  return {
    getCommitEmails: async () => [],
    now: () => NOW,
    timeZone: 'America/New_York',
    cache: memoryCache(),
    ...partial,
  };
}

const viewerClient = () => fakeClient(async () => ({ ok: true, data: { login: 'monalisa', id: 'U_1' } }));

beforeEach(() => {
  onTokenChanged();
});

describe('handleGetContributions', () => {
  it('returns NO_TOKEN without calling the client when the token is missing or blank', async () => {
    for (const token of [undefined, '   ']) {
      const client = viewerClient();
      await expect(handleGetContributions(request, withDeps({ getToken: async () => token, client }))).resolves.toEqual({
        ok: false,
        error: 'NO_TOKEN',
      });
      expect(client.getViewer).not.toHaveBeenCalled();
    }
  });

  it('returns NOT_FOUND without reading the token or calling the client for an invalid login', async () => {
    const client = viewerClient();
    const getToken = vi.fn(async () => 'token');
    await expect(
      handleGetContributions({ type: 'GET_CONTRIBUTIONS', login: 'octo%20cat' }, withDeps({ getToken, client })),
    ).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(client.getViewer).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('returns the viewer login and passes the trimmed token to the client', async () => {
    const client = viewerClient();
    await expect(handleGetContributions(request, withDeps({ getToken: async () => ' token ', client }))).resolves.toEqual({
      ok: true,
      data: { viewerLogin: 'monalisa' },
    });
    expect(client.getViewer).toHaveBeenCalledWith('token');
  });

  it('passes UNAUTHORIZED through from the client', async () => {
    const client = fakeClient(async () => ({ ok: false, error: 'UNAUTHORIZED' }));
    await expect(handleGetContributions(request, withDeps({ getToken: async () => 'token', client }))).resolves.toEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    });
  });

  it('passes RATE_LIMITED through with resetAt', async () => {
    const resetAt = '2026-11-13T01:00:00.000Z';
    const client = fakeClient(async () => ({ ok: false, error: 'RATE_LIMITED', resetAt }));
    await expect(handleGetContributions(request, withDeps({ getToken: async () => 'token', client }))).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt,
    });
  });

  it('adds no resetAt key to RATE_LIMITED when the client has none', async () => {
    const client = fakeClient(async () => ({ ok: false, error: 'RATE_LIMITED' }));
    await expect(handleGetContributions(request, withDeps({ getToken: async () => 'token', client }))).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
    });
  });

  it('sends only the viewer login to the page, even when the client result carries errors', async () => {
    const client = fakeClient(async () => ({
      ok: true,
      data: { login: 'monalisa', id: 'U_1' },
      errors: [{ type: 'FORBIDDEN', path: ['viewer', 'organization'] }],
    }));
    await expect(handleGetContributions(request, withDeps({ getToken: async () => 'token', client }))).resolves.toStrictEqual({
      ok: true,
      data: { viewerLogin: 'monalisa' },
    });
  });

  it('never attaches resetAt to a failure other than RATE_LIMITED', async () => {
    const client = fakeClient(async () => ({ ok: false, error: 'NETWORK', resetAt: '2026-11-13T01:00:00.000Z' }));
    await expect(handleGetContributions(request, withDeps({ getToken: async () => 'token', client }))).resolves.toEqual({
      ok: false,
      error: 'NETWORK',
    });
  });

  it('turns a thrown TypeError into NETWORK and any other throw into UNKNOWN', async () => {
    const network = fakeClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    const mapper = fakeClient(async () => {
      throw new Error('GraphQL response has no viewer.');
    });
    const getToken = async () => 'token';

    await expect(handleGetContributions(request, withDeps({ getToken, client: network }))).resolves.toEqual({
      ok: false,
      error: 'NETWORK',
    });
    await expect(handleGetContributions(request, withDeps({ getToken, client: mapper }))).resolves.toEqual({
      ok: false,
      error: 'UNKNOWN',
    });
  });

  it('turns a getToken rejection into UNKNOWN instead of throwing', async () => {
    const client = viewerClient();
    const getToken = async (): Promise<string> => {
      throw new Error('storage unavailable');
    };
    await expect(handleGetContributions(request, withDeps({ getToken, client }))).resolves.toEqual({
      ok: false,
      error: 'UNKNOWN',
    });
  });
});

describe('handleGetContributions and the branch-commits pipeline', () => {
  const ownClient = () => fakeClient(async () => ({ ok: true, data: { login: 'octocat', id: 'U_octo' } }));

  it("returns Contributions for the viewer's own login", async () => {
    const result = await handleGetContributions(request, withDeps({ getToken: async () => 'token', client: ownClient() }));
    expect(result).toMatchObject({ ok: true, data: { login: 'octocat', mode: 'owner', partial: false } });
  });

  it('returns { viewerLogin } for another login and lists no repositories', async () => {
    const client = viewerClient();
    const result = await handleGetContributions(request, withDeps({ getToken: async () => 'token', client }));
    expect(result).toEqual({ ok: true, data: { viewerLogin: 'monalisa' } });
    expect(client.listOwnerRepos).not.toHaveBeenCalled();
  });

  it('forwards the login and the original deps to getContributions and returns its Response', async () => {
    const deps = withDeps({ getToken: async () => 'token', client: ownClient() });
    const reply = { ok: false, error: 'RATE_LIMITED', resetAt: '2024-01-11T18:00:00Z' } as const;
    const run = vi.fn<typeof getContributions>(async () => reply);
    await expect(handleGetContributions(request, deps, run)).resolves.toBe(reply);
    expect(run).toHaveBeenCalledWith(
      'octocat',
      expect.objectContaining({
        client: deps.client,
        getToken: deps.getToken,
        getCommitEmails: deps.getCommitEmails,
        now: deps.now,
        timeZone: deps.timeZone,
      }),
    );
    const passed = run.mock.calls[0]?.[1];
    expect(passed?.startedAt).toBe(NOW);
    expect(passed?.resolvedViewer).toEqual({ ok: true, data: { login: 'octocat', id: 'U_octo' } });
    expect(passed?.canWrite?.()).toBe(true);
  });

  it('does not call the pipeline for an invalid login', async () => {
    const run = vi.fn();
    await handleGetContributions(
      { type: 'GET_CONTRIBUTIONS', login: '-bad' },
      withDeps({ getToken: async () => 'token', client: ownClient() }),
      run,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('turns a pipeline that throws into UNKNOWN', async () => {
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      handleGetContributions(request, withDeps({ getToken: async () => 'token', client: ownClient() }), run),
    ).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });
});

const SINCE = '2023-01-08T00:00:00-05:00';

function ownClient() {
  return fakeClient(async () => ({ ok: true, data: { login: 'octocat', id: 'U_octo' } }));
}

/** `listOwnerRepos` waits until `release` so a second request can overlap the first. */
function pauseRepos(client: ReturnType<typeof fakeClient>): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  client.listOwnerRepos.mockImplementation(async () => {
    await gate;
    return { ok: true, data: { items: [], truncated: false } };
  });
  return release;
}

describe('in-flight requests and clear cache', () => {
  it('shares one listOwnerRepos when two requests have the same viewer and profile', async () => {
    const client = ownClient();
    const release = pauseRepos(client);
    const deps = withDeps({ getToken: async () => 'token', client });
    const first = handleGetContributions(request, deps);
    await vi.waitUntil(() => client.listOwnerRepos.mock.calls.length === 1);
    const second = handleGetContributions(request, deps);
    await Promise.resolve();
    expect(client.listOwnerRepos).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(client.listOwnerRepos).toHaveBeenCalledTimes(1);
  });

  it('does not join a request whose viewer is different', async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return calls === 1
        ? { ok: true, data: { login: 'octocat', id: 'U_octo' } }
        : { ok: true, data: { login: 'monalisa', id: 'U_1' } };
    });
    const release = pauseRepos(client);
    const deps = withDeps({ getToken: async () => 'token', client });
    const first = handleGetContributions(request, deps);
    await vi.waitUntil(() => client.listOwnerRepos.mock.calls.length === 1);
    await expect(handleGetContributions(request, deps)).resolves.toEqual({
      ok: true,
      data: { viewerLogin: 'monalisa' },
    });
    expect(client.listOwnerRepos).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('does not publish a flight when the token changes during getViewer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
      }
      return { ok: true, data: { login: 'octocat', id: 'U_octo' } };
    });
    const cache = memoryCache();
    const deps = withDeps({ getToken: async () => 'token', client, cache });
    const first = handleGetContributions(request, deps);
    await vi.waitUntil(() => calls === 1);
    onTokenChanged();
    release();
    await vi.waitUntil(() => client.listOwnerRepos.mock.calls.length === 1);
    const second = handleGetContributions(request, deps);
    await Promise.all([first, second]);
    expect(client.listOwnerRepos).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('after a token change, a new request does not join and the old request does not put', async () => {
    const client = ownClient();
    const release = pauseRepos(client);
    const cache = memoryCache();
    const deps = withDeps({ getToken: async () => 'token', client, cache });
    const first = handleGetContributions(request, deps);
    await vi.waitUntil(() => client.listOwnerRepos.mock.calls.length === 1);
    onTokenChanged();
    const second = handleGetContributions(request, deps);
    await vi.waitUntil(() => client.listOwnerRepos.mock.calls.length === 2);
    release();
    await Promise.all([first, second]);
    expect(client.listOwnerRepos).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('CLEAR_CACHE returns { cleared: true }', async () => {
    const cache = memoryCache();
    await expect(handleClearCache(cache)).resolves.toEqual({ ok: true, data: { cleared: true } });
    expect(cache.clear).toHaveBeenCalledOnce();
  });

  it('returns UNKNOWN when clearing the cache rejects', async () => {
    const cache: CacheStore = {
      get: async () => undefined,
      put: async () => undefined,
      clear: async () => {
        throw new Error('IndexedDB unavailable');
      },
    };
    await expect(handleClearCache(cache)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it('does not keep a put that was in flight when the token changed', async () => {
    const entries = new Map<string, CacheEntry>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let gated = false;
    const cache: CacheStore = {
      get: async (key) => {
        const entry = entries.get(`${key.viewerLogin}|${key.profileLogin}|${key.mode}`);
        return entry?.schemaVersion === 1 ? entry : undefined;
      },
      put: async (key, entry) => {
        if (!gated) {
          gated = true;
          markStarted();
          await gate;
        }
        entries.set(`${key.viewerLogin}|${key.profileLogin}|${key.mode}`, entry);
      },
      clear: async () => {
        entries.clear();
      },
    };
    const client = ownClient();
    const pending = handleGetContributions(request, withDeps({ getToken: async () => 'token', client, cache }));
    await started;
    onTokenChanged();
    release();
    await pending;
    await expect(cache.get({ viewerLogin: 'octocat', profileLogin: 'octocat', mode: 'owner' })).resolves.toBeUndefined();
    await handleGetContributions(request, withDeps({ getToken: async () => 'token', client, cache }));
    expect(client.listOwnerRepos).toHaveBeenCalledTimes(2);
  });

  it('does not keep a put that started before clear', async () => {
    const entries = new Map<string, unknown>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const cache: CacheStore = {
      get: async () => undefined,
      put: async (_key, entry) => {
        markStarted();
        await gate;
        entries.set('written', entry);
      },
      clear: async () => {
        entries.clear();
      },
    };
    const pending = handleGetContributions(request, withDeps({ getToken: async () => 'token', client: ownClient(), cache }));
    await started;
    const clearing = handleClearCache(cache);
    release();
    await pending;
    await clearing;
    expect(entries.size).toBe(0);
  });

  it('starts a new fetch after clear instead of joining, and the next since is the grid start', async () => {
    const client = ownClient();
    const release = pauseRepos(client);
    const cache = memoryCache();
    const deps = withDeps({ getToken: async () => 'token', client, cache });
    const first = handleGetContributions(request, deps);
    await vi.waitUntil(() => client.listOwnerRepos.mock.calls.length === 1);
    const clearing = handleClearCache(cache);
    const second = handleGetContributions(request, deps);
    await vi.waitUntil(() => client.listOwnerRepos.mock.calls.length === 2);
    release();
    await Promise.all([first, second, clearing]);
    expect(client.listOwnerRepos).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(client.listOwnerRepos.mock.calls[1]?.[1]).toBe(SINCE);
  });

  it('fetches from the grid start on the request after a finished clear', async () => {
    const entries = new Map<string, Parameters<CacheStore['put']>[1]>();
    const cache: CacheStore = {
      get: vi.fn(async (key) => entries.get(`${key.viewerLogin}|${key.profileLogin}|${key.mode}`)),
      put: vi.fn(async (key, entry) => {
        entries.set(`${key.viewerLogin}|${key.profileLogin}|${key.mode}`, entry);
      }),
      clear: vi.fn(async () => {
        entries.clear();
      }),
    };
    const client = ownClient();
    const deps = withDeps({ getToken: async () => 'token', client, cache });
    await handleGetContributions(request, deps);
    expect(cache.put).toHaveBeenCalledTimes(1);
    await handleClearCache(cache);
    await handleGetContributions(request, deps);
    expect(client.listOwnerRepos).toHaveBeenCalledTimes(2);
    expect(client.listOwnerRepos.mock.calls[1]?.[1]).toBe(SINCE);
  });
});
