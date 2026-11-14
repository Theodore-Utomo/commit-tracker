import type { Commit, CountOnly, RepoRef } from '../../../src/core/types';

export const publicRepo: RepoRef = { owner: 'acme', name: 'widgets', isPrivate: false, isFork: false };
export const privateRepo: RepoRef = { owner: 'acme', name: 'secret', isPrivate: true, isFork: false };
export const forkRepo: RepoRef = { owner: 'acme', name: 'fork', isPrivate: false, isFork: true };
export const privateFork: RepoRef = { owner: 'acme', name: 'private-fork', isPrivate: true, isFork: true };

export function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'a1',
    authoredDate: '2024-01-11T12:00:00Z',
    messageHeadline: 'Add widget',
    repo: publicRepo,
    branch: 'main',
    source: 'branch',
    ...overrides,
  };
}

export function countOnly(overrides: Partial<CountOnly> = {}): CountOnly {
  return { sha: 'p1', authoredDate: '2024-01-11T12:00:00Z', private: true, ...overrides };
}
