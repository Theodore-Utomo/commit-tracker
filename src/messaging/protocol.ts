import type { Contributions } from '../core/types';

/** Every failure the worker can report to the content script. */
export type ErrorCode = 'NO_TOKEN' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'NOT_FOUND' | 'NETWORK' | 'UNKNOWN';

export type GetContributionsRequest = { type: 'GET_CONTRIBUTIONS'; login: string };

/** Every message the content script may send to the worker. */
export type Request = GetContributionsRequest;

/** Success data for someone else's profile until the privacy-modes phase removes it. */
export interface ViewerLogin {
  viewerLogin: string;
}

export type Failure = { ok: false; error: ErrorCode; resetAt?: string };

/**
 * Every reply the worker sends. `data` is `Contributions` on the viewer's own profile and
 * `ViewerLogin` on anyone else's. `resetAt` is an ISO timestamp, set only with `RATE_LIMITED`.
 */
export type Response = { ok: true; data: Contributions | ViewerLogin } | Failure;

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
  return candidate.type === 'GET_CONTRIBUTIONS' && typeof candidate.login === 'string';
}
