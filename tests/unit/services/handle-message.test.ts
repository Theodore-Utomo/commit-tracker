import { describe, expect, it, vi } from 'vitest';
import type { GetContributionsRequest } from '../../../src/messaging/protocol';
import type { GitHubClient } from '../../../src/services/github/client';
import { handleGetContributions } from '../../../src/services/handle-message';

const request: GetContributionsRequest = { type: 'GET_CONTRIBUTIONS', login: 'octocat' };

function fakeClient(getViewer: GitHubClient['getViewer']) {
  return { getViewer: vi.fn(getViewer) };
}

const viewerClient = () => fakeClient(async () => ({ ok: true, data: { login: 'monalisa', id: 'U_1' } }));

describe('handleGetContributions', () => {
  it('returns NO_TOKEN without calling the client when the token is missing or blank', async () => {
    for (const token of [undefined, '   ']) {
      const client = viewerClient();
      await expect(handleGetContributions(request, { getToken: async () => token, client })).resolves.toEqual({
        ok: false,
        error: 'NO_TOKEN',
      });
      expect(client.getViewer).not.toHaveBeenCalled();
    }
  });

  it('returns NOT_FOUND without reading the token or calling the client for an invalid login', async () => {
    const client = viewerClient();
    const getToken = vi.fn(async () => 'token');
    await expect(
      handleGetContributions({ type: 'GET_CONTRIBUTIONS', login: 'octo%20cat' }, { getToken, client }),
    ).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(client.getViewer).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('returns the viewer login and passes the trimmed token to the client', async () => {
    const client = viewerClient();
    await expect(handleGetContributions(request, { getToken: async () => ' token ', client })).resolves.toEqual({
      ok: true,
      data: { viewerLogin: 'monalisa' },
    });
    expect(client.getViewer).toHaveBeenCalledWith('token');
  });

  it('passes UNAUTHORIZED through from the client', async () => {
    const client = fakeClient(async () => ({ ok: false, error: 'UNAUTHORIZED' }));
    await expect(handleGetContributions(request, { getToken: async () => 'token', client })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    });
  });

  it('passes RATE_LIMITED through with resetAt', async () => {
    const resetAt = '2026-11-13T01:00:00.000Z';
    const client = fakeClient(async () => ({ ok: false, error: 'RATE_LIMITED', resetAt }));
    await expect(handleGetContributions(request, { getToken: async () => 'token', client })).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt,
    });
  });

  it('adds no resetAt key to RATE_LIMITED when the client has none', async () => {
    const client = fakeClient(async () => ({ ok: false, error: 'RATE_LIMITED' }));
    await expect(handleGetContributions(request, { getToken: async () => 'token', client })).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
    });
  });

  it('sends only the viewer login to the page, even when the client result carries errors', async () => {
    const client = fakeClient(async () => ({
      ok: true,
      data: { login: 'monalisa', id: 'U_1' },
      errors: [{ type: 'FORBIDDEN', path: ['viewer', 'organization'] }],
    }));
    await expect(handleGetContributions(request, { getToken: async () => 'token', client })).resolves.toStrictEqual({
      ok: true,
      data: { viewerLogin: 'monalisa' },
    });
  });

  it('never attaches resetAt to a failure other than RATE_LIMITED', async () => {
    const client = fakeClient(async () => ({ ok: false, error: 'NETWORK', resetAt: '2026-11-13T01:00:00.000Z' }));
    await expect(handleGetContributions(request, { getToken: async () => 'token', client })).resolves.toEqual({
      ok: false,
      error: 'NETWORK',
    });
  });

  it('turns a thrown TypeError into NETWORK and any other throw into UNKNOWN', async () => {
    const network = fakeClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    const mapper = fakeClient(async () => {
      throw new Error('GraphQL response has no viewer.');
    });
    const getToken = async () => 'token';

    await expect(handleGetContributions(request, { getToken, client: network })).resolves.toEqual({
      ok: false,
      error: 'NETWORK',
    });
    await expect(handleGetContributions(request, { getToken, client: mapper })).resolves.toEqual({
      ok: false,
      error: 'UNKNOWN',
    });
  });

  it('turns a getToken rejection into UNKNOWN instead of throwing', async () => {
    const client = viewerClient();
    const getToken = async (): Promise<string> => {
      throw new Error('storage unavailable');
    };
    await expect(handleGetContributions(request, { getToken, client })).resolves.toEqual({
      ok: false,
      error: 'UNKNOWN',
    });
  });
});
