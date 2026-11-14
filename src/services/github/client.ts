import { LOGIN_PATTERN } from '../../core/login';
import type { Commit, RepoRef } from '../../core/types';
import {
  mapBranchCommits,
  mapBranchHistory,
  mapMergedPrSearch,
  mapPrCommitPage,
  mapRateLimit,
  mapRepos,
  mapViewer,
  type RateLimit,
  type Viewer,
} from './mappers';
import { BRANCH_COMMITS, BRANCH_HISTORY, MERGED_PR_COMMITS, OWNER_REPOS, PR_COMMITS, VIEWER_QUERY } from './queries';

const GRAPHQL_URL = 'https://api.github.com/graphql';

/** Below this many rate-limit points, no further page is requested. */
export const RATE_LIMIT_FLOOR = 200;

export interface GraphQLError {
  type?: string;
  message?: string;
  path?: (string | number)[];
}

/** A GitHub failure the client can name. `resetAt` is set only with `RATE_LIMITED`. */
export type GitHubFailure = {
  ok: false;
  error: 'UNAUTHORIZED' | 'RATE_LIMITED' | 'NETWORK' | 'UNKNOWN';
  resetAt?: string;
};

/** A usable response. `errors` is present when GitHub returned data alongside errors. */
export type GitHubResult<T> = { ok: true; data: T; errors?: GraphQLError[] } | GitHubFailure;

/**
 * Items gathered across pages. `truncated` is true when paging stopped before the end:
 * the rate-limit budget ran low, a later page failed (`failure` is set), or the repository
 * became hidden partway through. The caller reads the budget to tell a rate limit apart.
 */
export interface Page<T> {
  items: T[];
  truncated: boolean;
  failure?: GitHubFailure;
}

/** Shared across one request's calls. Every paged response records its `rateLimit` here. */
export interface RateBudget {
  record(rateLimit: RateLimit | undefined): void;
  /** True once a response reported fewer than `RATE_LIMIT_FLOOR` points remaining. */
  exhausted(): boolean;
  /** The reset time from the latest recorded response, as ISO. */
  resetAt(): string | undefined;
}

/**
 * Requests run in parallel, so their replies can arrive out of order: an older reply with more
 * points left can land after a newer one. Within one rate-limit window the count only falls,
 * so the budget keeps the lowest it has seen, and starts over only when a later window begins.
 */
export function createRateBudget(): RateBudget {
  let remaining: number | undefined;
  let reset: string | undefined;
  return {
    record(rateLimit) {
      if (rateLimit === undefined) {
        return;
      }
      if (remaining === undefined || reset === undefined) {
        remaining = rateLimit.remaining;
        reset = rateLimit.resetAt;
        return;
      }
      const incoming = Date.parse(rateLimit.resetAt);
      const current = Date.parse(reset);
      if (Number.isNaN(incoming) || Number.isNaN(current)) {
        // Without two comparable times the window is unknown, so the count may only fall.
        remaining = Math.min(remaining, rateLimit.remaining);
        if (Number.isNaN(current) && !Number.isNaN(incoming)) {
          reset = rateLimit.resetAt;
        }
      } else if (incoming > current) {
        remaining = rateLimit.remaining; // a later window has started
        reset = rateLimit.resetAt;
      } else if (incoming === current) {
        remaining = Math.min(remaining, rateLimit.remaining);
      }
      // incoming < current: a late reply from an earlier window, ignored
    },
    exhausted: () => remaining !== undefined && remaining < RATE_LIMIT_FLOOR,
    resetAt: () => reset,
  };
}

/** `CommitAuthor` as this client sends it: the viewer's node id, or saved commit emails. */
export type CommitAuthor = { id: string } | { emails: readonly string[] };

export interface GitHubClient {
  getViewer(token: string): Promise<GitHubResult<Viewer>>;
  /** The viewer's non-fork repositories pushed at or after `since`, newest-pushed first. */
  listOwnerRepos(token: string, since: string, budget: RateBudget): Promise<GitHubResult<Page<RepoRef>>>;
  /**
   * Every branch commit in `repo` by `author` since `since`. A repository that is `null` or
   * forbidden to this token yields no items and no failure.
   */
  getBranchCommits(
    token: string,
    repo: RepoRef,
    author: CommitAuthor,
    since: string,
    budget: RateBudget,
  ): Promise<GitHubResult<Page<Commit>>>;
  /**
   * Commits on pull requests merged on or after `mergedSince` (`YYYY-MM-DD`) whose author is
   * `login`. A login that fails `LOGIN_PATTERN` yields no items and makes no request.
   * `savedEmails` keep commits that have no linked user. GitHub search stops at 1,000 hits;
   * a larger `issueCount` comes back `truncated`.
   */
  getMergedPrCommits(
    token: string,
    login: string,
    mergedSince: string,
    savedEmails: readonly string[],
    budget: RateBudget,
  ): Promise<GitHubResult<Page<Commit>>>;
}

