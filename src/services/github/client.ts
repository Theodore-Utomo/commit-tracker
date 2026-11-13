import { mapViewer, type Viewer } from './mappers';
import { VIEWER_QUERY } from './queries';

const GRAPHQL_URL = 'https://api.github.com/graphql';

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

export interface GitHubClient {
  getViewer(token: string): Promise<GitHubResult<Viewer>>;
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

  async function graphql(token: string, query: string): Promise<GitHubResult<unknown>> {
    let response: globalThis.Response;
    try {
      response = await fetchFn(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query }),
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
  };
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
