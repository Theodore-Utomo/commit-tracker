import { LOGIN_PATTERN } from '../core/login';
import type { Failure, GetContributionsRequest, Response } from '../messaging/protocol';
import type { CacheStore } from './cache/store';
import { getContributions, type ContributionsDeps } from './contributions';
import type { GitHubFailure } from './github/client';

/**
 * Shared by every request in this worker. A second request joins only when the viewer,
 * the profile, and the mode all match. Losing the map when the worker stops is harmless.
 */
const inFlight = new Map<string, Promise<Response>>();
let generation = 0;

/**
 * Cache reads, writes, and clears run one at a time. Otherwise a `put` that has already
 * passed its generation check can land after `clear()` and restore what Clear cache deleted.
 */
let tail: Promise<void> = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = tail.then(op, op);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Drops in-flight work and blocks writes that started under the previous token. */
export function onTokenChanged(): void {
  generation += 1;
  inFlight.clear();
}

function failureFrom(failure: GitHubFailure): Failure {
  return failure.error === 'RATE_LIMITED' && failure.resetAt
    ? { ok: false, error: 'RATE_LIMITED', resetAt: failure.resetAt }
    : { ok: false, error: failure.error };
}

function failed(error: unknown): Response {
  return { ok: false, error: error instanceof TypeError ? 'NETWORK' : 'UNKNOWN' };
}

function flightKey(viewerLogin: string, profileLogin: string): string {
  return `${viewerLogin}|${profileLogin}|owner`.toLowerCase();
}

/**
 * The cache the pipeline sees. Reads and writes share `enqueue` with `handleClearCache`,
 * and a write is skipped when this request's generation is no longer current.
 */
function guardedCache(cache: CacheStore, recorded: number): CacheStore {
  return {
    get: (key) => enqueue(() => cache.get(key)),
    put: (key, entry) =>
      enqueue(async () => {
        if (generation !== recorded) {
          return;
        }
        await cache.put(key, entry);
      }),
    clear: () => enqueue(() => cache.clear()),
  };
}

/**
 * Answers `GET_CONTRIBUTIONS`. Never throws: every failure becomes an `ErrorCode`.
 * A login that fails `LOGIN_PATTERN` is `NOT_FOUND`. The viewer is resolved before the
 * in-flight key, so an owner result is never shared with a different viewer. `run` is
 * injectable for tests.
 */
export async function handleGetContributions(
  message: GetContributionsRequest,
  deps: ContributionsDeps,
  run: typeof getContributions = getContributions,
): Promise<Response> {
  try {
    if (!LOGIN_PATTERN.test(message.login)) {
      return { ok: false, error: 'NOT_FOUND' };
    }

    const token = (await deps.getToken())?.trim();
    if (!token) {
      return { ok: false, error: 'NO_TOKEN' };
    }

    // Recorded before getViewer, which is the first GraphQL call. A token change during
    // that call must not let a later request join this one, and this one must not write.
    const recorded = generation;
    const startedAt = deps.now();
    const viewer = await deps.client.getViewer(token);
    if (!viewer.ok) {
      return failureFrom(viewer);
    }
    if (message.login.toLowerCase() !== viewer.data.login.toLowerCase()) {
      return { ok: true, data: { viewerLogin: viewer.data.login } };
    }

    const requestDeps: ContributionsDeps = {
      ...deps,
      startedAt,
      resolvedViewer: viewer,
      canWrite: () => generation === recorded,
      cache: guardedCache(deps.cache, recorded),
    };
    if (generation !== recorded) {
      return run(message.login, requestDeps).catch(failed);
    }

    const key = flightKey(viewer.data.login, message.login);
    const existing = inFlight.get(key);
    if (existing) {
      return existing;
    }

    const flight = run(message.login, requestDeps).catch(failed);
    inFlight.set(key, flight);
    void flight.finally(() => {
      if (inFlight.get(key) === flight) {
        inFlight.delete(key);
      }
    });
    return await flight;
  } catch (error) {
    return failed(error);
  }
}

/** Deletes every cached record and drops in-flight work. An IndexedDB rejection is `UNKNOWN`. */
export async function handleClearCache(cache: CacheStore): Promise<Response> {
  generation += 1;
  inFlight.clear();
  try {
    await enqueue(() => cache.clear());
    return { ok: true, data: { cleared: true } };
  } catch {
    return { ok: false, error: 'UNKNOWN' };
  }
}
