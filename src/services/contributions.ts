import { aggregateByDay, inGridYear, isCountOnly, localDay, startOfLocalDayIso } from '../core/aggregate';
import { dedupeCommits } from '../core/dedupe';
import { gridDays } from '../core/grid';
import { policyFor } from '../core/privacy';
import type { Commit, Contributions, CountOnly } from '../core/types';
import type { Failure, Response } from '../messaging/protocol';
import { SCHEMA_VERSION, type CacheStore } from './cache/store';
import { mapPool } from './concurrency';
import {
  createRateBudget,
  type CommitAuthor,
  type GitHubClient,
  type GitHubFailure,
  type GitHubResult,
  type RateBudget,
} from './github/client';
import type { Viewer } from './github/mappers';

/** Repositories fetched at once. */
const REPO_CONCURRENCY = 4;

/**
 * Git's `since` compares commit dates, so a commit pushed after a newer one was cached
 * would be missed. 14 days of overlap catches that; dedupe drops the repeats.
 * shortcut: a commit pushed more than 14 days after its authored date is found only after Clear cache.
 */
const OVERLAP_MS = 14 * 86_400_000;

export interface ContributionsDeps {
  client: Pick<GitHubClient, 'getViewer' | 'listOwnerRepos' | 'getBranchCommits' | 'getMergedPrCommits'>;
  getToken: () => Promise<string | undefined>;
  getCommitEmails: () => Promise<readonly string[]>;
  now: () => Date;
  timeZone: string;
  cache: CacheStore;
  /** Set when the handler already resolved the viewer, so this function does not fetch it again. */
  resolvedViewer?: GitHubResult<Viewer>;
  /** The trimmed token `getViewer` already used. Later calls do not read storage again. */
  resolvedToken?: string;
  /** Captured before the first GraphQL call. The grid and `lastSync` both use it. */
  startedAt?: Date;
  /** False after Clear cache or a token change: skip the write. */
  canWrite?: () => boolean;
}

/**
 * One `GET_CONTRIBUTIONS` request. On the viewer's own profile it fetches every non-fork
 * branch commit in the grid year, then merged pull-request commits, and returns `Contributions`
 * in owner mode. On anyone else's profile it returns `{ viewerLogin }` and fetches nothing more.
 * A cache hit refetches from `lastSync − 14 days` and merges with the stored year.
 */
