import { LOGIN_PATTERN } from '../core/login';
import type { GetContributionsRequest, Response } from '../messaging/protocol';
import type { GitHubClient } from './github/client';

export interface GetContributionsDeps {
  getToken: () => Promise<string | undefined>;
  client: Pick<GitHubClient, 'getViewer'>;
}

/**
 * Answers `GET_CONTRIBUTIONS`. Never throws: every failure becomes an `ErrorCode`.
 * This phase returns only the viewer's login; `message.login` is validated but not used.
 */
export async function handleGetContributions(
  message: GetContributionsRequest,
  { getToken, client }: GetContributionsDeps,
): Promise<Response> {
  try {
    if (!LOGIN_PATTERN.test(message.login)) {
      return { ok: false, error: 'NOT_FOUND' };
    }

    const token = (await getToken())?.trim();
    if (!token) {
      return { ok: false, error: 'NO_TOKEN' };
    }

    const result = await client.getViewer(token);
    if (!result.ok) {
      return result.error === 'RATE_LIMITED' && result.resetAt
        ? { ok: false, error: 'RATE_LIMITED', resetAt: result.resetAt }
        : { ok: false, error: result.error };
    }
    return { ok: true, data: { viewerLogin: result.data.login } };
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? 'NETWORK' : 'UNKNOWN' };
  }
}
