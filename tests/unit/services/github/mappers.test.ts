import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RepoRef } from '../../../../src/core/types';
import {
  mapBranchCommits,
  mapBranchHistory,
  mapRateLimit,
  mapRepos,
  mapViewer,
} from '../../../../src/services/github/mappers';

const repo: RepoRef = { owner: 'acme', name: 'widgets', isPrivate: false, isFork: false };
const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/branch-history.json', import.meta.url), 'utf8'),
) as { data: unknown };

describe('mapViewer', () => {
  it('maps a viewer payload to login and id', () => {
    expect(mapViewer({ viewer: { login: 'octocat', id: 'MDQ6VXNlcjU4MzIzMQ==' } })).toEqual({
      login: 'octocat',
      id: 'MDQ6VXNlcjU4MzIzMQ==',
    });
  });

  it('rejects a payload with no viewer', () => {
    expect(() => mapViewer({})).toThrow();
    expect(() => mapViewer(null)).toThrow();
    expect(() => mapViewer({ viewer: null })).toThrow();
  });

  it('rejects a viewer missing its login or id', () => {
    expect(() => mapViewer({ viewer: { login: 'octocat' } })).toThrow();
    expect(() => mapViewer({ viewer: { id: 'x', login: 7 } })).toThrow();
  });
});

describe('mapRateLimit', () => {
  it('reads remaining and resetAt', () => {
    expect(mapRateLimit(fixture.data)).toEqual({ remaining: 4980, resetAt: '2024-01-11T13:00:00Z' });
  });

  it('returns undefined when the block is missing or malformed', () => {
    expect(mapRateLimit({})).toBeUndefined();
    expect(mapRateLimit({ rateLimit: { remaining: '12', resetAt: 'x' } })).toBeUndefined();
  });
});

describe('mapRepos', () => {
  const page = (nodes: unknown[], hasNextPage = false) => ({
    viewer: { repositories: { pageInfo: { hasNextPage, endCursor: 'next' }, nodes } },
  });
  const node = (overrides: Record<string, unknown> = {}) => ({
    name: 'widgets',
    owner: { login: 'acme' },
    isPrivate: false,
    isFork: false,
    pushedAt: '2024-01-10T00:00:00Z',
    ...overrides,
  });

  it('maps a repository node to a RepoRef and keeps pushedAt', () => {
    expect(mapRepos(page([node({ isPrivate: true })]))).toEqual({
      repos: [{ repo: { owner: 'acme', name: 'widgets', isPrivate: true, isFork: false }, pushedAt: '2024-01-10T00:00:00Z' }],
      nextCursor: null,
    });
  });

  it('does not return a fork', () => {
    expect(mapRepos(page([node({ isFork: true }), node({ name: 'kept' })])).repos.map((r) => r.repo.name)).toEqual([
      'kept',
    ]);
  });

  it('drops null and malformed nodes, such as a repository hidden by SAML', () => {
    const repos = mapRepos(page([null, node({ owner: null }), node({ name: 'kept' })])).repos;
    expect(repos.map((r) => r.repo.name)).toEqual(['kept']);
  });

  it('keeps a missing pushedAt as null', () => {
    expect(mapRepos(page([node({ pushedAt: null })])).repos[0]?.pushedAt).toBeNull();
  });

  it('returns the next cursor only when there is another page', () => {
    expect(mapRepos(page([], true)).nextCursor).toBe('next');
    expect(mapRepos(page([], false)).nextCursor).toBeNull();
    expect(mapRepos({ viewer: { repositories: null } })).toEqual({ repos: [], nextCursor: null });
  });
});

describe('mapBranchCommits', () => {
  it('turns each branch history node into a Commit with source "branch"', () => {
    const page = mapBranchCommits(fixture.data, repo);
    expect(page?.commits).toEqual([
      { sha: 'aaa111', authoredDate: '2024-01-10T15:00:00Z', messageHeadline: 'Add widget', repo, branch: 'main', source: 'branch' },
      { sha: 'bbb222', authoredDate: '2024-01-09T15:00:00Z', messageHeadline: 'Fix widget', repo, branch: 'main', source: 'branch' },
      { sha: 'bbb222', authoredDate: '2024-01-09T15:00:00Z', messageHeadline: 'Fix widget', repo, branch: 'feature/login', source: 'branch' },
      { sha: 'ccc333', authoredDate: '2024-01-08T15:00:00Z', messageHeadline: '', repo, branch: 'feature/login', source: 'branch' },
    ]);
  });

  it('skips a branch whose target is missing or not a commit, and a malformed history node', () => {
    const branches = new Set(mapBranchCommits(fixture.data, repo)?.commits.map((c) => c.branch));
    expect(branches).toEqual(new Set(['main', 'feature/login']));
  });

  it('lists a follow-up for each branch with more history', () => {
    expect(mapBranchCommits(fixture.data, repo)?.followUps).toEqual([
      { branch: 'feature/login', cursor: 'feature-cursor-1' },
    ]);
  });

  it('returns the next refs cursor only when there are more branches', () => {
    expect(mapBranchCommits(fixture.data, repo)?.nextRefCursor).toBeNull();
    const more = { repository: { refs: { pageInfo: { hasNextPage: true, endCursor: 'r2' }, nodes: [] } } };
    expect(mapBranchCommits(more, repo)?.nextRefCursor).toBe('r2');
  });

  it('skips a null repository', () => {
    expect(mapBranchCommits({ repository: null, rateLimit: {} }, repo)).toBeUndefined();
  });
});