type Fetch = (input: string, init: RequestInit) => Promise<globalThis.Response>;

interface ClientOptions {
  fetch?: Fetch;
  now?: () => number;
}

/** Builds the fetch-based client. The token is sent only to `api.github.com`. */
export function createGitHubClient(options: ClientOptions = {}): GitHubClient {
  const fetchFn: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());

  async function graphql(
    token: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GitHubResult<unknown>> {
    let response: globalThis.Response;
    try {
      response = await fetchFn(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
      });
    } catch (error) {
      return { ok: false, error: error instanceof TypeError ? 'NETWORK' : 'UNKNOWN' };
    }

    if (response.status === 401) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    if ((response.status === 403 || response.status === 429) && hasRateLimitHeaders(response.headers)) {
      return rateLimited(response.headers, now);
    }
    if (!response.ok) {
      return { ok: false, error: 'NETWORK' };
    }

    let body: { data?: unknown; errors?: GraphQLError[] };
    try {
      body = (await response.json()) as { data?: unknown; errors?: GraphQLError[] };
    } catch {
      return { ok: false, error: 'UNKNOWN' };
    }

    const errors = Array.isArray(body.errors) ? body.errors : [];
    if (errors.some((error) => error.type === 'UNAUTHENTICATED')) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    if (errors.some((error) => error.type === 'RATE_LIMITED')) {
      return rateLimited(response.headers, now);
    }
    if (body.data === undefined || body.data === null) {
      return { ok: false, error: 'UNKNOWN' };
    }
    return errors.length > 0 ? { ok: true, data: body.data, errors } : { ok: true, data: body.data };
  }

  return {
    async getViewer(token) {
      const result = await graphql(token, VIEWER_QUERY);
      if (!result.ok) {
        return result;
      }
      try {
        const viewer = mapViewer(result.data);
        return result.errors ? { ok: true, data: viewer, errors: result.errors } : { ok: true, data: viewer };
      } catch {
        return { ok: false, error: 'UNKNOWN' };
      }
    },

    async listOwnerRepos(token, since, budget) {
      const sinceMs = Date.parse(since);
      const repos: RepoRef[] = [];
      let cursor: string | null = null;

      for (;;) {
        const result = await graphql(token, OWNER_REPOS, { cursor });
        if (!result.ok) {
          return result;
        }
        budget.record(mapRateLimit(result.data));
        const page = mapRepos(result.data);

        for (const { repo, pushedAt } of page.repos) {
          if (pushedAt === null) {
            continue; // never pushed: no commits to find
          }
          if (Date.parse(pushedAt) < sinceMs) {
            return { ok: true, data: { items: repos, truncated: false } };
          }
          repos.push(repo);
        }

        if (page.nextCursor === null) {
          return { ok: true, data: { items: repos, truncated: false } };
        }
        if (budget.exhausted()) {
          return { ok: true, data: { items: repos, truncated: true } };
        }
        cursor = page.nextCursor;
      }
    },

    async getBranchCommits(token, repo, author, since, budget) {
      const commits: Commit[] = [];
      const base = { owner: repo.owner, name: repo.name, author, since };
      const stopped = (failure?: GitHubFailure): GitHubResult<Page<Commit>> => ({
        ok: true,
        data: failure ? { items: commits, truncated: true, failure } : { items: commits, truncated: true },
      });
      let refCursor: string | null = null;
      let firstPage = true;

      for (;;) {
        const result = await graphql(token, BRANCH_COMMITS, { ...base, refCursor });
        if (!result.ok) {
          return firstPage ? result : stopped(result);
        }
        budget.record(mapRateLimit(result.data));

        const page = isRepoHidden(result.errors) ? undefined : mapBranchCommits(result.data, repo);
        if (page === undefined) {
          // Hidden from the start: skip the repository. Hidden partway: what is left is lost.
          return firstPage ? { ok: true, data: { items: [], truncated: false } } : stopped();
        }
        firstPage = false;
        commits.push(...page.commits);

        for (const followUp of page.followUps) {
          let cursor: string | null = followUp.cursor;
          while (cursor !== null) {
            if (budget.exhausted()) {
              return stopped();
            }
            const history = await graphql(token, BRANCH_HISTORY, {
              ...base,
              qualifiedName: `refs/heads/${followUp.branch}`,
              cursor,
            });
            if (!history.ok) {
              return stopped(history);
            }
            budget.record(mapRateLimit(history.data));
            if (isRepoHidden(history.errors) || !hasRepository(history.data)) {
              return stopped(); // the repository was hidden partway through
            }
            const historyPage = mapBranchHistory(history.data, repo, followUp.branch);
            if (historyPage === undefined) {
              break; // the branch was deleted since the first page
            }
            commits.push(...historyPage.commits);
            cursor = historyPage.nextCursor;
          }
        }

        if (page.nextRefCursor === null) {
          return { ok: true, data: { items: commits, truncated: false } };
        }
        if (budget.exhausted()) {
          return stopped();
        }
        refCursor = page.nextRefCursor;
      }
    },

    async getMergedPrCommits(token, login, mergedSince, savedEmails, budget) {
      if (!LOGIN_PATTERN.test(login)) {
        return { ok: true, data: { items: [], truncated: false } };
      }
      // The pattern excludes spaces and search operators, so the login cannot change the query.
      const q = `author:${login} is:pr is:merged merged:>=${mergedSince}`;
      const commits: Commit[] = [];
      const cut = (failure?: GitHubFailure): GitHubResult<Page<Commit>> => ({
        ok: true,
        data: failure ? { items: commits, truncated: true, failure } : { items: commits, truncated: true },
      });
      let cursor: string | null = null;
      let firstPage = true;
      let capped = false;

      for (;;) {
        const result = await graphql(token, MERGED_PR_COMMITS, { q, cursor });
        if (!result.ok) {
          return firstPage ? result : cut(result);
        }
        budget.record(mapRateLimit(result.data));
        const page = mapMergedPrSearch(result.data, login, savedEmails, forbiddenNodeIndexes(result.errors));
        if (page === undefined) {
          return firstPage ? { ok: false, error: 'UNKNOWN' } : cut();
        }
        firstPage = false;
        if (page.issueCount > 1000) {
          capped = true; // GitHub search returns at most 1,000 hits
        }
        commits.push(...page.commits);

        for (const followUp of page.followUps) {
          let prCursor: string | null = followUp.cursor;
          while (prCursor !== null) {
            if (budget.exhausted()) {
              return cut();
            }
            const more = await graphql(token, PR_COMMITS, {
              owner: followUp.repo.owner,
              name: followUp.repo.name,
              number: followUp.number,
              cursor: prCursor,
            });
            if (!more.ok) {
              return cut(more);
            }
            budget.record(mapRateLimit(more.data));
            if (hidesPullRequest(more.errors)) {
              break; // this pull request only; the rest of the search continues
            }
            const prPage = mapPrCommitPage(more.data, followUp.repo, login, savedEmails);
            if (prPage === undefined) {
              break;
            }
            commits.push(...prPage.commits);
            prCursor = prPage.nextCursor;
          }
        }

        if (page.nextCursor === null) {
          return { ok: true, data: { items: commits, truncated: capped } };
        }
        if (budget.exhausted()) {
          return cut();
        }
        cursor = page.nextCursor;
      }
    },
  };
}

