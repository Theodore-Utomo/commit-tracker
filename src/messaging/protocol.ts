/** Every failure the worker can report to the content script. */
export type ErrorCode = 'NO_TOKEN' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'NOT_FOUND' | 'NETWORK' | 'UNKNOWN';

export type GetContributionsRequest = { type: 'GET_CONTRIBUTIONS'; login: string };

/** Every message the content script may send to the worker. */
export type Request = GetContributionsRequest;

/** Success data for this phase. The branch-commits phase replaces it with `Contributions`. */
export interface ViewerLogin {
  viewerLogin: string;
}

export type Failure = { ok: false; error: ErrorCode; resetAt?: string };

/** Every reply the worker sends. `resetAt` is an ISO timestamp, set only with `RATE_LIMITED`. */
export type Response = { ok: true; data: ViewerLogin } | Failure;

/** Narrows an untyped runtime message to a known `Request`. */
export function isRequest(message: unknown): message is Request {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown; login?: unknown };
  return candidate.type === 'GET_CONTRIBUTIONS' && typeof candidate.login === 'string';
}
