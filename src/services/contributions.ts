import { aggregateByDay, inGridYear, localDay, startOfLocalDayIso } from '../core/aggregate';
import { dedupeCommits } from '../core/dedupe';
import { gridDays } from '../core/grid';
import { policyFor } from '../core/privacy';
import type { Commit, CountOnly } from '../core/types';
import type { Failure, Response } from '../messaging/protocol';
import { createRateBudget, type GitHubClient, type GitHubFailure, type RateBudget } from './github/client';
import { mapPool } from './concurrency';

/** Repositories fetched at once. */
const REPO_CONCURRENCY = 4;

export interface ContributionsDeps {
  client: Pick<GitHubClient, 'getViewer' | 'listOwnerRepos' | 'getBranchCommits'>;
  getToken: () => Promise<string | undefined>;
  now: () => Date;
  timeZone: string;
}

/**
 * One `GET_CONTRIBUTIONS` request. On the viewer's own profile it fetches every non-fork
 * branch commit in the grid year and returns `Contributions` in owner mode. On anyone
 * else's profile it returns `{ viewerLogin }` and fetches nothing more.
 */
export async function getContributions(login: string, deps: ContributionsDeps): Promise<Response> {
  const { client, now, timeZone } = deps;

  const token = (await deps.getToken())?.trim();
  if (!token) {
    return { ok: false, error: 'NO_TOKEN' };
  }

  const viewer = await client.getViewer(token);
  if (!viewer.ok) {
    return toFailure(viewer);
  }
  if (login.toLowerCase() !== viewer.data.login.toLowerCase()) {
    return { ok: true, data: { viewerLogin: viewer.data.login } };
  }

  const grid = gridDays(localDay(now().toISOString(), timeZone));
  const since = startOfLocalDayIso(grid[0] as string, timeZone);
  const budget = createRateBudget();

  const repos = await client.listOwnerRepos(token, since, budget);
  if (!repos.ok) {
    return toFailure(repos);
  }
  // Nothing is kept yet, so a low budget with work left is a failure, not a partial result.
  if (budget.exhausted() && (repos.data.items.length > 0 || repos.data.truncated)) {
    return rateLimited(budget);
  }

  const author = { id: viewer.data.id };
  let stopped = false;
  let failure: GitHubFailure | undefined;

  const settled = await mapPool(repos.data.items, REPO_CONCURRENCY, async (repo) => {
    if (budget.exhausted() || failure !== undefined) {
      stopped = true; // start no further repository
      return [];
    }
    const result = await client.getBranchCommits(token, repo, author, since, budget);
    if (!result.ok) {
      failure ??= result;
      return [];
    }
    if (result.data.truncated) {
      stopped = true;
    }
    if (result.data.failure) {
      failure ??= result.data.failure;
    }
    return result.data.items;
  });

  const gathered: Commit[] = [];
  for (const slot of settled) {
    if (slot.status === 'fulfilled') {
      gathered.push(...slot.value);
    } else {
      failure ??= { ok: false, error: slot.reason instanceof TypeError ? 'NETWORK' : 'UNKNOWN' };
    }
  }

  if (gathered.length === 0) {
    if (failure !== undefined) {
      return toFailure(failure);
    }
    // Only a low budget is a rate limit. Work cut short for another reason (a repository
    // hidden partway through) with nothing kept is an empty partial result, below.
    if (stopped && budget.exhausted()) {
      return rateLimited(budget);
    }
  }

  const policy = policyFor('owner');
  const presented: (Commit | CountOnly)[] = [];
  for (const commit of dedupeCommits(gathered)) {
    const kept = policy.includeRepo(commit.repo) ? policy.present(commit) : undefined;
    if (kept !== undefined) {
      presented.push(kept);
    }
  }
  const { days, totals } = aggregateByDay(inGridYear(presented, grid, timeZone), timeZone);

  return {
    ok: true,
    data: {
      login: viewer.data.login,
      mode: policy.mode,
      days,
      totals,
      partial: stopped || failure !== undefined,
      fetchedAt: now().toISOString(),
    },
  };
}

function toFailure(failure: GitHubFailure): Failure {
  return failure.error === 'RATE_LIMITED' && failure.resetAt
    ? { ok: false, error: 'RATE_LIMITED', resetAt: failure.resetAt }
    : { ok: false, error: failure.error };
}

function rateLimited(budget: RateBudget): Failure {
  const resetAt = budget.resetAt();
  return resetAt ? { ok: false, error: 'RATE_LIMITED', resetAt } : { ok: false, error: 'RATE_LIMITED' };
}