/**
 * True when an error says the repository itself is not found or forbidden (for example, SAML).
 * An error deeper inside it, such as one branch's target, does not hide the rest of the page.
 */
function isRepoHidden(errors: GraphQLError[] | undefined): boolean {
  return (errors ?? []).some(
    (error) =>
      (error.type === 'FORBIDDEN' || error.type === 'NOT_FOUND') &&
      error.path?.length === 1 &&
      error.path[0] === 'repository',
  );
}

/** Indexes of `search.nodes` that a `FORBIDDEN` error points at. Those pull requests are skipped. */
function forbiddenNodeIndexes(errors: GraphQLError[] | undefined): Set<number> {
  const indexes = new Set<number>();
  for (const error of errors ?? []) {
    if (error.type !== 'FORBIDDEN' || error.path === undefined) {
      continue;
    }
    for (let i = 0; i < error.path.length - 1; i += 1) {
      const index = error.path[i + 1];
      if (error.path[i] === 'nodes' && typeof index === 'number') {
        indexes.add(index);
        break;
      }
    }
  }
  return indexes;
}

/** A follow-up is one pull request, so any forbidden or missing error skips the rest of it. */
function hidesPullRequest(errors: GraphQLError[] | undefined): boolean {
  return (errors ?? []).some((error) => error.type === 'FORBIDDEN' || error.type === 'NOT_FOUND');
}

function hasRepository(data: unknown): boolean {
  const repository = (data as { repository?: unknown } | null | undefined)?.repository;
  return typeof repository === 'object' && repository !== null;
}

function hasRateLimitHeaders(headers: Headers): boolean {
  return headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after');
}

function rateLimited(headers: Headers, now: () => number): GitHubFailure {
  const resetAt = resetTime(headers, now);
  return resetAt ? { ok: false, error: 'RATE_LIMITED', resetAt } : { ok: false, error: 'RATE_LIMITED' };
}

/** `x-ratelimit-reset` (epoch seconds) wins; otherwise now plus `retry-after` seconds. */
function resetTime(headers: Headers, now: () => number): string | undefined {
  const reset = Number(headers.get('x-ratelimit-reset') ?? Number.NaN);
  if (Number.isFinite(reset) && reset > 0) {
    return new Date(reset * 1000).toISOString();
  }
  const retryAfter = Number(headers.get('retry-after') ?? Number.NaN);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return new Date(now() + retryAfter * 1000).toISOString();
  }
  return undefined;
}