export async function getContributions(login: string, deps: ContributionsDeps): Promise<Response> {
  const { client, timeZone } = deps;
  const startedAt = deps.startedAt ?? deps.now();

  const token = (deps.resolvedToken ?? (await deps.getToken()))?.trim();
  if (!token) {
    return { ok: false, error: 'NO_TOKEN' };
  }

  const viewer = deps.resolvedViewer ?? (await client.getViewer(token));
  if (!viewer.ok) {
    return toFailure(viewer);
  }
  if (login.toLowerCase() !== viewer.data.login.toLowerCase()) {
    return { ok: true, data: { viewerLogin: viewer.data.login } };
  }

  const policy = policyFor('owner');
  const grid = gridDays(localDay(startedAt.toISOString(), timeZone));
  const gridStartDay = grid[0] as string;
  const gridStartIso = startOfLocalDayIso(gridStartDay, timeZone);
  const cached = await deps.cache.get({
    viewerLogin: viewer.data.login,
    profileLogin: login,
    mode: policy.mode,
  });
  const since = cached === undefined ? gridStartIso : overlapSince(cached.lastSync, gridStartIso);
  // A miss searches from the local grid day. A hit uses the UTC day of the overlap timestamp.
  const mergedDay = cached === undefined ? gridStartDay : new Date(since).toISOString().slice(0, 10);
  const budget = createRateBudget();

  const repos = await client.listOwnerRepos(token, since, budget);
  if (!repos.ok) {
    return toFailure(repos);
  }
  // Nothing is kept yet, so a low budget with work left is a failure, not a partial result.
  if (budget.exhausted() && (repos.data.items.length > 0 || repos.data.truncated)) {
    return rateLimited(budget);
  }

  const gathered: Commit[] = [];
  let stopped = false;
  let failure: GitHubFailure | undefined;
  // Copies of the narrowed token and repo list. A nested function does not keep that narrowing.
  const authToken = token;
  const repoList = repos.data.items;

  async function collectBranches(author: CommitAuthor): Promise<void> {
    if (stopped || failure !== undefined || budget.exhausted()) {
      return;
    }
    const settled = await mapPool(repoList, REPO_CONCURRENCY, async (repo) => {
      if (budget.exhausted() || failure !== undefined) {
        stopped = true; // start no further repository
        return [];
      }
      const result = await client.getBranchCommits(authToken, repo, author, since, budget);
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

    for (const slot of settled) {
      if (slot.status === 'fulfilled') {
        gathered.push(...slot.value);
      } else {
        failure ??= { ok: false, error: slot.reason instanceof TypeError ? 'NETWORK' : 'UNKNOWN' };
      }
    }
    // A pass that finished its last page under the floor never starts another repository,
    // so record the stop here. The early return above does not: no repositories and a low
    // budget is a complete empty result.
    if (budget.exhausted()) {
      stopped = true;
    }
  }

  await collectBranches({ id: viewer.data.id });

  let emails: string[] = [];
  if (!stopped && failure === undefined && !budget.exhausted()) {
    emails = (await deps.getCommitEmails()).map((email) => email.trim()).filter((email) => email.length > 0);
    if (emails.length > 0) {
      await collectBranches({ emails });
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

  // A branch phase that already stopped, or a budget too low to start, does not search.
  if (!stopped && failure === undefined && !budget.exhausted()) {
    const prs = await client.getMergedPrCommits(authToken, viewer.data.login, mergedDay, emails, budget);
    if (!prs.ok) {
      if (gathered.length === 0) {
        return toFailure(prs);
      }
      failure = prs;
    } else {
      gathered.push(...prs.data.items);
      if (prs.data.truncated) {
        stopped = true;
      }
      if (prs.data.failure) {
        failure ??= prs.data.failure;
      }
    }
  }

  const stored = cached === undefined ? { commits: [], counts: [] } : commitsIn(cached.contributions);
  const presented: (Commit | CountOnly)[] = [];
  for (const commit of dedupeCommits([...stored.commits, ...gathered])) {
    const kept = policy.includeRepo(commit.repo) ? policy.present(commit) : undefined;
    if (kept !== undefined) {
      presented.push(kept);
    }
  }
  const seen = new Set(presented.map((item) => item.sha));
  for (const count of stored.counts) {
    if (!seen.has(count.sha)) {
      presented.push(count);
    }
  }
  const { days, totals } = aggregateByDay(inGridYear(presented, grid, timeZone), timeZone);
  const data: Contributions = {
    login: viewer.data.login,
    mode: policy.mode,
    days,
    totals,
    partial: stopped || failure !== undefined,
    fetchedAt: startedAt.toISOString(),
  };

  if (!data.partial && deps.canWrite?.() !== false) {
    await deps.cache.put(
      { viewerLogin: viewer.data.login, profileLogin: login, mode: policy.mode },
      { contributions: data, lastSync: startedAt.toISOString(), schemaVersion: SCHEMA_VERSION },
    );
  }

  return { ok: true, data };
}

function overlapSince(lastSync: string, gridStartIso: string): string {
  const overlapMs = new Date(lastSync).getTime() - OVERLAP_MS;
  return overlapMs > new Date(gridStartIso).getTime() ? new Date(overlapMs).toISOString() : gridStartIso;
}

/** Stored days are the source of the next merge. Count-only values have no commit to dedupe. */
function commitsIn(contributions: Contributions): { commits: Commit[]; counts: CountOnly[] } {
  const commits: Commit[] = [];
  const counts: CountOnly[] = [];
  for (const bucket of Object.values(contributions.days)) {
    for (const item of bucket.commits ?? []) {
      if (isCountOnly(item)) {
        counts.push(item);
      } else {
        commits.push(item);
      }
    }
  }
  return { commits, counts };
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
