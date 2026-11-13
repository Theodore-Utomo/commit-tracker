import type { Request, Response } from './protocol';

type Send = (request: Request) => Promise<unknown>;

const UNKNOWN_FAILURE: Response = { ok: false, error: 'UNKNOWN' };

function isResponse(reply: unknown): reply is Response {
  if (typeof reply !== 'object' || reply === null) {
    return false;
  }
  const candidate = reply as { ok?: unknown; data?: unknown; error?: unknown };
  if (candidate.ok === true) {
    return typeof candidate.data === 'object' && candidate.data !== null;
  }
  return candidate.ok === false && typeof candidate.error === 'string';
}

/**
 * Sends a request to the service worker. Never rejects: a failed send (for example
 * "Extension context invalidated" after a reload) or a missing reply becomes `UNKNOWN`.
 */
export async function sendMessage(
  request: Request,
  send: Send = (message) => browser.runtime.sendMessage(message),
): Promise<Response> {
  try {
    const reply = await send(request);
    return isResponse(reply) ? reply : UNKNOWN_FAILURE;
  } catch {
    return UNKNOWN_FAILURE;
  }
}
