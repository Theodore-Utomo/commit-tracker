import { LOGIN_PATTERN } from '../core/login';
import type { GetContributionsRequest, Response } from '../messaging/protocol';
import { getContributions, type ContributionsDeps } from './contributions';

/**
 * Answers `GET_CONTRIBUTIONS`. Never throws: every failure becomes an `ErrorCode`.
 * A login that fails `LOGIN_PATTERN` is `NOT_FOUND`; anything else goes to the pipeline,
 * whose `Response` is returned unchanged. `run` is injectable for tests.
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
    return await run(message.login, deps);
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? 'NETWORK' : 'UNKNOWN' };
  }
}
