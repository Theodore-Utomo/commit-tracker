import type { Contributions } from '../core/types';

/** Every failure the worker can report to the content script. */
export type ErrorCode = 'NO_TOKEN' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'NOT_FOUND' | 'NETWORK' | 'UNKNOWN';

export type GetContributionsRequest = { type: 'GET_CONTRIBUTIONS'; login: string };

export type ClearCacheRequest = { type: 'CLEAR_CACHE' };

/** Asks the worker to open the options page, which a content script cannot do itself. */
export type OpenOptionsRequest = { type: 'OPEN_OPTIONS' };

/** Every message the content script or the options page may send to the worker. */
export type Request = GetContributionsRequest | ClearCacheRequest | OpenOptionsRequest;

/** Success data for `CLEAR_CACHE`. */
export interface Cleared {
  cleared: true;
}

/** Success data for `OPEN_OPTIONS`. */
export interface Opened {
  opened: true;
}

export type Failure = { ok: false; error: ErrorCode; resetAt?: string };

/**
 * Every reply the worker sends. `data` is `Contributions` for `GET_CONTRIBUTIONS`, `Cleared`
 * after `CLEAR_CACHE`, and `Opened` after `OPEN_OPTIONS`. `resetAt` is an ISO timestamp, set
 * only with `RATE_LIMITED`.
 */
export type Response = { ok: true; data: Contributions | Cleared | Opened } | Failure;

/** Name of the runtime port the content script holds open while a request is in flight. */
export const KEEPALIVE_PORT = 'keepalive';

/** Posted on the keepalive port every 20 seconds. It carries no data. */
export type KeepalivePing = { type: 'PING' };

/** Narrows an untyped runtime message to a known `Request`. */
export function isRequest(message: unknown): message is Request {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown; login?: unknown };
  if (candidate.type === 'CLEAR_CACHE' || candidate.type === 'OPEN_OPTIONS') {
    return true;
  }
  return candidate.type === 'GET_CONTRIBUTIONS' && typeof candidate.login === 'string';
}
