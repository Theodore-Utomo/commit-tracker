import type { Commit, CountOnly, PrivacyMode, RepoRef } from './types';

/** One privacy mode's rules. The pipeline uses the policy and never branches on the mode itself. */
export interface PrivacyPolicy {
  mode: PrivacyMode;
  /** Whether commits from this repository may be counted at all. Forks never are. */
  includeRepo(repo: RepoRef): boolean;
  /**
   * What the caller may keep of a commit: a new full copy, a new count-only value,
   * or `undefined` when the commit may not be kept. Never mutates its input.
   */
  present(commit: Commit): Commit | CountOnly | undefined;
}

/**
 * A new commit built field by field, so only known fields survive. Anything extra a mapper
 * attached at runtime (an author email, a URL) is dropped rather than passed to the page.
 */
function copy(commit: Commit): Commit {
  const { owner, name, isPrivate, isFork } = commit.repo;
  const kept: Commit = {
    sha: commit.sha,
    authoredDate: commit.authoredDate,
    messageHeadline: commit.messageHeadline,
    repo: { owner, name, isPrivate, isFork },
    source: commit.source,
  };
  if (commit.branch !== undefined) {
    kept.branch = commit.branch;
  }
  return kept;
}

function countOnly(commit: Commit): CountOnly {
  return { sha: commit.sha, authoredDate: commit.authoredDate, private: true };
}

const owner: PrivacyPolicy = {
  mode: 'owner',
  includeRepo: (repo) => !repo.isFork,
  present: (commit) => (owner.includeRepo(commit.repo) ? copy(commit) : undefined),
};

const publicPlusCounts: PrivacyPolicy = {
  mode: 'publicPlusCounts',
  includeRepo: (repo) => !repo.isFork,
  present: (commit) => {
    if (!publicPlusCounts.includeRepo(commit.repo)) {
      return undefined;
    }
    return commit.repo.isPrivate ? countOnly(commit) : copy(commit);
  },
};

const publicOnly: PrivacyPolicy = {
  mode: 'publicOnly',
  includeRepo: (repo) => !repo.isFork && !repo.isPrivate,
  present: (commit) => (publicOnly.includeRepo(commit.repo) ? copy(commit) : undefined),
};

const POLICIES: Record<PrivacyMode, PrivacyPolicy> = { owner, publicPlusCounts, publicOnly };

export function policyFor(mode: PrivacyMode): PrivacyPolicy {
  return POLICIES[mode];
}
