import { LOGIN_PATTERN } from '../core/login';
import { resolveMode } from '../core/privacy';
import type { GetContributionsRequest, Response } from '../messaging/protocol';
import type { CacheEntry, CacheStore } from './cache/store';
import { getContributions, toFailure, type ContributionsDeps } from './contributions';

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

/** Drops in-flight work and blocks writes that started under the previous token or saved emails. */
export function onSettingsChanged(): void {
  generation += 1;
  inFlight.clear();
}

function failed(error: unknown): Response {
  return { ok: false, error: error instanceof TypeError ? 'NETWORK' : 'UNKNOWN' };
}

/** A miss that stores no commits, so a rolled-back write does not leave messages in IndexedDB. */
function emptyTombstone(entry: CacheEntry): CacheEntry {
  return {
    schemaVersion: 0,
    lastSync: entry.lastSync,
    contributions: {
      login: entry.contributions.login,
      mode: entry.contributions.mode,
      days: {},
      totals: { commits: 0, repos: 0 },
      partial: false,
      fetchedAt: entry.lastSync,
    },
  };
}

function flightKey(viewerLogin: string, profileLogin: string): string {
  return `${viewerLogin}|${profileLogin}|${resolveMode(viewerLogin, profileLogin)}`.toLowerCase();
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
        // Keep the previous record so a token change during the write can undo it.
        const previous = await cache.get(key);
        await cache.put(key, entry);
        if (generation === recorded) {
          return;
        }
        const current = await cache.get(key);
        if (current?.lastSync !== entry.lastSync) {
          return;
        }
        // schemaVersion 0 reads as a miss and keeps no commit bodies. Restoring `previous` keeps a completed year.
        await cache.put(key, previous ?? emptyTombstone(entry));
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

    // Recorded before getViewerAndUser, the first GraphQL call. A token change during
    // that call must not let a later request join this one, and this one must not write.
    const recorded = generation;
    const startedAt = deps.now();
    const identity = await deps.client.getViewerAndUser(token, message.login);
    if (!identity.ok) {
      return toFailure(identity);
    }

    const requestDeps: ContributionsDeps = {
      ...deps,
      startedAt,
      resolvedViewer: identity,
      resolvedToken: token,
      canWrite: () => generation === recorded,
      cache: guardedCache(deps.cache, recorded),
    };
    if (generation !== recorded) {
      return run(message.login, requestDeps).catch(failed);
    }

    const key = flightKey(identity.data.viewer.login, message.login);
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

/**
 * Answers `OPEN_OPTIONS`. A content script cannot open the options page, so the worker does.
 * A rejection, or a throw before the promise exists, is `UNKNOWN`.
 */
export async function handleOpenOptions(deps: { openOptionsPage: () => Promise<void> }): Promise<Response> {
  try {
    await deps.openOptionsPage();
    return { ok: true, data: { opened: true } };
  } catch {
    return { ok: false, error: 'UNKNOWN' };
  }
}