describe('mapBranchHistory', () => {
  const data = (history: unknown) => ({ repository: { ref: { target: { history } } } });

  it('maps a history page for the given branch', () => {
    const page = mapBranchHistory(
      data({
        pageInfo: { hasNextPage: true, endCursor: 'h2' },
        nodes: [{ oid: 'eee555', authoredDate: '2024-01-07T15:00:00Z', messageHeadline: 'Older' }],
      }),
      repo,
      'feature/login',
    );
    expect(page).toEqual({
      commits: [{ sha: 'eee555', authoredDate: '2024-01-07T15:00:00Z', messageHeadline: 'Older', repo, branch: 'feature/login', source: 'branch' }],
      nextCursor: 'h2',
    });
  });

  it('returns undefined when the branch or repository is gone', () => {
    expect(mapBranchHistory({ repository: { ref: null } }, repo, 'gone')).toBeUndefined();
    expect(mapBranchHistory({ repository: null }, repo, 'gone')).toBeUndefined();
  });
});

describe('mapper validation', () => {
  const reposPage = (nodes: unknown[]) => ({ viewer: { repositories: { nodes } } });
  const good = { name: 'widgets', owner: { login: 'acme' }, isPrivate: false, isFork: false, pushedAt: '2024-01-10T00:00:00Z' };

  it.each([
    ['a non-string name', { ...good, name: 7 }],
    ['a non-boolean isPrivate', { ...good, isPrivate: 'no' }],
    ['a non-boolean isFork', { ...good, isFork: null }],
    ['a missing owner login', { ...good, owner: {} }],
  ])('mapRepos drops a node with %s', (_label, node) => {
    expect(mapRepos(reposPage([node])).repos).toEqual([]);
  });

  it('mapRepos treats a non-string pushedAt as null', () => {
    expect(mapRepos(reposPage([{ ...good, pushedAt: 12 }])).repos[0]?.pushedAt).toBeNull();
  });

  const refs = (nodes: unknown[], pageInfo: unknown = { hasNextPage: false, endCursor: null }) => ({
    repository: { refs: { pageInfo, nodes } },
  });
  const branch = (name: unknown, nodes: unknown[], historyPageInfo: unknown = { hasNextPage: false, endCursor: null }) => ({
    name,
    target: { history: { pageInfo: historyPageInfo, nodes } },
  });

  it('mapBranchCommits drops a history node with no oid, or no authoredDate', () => {
    const page = mapBranchCommits(
      refs([branch('main', [{ authoredDate: '2024-01-10T00:00:00Z' }, { oid: 'x1' }, { oid: 'ok', authoredDate: '2024-01-10T00:00:00Z' }])]),
      repo,
    );
    expect(page?.commits.map((c) => c.sha)).toEqual(['ok']);
  });

  it('mapBranchCommits uses an empty message when messageHeadline is not a string', () => {
    const page = mapBranchCommits(refs([branch('main', [{ oid: 'x1', authoredDate: '2024-01-10T00:00:00Z', messageHeadline: null }])]), repo);
    expect(page?.commits[0]?.messageHeadline).toBe('');
  });

  it('mapBranchCommits skips a branch whose name is not a string', () => {
    const page = mapBranchCommits(refs([branch(42, [{ oid: 'x1', authoredDate: '2024-01-10T00:00:00Z' }])]), repo);
    expect(page?.commits).toEqual([]);
  });

  it('treats hasNextPage without an endCursor as the last page', () => {
    const page = mapBranchCommits(
      refs([branch('main', [], { hasNextPage: true, endCursor: null })], { hasNextPage: true }),
      repo,
    );
    expect(page?.nextRefCursor).toBeNull();
    expect(page?.followUps).toEqual([]);
  });

  it('mapBranchCommits returns an empty page when refs is missing', () => {
    expect(mapBranchCommits({ repository: {} }, repo)).toEqual({ commits: [], followUps: [], nextRefCursor: null });
  });
});
